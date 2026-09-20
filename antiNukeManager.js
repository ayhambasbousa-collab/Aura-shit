// antiNukeManager.js
// Aura Hope — Absolute Aura Protect: نظام حماية شامل من النيوك.
//
// يحتفظ بنسخة حديثة دائمة من كل قناة ورتبة (تتحدث لحظة أي إنشاء/تعديل)، ويراقب:
//   • حذف القنوات / الرتب بسرعة متتالية
//   • حظر أعضاء بسرعة متتالية
//   • حذف رسائل جماعي (Bulk Delete)
//   • إنشاء قنوات/رتب سبام بكمية كبيرة بسرعة
//   • إنشاء Webhooks مشبوهة
//   • منح صلاحيات خطيرة (Administrator، Ban، Kick، Manage Roles/Channels/Webhooks...) لرتبة من غير المالك
//   • تغيير اسم أو شعار السيرفر من غير المالك (تشويه هوية السيرفر)
//
// لما يوصل عدد معين من هالأحداث من نفس الشخص خلال ثواني قليلة، يعتبرها "نيوك":
//   1) يحظر الفاعل فورًا (إلا لو كان صاحب السيرفر، بالقائمة الموثوقة، أو البوت نفسه)
//   2) يفك الحظر عن أي عضو تم حظره ظلمًا بنفس الهجوم
//   3) يحذف أي قناة/رتبة/ويبهوك سبام تم إنشاؤه بنفس الهجوم
//   4) يعيد إنشاء أي قناة أو رتبة محذوفة من آخر نسخة معروفة عنها
//
// القيود: الرسائل نفسها ما ترجع بنفس صاحبها وتوقيتها (قيد من ديسكورد نفسه)،
// وترتيب الرتب بالقائمة بعد الاسترجاع أفضل جهد (best-effort) مو مضمون 100%.

const { AuditLogEvent, ChannelType, PermissionsBitField, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const db = require('./database');
const quarantineManager = require('./quarantineManager');

const BRAND = 'Absolute Aura Protect';
const SYSTEM_NAME = 'Aura Hope';

// صور البراند — توضع كصورة مصغّرة عشوائية بكل رسالة يرسلها النظام
const BRAND_IMAGES = ['aura1.jpg', 'aura2.jpg', 'aura3.jpg'];
const ASSETS_DIR = path.join(__dirname, 'assets');

const COLOR = {
  danger: 0xE74C3C,
  warning: 0xF39C12,
  success: 0x2ECC71,
  info: 0x5865F2,
};

// أهم الصلاحيات الخطيرة — منحها لرتبة من غير المالك يعتبر خطر فوري
const DANGEROUS_FLAGS = [
  ['Administrator', PermissionsBitField.Flags.Administrator],
  ['Ban Members', PermissionsBitField.Flags.BanMembers],
  ['Kick Members', PermissionsBitField.Flags.KickMembers],
  ['Manage Guild', PermissionsBitField.Flags.ManageGuild],
  ['Manage Roles', PermissionsBitField.Flags.ManageRoles],
  ['Manage Channels', PermissionsBitField.Flags.ManageChannels],
  ['Manage Webhooks', PermissionsBitField.Flags.ManageWebhooks],
  ['Mention Everyone', PermissionsBitField.Flags.MentionEveryone],
];

// guildId -> executorId -> [{ ts, kind, payload }]
const activity = new Map();

// كاش قصير لسجلات التدقيق — يمنع إغراق Discord API بطلبات متكررة أثناء هجوم حقيقي
const auditCache = new Map();
const AUDIT_CACHE_MS = 2000;

function getBucket(guildId, executorId) {
  if (!activity.has(guildId)) activity.set(guildId, new Map());
  const guildMap = activity.get(guildId);
  if (!guildMap.has(executorId)) guildMap.set(executorId, []);
  return guildMap.get(executorId);
}

function pruneBucket(bucket, windowMs) {
  const cutoff = Date.now() - windowMs;
  while (bucket.length && bucket[0].ts < cutoff) bucket.shift();
}

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setAuthor({ name: `🛡️ ${SYSTEM_NAME} — ${BRAND}` }).setTimestamp();
}

// يرسل embed مع صورة عشوائية من صور البراند كصورة مصغّرة (Thumbnail)
async function sendBrandedEmbed(channel, embed) {
  const filename = BRAND_IMAGES[Math.floor(Math.random() * BRAND_IMAGES.length)];
  const attachment = new AttachmentBuilder(path.join(ASSETS_DIR, filename), { name: filename });
  embed.setThumbnail(`attachment://${filename}`);
  return channel.send({ embeds: [embed], files: [attachment] });
}

async function isExempt(guild, userId) {
  if (userId === guild.ownerId) return true;
  if (userId === guild.client.user.id) return true;
  try {
    return await db.isAntiNukeWhitelisted(guild.id, userId);
  } catch {
    return false;
  }
}

// ─── أخذ نسخة (Snapshot) من قناة أو رتبة ────────────────────────────────────────

function snapshotChannelFromObject(channel) {
  const overwrites = [...channel.permissionOverwrites.cache.values()].map((ow) => ({
    id: ow.id,
    type: ow.type,
    allow: ow.allow.bitfield.toString(),
    deny: ow.deny.bitfield.toString(),
  }));

  return {
    channelId: channel.id,
    name: channel.name,
    type: channel.type,
    position: channel.rawPosition ?? channel.position ?? 0,
    parentId: channel.parentId ?? null,
    topic: channel.topic ?? null,
    nsfw: channel.nsfw ?? false,
    bitrate: channel.bitrate ?? null,
    userLimit: channel.userLimit ?? null,
    rateLimitPerUser: channel.rateLimitPerUser ?? null,
    overwrites,
  };
}

function snapshotRoleFromObject(role) {
  return {
    roleId: role.id,
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions.bitfield.toString(),
    position: role.position,
  };
}

async function snapshotChannel(channel) {
  if (!channel.guild) return;
  try {
    await db.upsertChannelBackup(channel.guildId, snapshotChannelFromObject(channel));
  } catch (err) {
    console.error('❌ فشل حفظ نسخة القناة:', err.message);
  }
}

async function snapshotRole(role) {
  if (role.managed || role.id === role.guild.id) return;
  try {
    await db.upsertRoleBackup(role.guild.id, snapshotRoleFromObject(role));
  } catch (err) {
    console.error('❌ فشل حفظ نسخة الرتبة:', err.message);
  }
}

async function fullSnapshotGuild(guild) {
  try {
    for (const channel of guild.channels.cache.values()) await snapshotChannel(channel);
    for (const role of guild.roles.cache.values()) await snapshotRole(role);
  } catch (err) {
    console.error('❌ فشل أخذ نسخة كاملة للسيرفر:', err.message);
  }
}

// ─── سجل التدقيق (مع كاش قصير لمنع Rate Limit أثناء الهجوم) ────────────────────

async function fetchAuditLogsRaw(guild, auditType) {
  const key = `${guild.id}:${auditType}`;
  try {
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 10 });
    const entries = [...logs.entries.values()];
    auditCache.set(key, { fetchedAt: Date.now(), entries });
    return entries;
  } catch (err) {
    console.error('❌ فشل قراءة سجل التدقيق (تأكد من صلاحية View Audit Log):', err.message);
    return [];
  }
}

function getCachedEntries(guild, auditType) {
  const key = `${guild.id}:${auditType}`;
  const cached = auditCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < AUDIT_CACHE_MS) return cached.entries;
  return null;
}

async function findExecutorByTarget(guild, auditType, targetId, withinMs = 12000) {
  const cached = getCachedEntries(guild, auditType);
  if (cached) {
    const hit = cached.find((e) => e.target?.id === targetId && (Date.now() - e.createdTimestamp) < withinMs);
    if (hit) return hit.executor ?? null;
  }
  const fresh = await fetchAuditLogsRaw(guild, auditType);
  const entry = fresh.find((e) => e.target?.id === targetId && (Date.now() - e.createdTimestamp) < withinMs);
  return entry?.executor ?? null;
}

async function findRecentExecutor(guild, auditType, withinMs = 10000) {
  let entries = getCachedEntries(guild, auditType);
  if (!entries) entries = await fetchAuditLogsRaw(guild, auditType);
  const entry = entries.find((e) => (Date.now() - e.createdTimestamp) < withinMs);
  return entry?.executor ?? null;
}

// ─── الاستعادة (قنوات + رتب مفقودة) ─────────────────────────────────────────────

async function reconcileGuild(guild, logChannel) {
  try {
    const roleBackups = await db.listRoleBackups(guild.id);
    const missingRoles = roleBackups.filter((r) => !guild.roles.cache.has(r.role_id));

    for (const r of missingRoles) {
      try {
        const newRole = await guild.roles.create({
          name: r.name,
          color: r.color,
          hoist: r.hoist,
          mentionable: r.mentionable,
          permissions: BigInt(r.permissions),
          reason: `🛡️ ${BRAND} — استعادة تلقائية بعد رصد هجوم نيوك`,
        });

        if (typeof r.position === 'number' && r.position > 0) {
          await newRole.setPosition(r.position, { reason: 'استعادة الموقع الأصلي' }).catch(() => {});
        }

        await db.deleteRoleBackup(r.role_id);
        await snapshotRole(newRole);
        if (logChannel) {
          await sendBrandedEmbed(logChannel, baseEmbed(COLOR.success).setDescription(`♻️ استرجعت الرتبة **${r.name}**`)).catch(() => {});
        }
      } catch (err) {
        console.error('❌ فشل استرجاع رتبة:', err.message);
      }
    }

    const channelBackups = await db.listChannelBackups(guild.id);
    const missingChannels = channelBackups.filter((c) => !guild.channels.cache.has(c.channel_id));

    const categories = missingChannels.filter((c) => c.type === ChannelType.GuildCategory);
    const others = missingChannels.filter((c) => c.type !== ChannelType.GuildCategory);
    const idRemap = new Map();

    for (const c of [...categories, ...others]) {
      try {
        const overwrites = (c.overwrites || []).map((ow) => ({
          id: ow.id,
          type: ow.type,
          allow: BigInt(ow.allow),
          deny: BigInt(ow.deny),
        }));

        const newParentId = c.parent_id ? (idRemap.get(c.parent_id) ?? c.parent_id) : null;
        const parentStillExists = newParentId ? guild.channels.cache.has(newParentId) : false;

        const created = await guild.channels.create({
          name: c.name,
          type: c.type,
          parent: parentStillExists ? newParentId : undefined,
          position: c.position ?? undefined,
          topic: c.topic || undefined,
          nsfw: c.nsfw,
          bitrate: c.bitrate || undefined,
          userLimit: c.user_limit || undefined,
          rateLimitPerUser: c.rate_limit_per_user || undefined,
          permissionOverwrites: overwrites,
          reason: `🛡️ ${BRAND} — استعادة تلقائية بعد رصد هجوم نيوك`,
        });

        idRemap.set(c.channel_id, created.id);
        await db.deleteChannelBackup(c.channel_id);
        await snapshotChannel(created);
        if (logChannel) {
          await sendBrandedEmbed(logChannel, baseEmbed(COLOR.success).setDescription(`♻️ استرجعت القناة **#${c.name}**`)).catch(() => {});
        }
      } catch (err) {
        console.error('❌ فشل استرجاع قناة:', err.message);
      }
    }
  } catch (err) {
    console.error('❌ فشل عام أثناء الاستعادة:', err.message);
  }
}

async function purgeSpam(guild, bucket, logChannel) {
  for (const entry of bucket) {
    if (entry.kind === 'channelCreate') {
      const ch = guild.channels.cache.get(entry.payload.channelId);
      if (!ch) continue;
      try {
        await ch.delete(`🛡️ ${BRAND}: قناة سبام أُنشئت أثناء هجوم مرصود`);
        if (logChannel) await sendBrandedEmbed(logChannel, baseEmbed(COLOR.warning).setDescription(`🗑️ حذفت القناة المشبوهة **#${entry.payload.name}**`)).catch(() => {});
      } catch (err) {
        console.error('❌ فشل حذف قناة سبام:', err.message);
      }
    } else if (entry.kind === 'roleCreate') {
      const role = guild.roles.cache.get(entry.payload.roleId);
      if (!role) continue;
      try {
        await role.delete(`🛡️ ${BRAND}: رتبة سبام أُنشئت أثناء هجوم مرصود`);
        if (logChannel) await sendBrandedEmbed(logChannel, baseEmbed(COLOR.warning).setDescription(`🗑️ حذفت الرتبة المشبوهة **${entry.payload.name}**`)).catch(() => {});
      } catch (err) {
        console.error('❌ فشل حذف رتبة سبام:', err.message);
      }
    }
  }
}

// ─── العقاب (حظر الفاعل) ────────────────────────────────────────────────────────

async function punishExecutor(guild, executorId, logChannel, settings) {
  if (await isExempt(guild, executorId)) return false;
  if (executorId === 'UNKNOWN') return false;

  // وضع الحجر الصحي: نعزل بدل ما نحظر مباشرة — مراجعة بشرية قبل القرار النهائي
  if (settings?.punishment_mode === 'quarantine') {
    const result = await quarantineManager.quarantineMember(guild, executorId, 'رصد نشاط تخريبي متتالي', logChannel);
    if (!result.ok && logChannel) {
      await sendBrandedEmbed(
        logChannel,
        baseEmbed(COLOR.warning).setTitle('⚠️ تعذر الحجر').setDescription(
          `رصدنا نشاط تخريبي من <@${executorId}> بس ما قدرت أعزله تلقائيًا. **تدخل يدوي مطلوب!**`
        )
      ).catch(() => {});
    }
    return result.ok;
  }

  try {
    await guild.members.ban(executorId, { reason: `🛡️ ${BRAND}: رصد نشاط تخريبي متتالي` });
    if (logChannel) {
      await sendBrandedEmbed(
        logChannel,
        baseEmbed(COLOR.danger).setTitle('🔨 تم الحظر').setDescription(`تم حظر <@${executorId}> نهائيًا — رصدنا نشاط تخريبي متتالي.`)
      ).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error('❌ فشل حظر الفاعل (يمكن رتبته أعلى من رتبة البوت):', err.message);
    if (logChannel) {
      await sendBrandedEmbed(
        logChannel,
        baseEmbed(COLOR.warning).setTitle('⚠️ تعذر الحظر').setDescription(
          `رصدنا نشاط تخريبي من <@${executorId}> بس ما قدرت أحظره تلقائيًا (يمكن رتبته أعلى من رتبة البوت). **تدخل يدوي مطلوب!**`
        )
      ).catch(() => {});
    }
    return false;
  }
}

async function unbanVictim(guild, userId, logChannel) {
  try {
    await guild.members.unban(userId, `🛡️ ${BRAND}: إلغاء حظر تم أثناء هجوم مرصود`);
    if (logChannel) await sendBrandedEmbed(logChannel, baseEmbed(COLOR.success).setDescription(`✅ فُك الحظر عن <@${userId}> (كان محظور بالهجوم).`)).catch(() => {});
  } catch {
    // تجاهل بصمت
  }
}

async function getLogChannel(guild, settings) {
  if (!settings.log_channel_id) return null;
  return guild.channels.cache.get(settings.log_channel_id) || null;
}

// ─── نقطة الدخول: تسجيل نشاط + فحص العتبة ──────────────────────────────────────

const KIND_LABELS = {
  channelDelete: '🗑️ حذف قنوات',
  roleDelete: '🗑️ حذف رتب',
  ban: '🔨 حظر أعضاء',
  kick: '👢 طرد أعضاء',
  bulkDelete: '🧹 حذف رسائل جماعي',
  channelCreate: '📦 سبام قنوات',
  roleCreate: '📦 سبام رتب',
  webhookCreate: '🔗 ويبهوكات مشبوهة',
  adminGrant: '🔑 منح صلاحيات خطيرة',
  identityChange: '🎭 تغيير هوية السيرفر',
  botAdd: '🤖 بوت مشبوه',
};

async function trackAndRespond(guild, executorId, kind, payload, settings) {
  if (await isExempt(guild, executorId)) return;

  const windowMs = settings.threshold_seconds * 1000;
  const bucket = getBucket(guild.id, executorId);
  pruneBucket(bucket, windowMs);
  bucket.push({ ts: Date.now(), kind, payload });

  const effectiveThreshold = executorId === 'UNKNOWN'
    ? Math.max(2, Math.ceil(settings.threshold_count / 2))
    : settings.threshold_count;

  if (bucket.length < effectiveThreshold) return;

  const logChannel = await getLogChannel(guild, settings);
  const incidentKinds = [...new Set(bucket.map((e) => e.kind))];

  if (logChannel) {
    const who = executorId === 'UNKNOWN' ? '**شخص مجهول** (تعذر تحديده من سجل التدقيق)' : `<@${executorId}>`;
    const breakdown = incidentKinds
      .map((k) => `${KIND_LABELS[k] ?? k} ×${bucket.filter((e) => e.kind === k).length}`)
      .join('\n');

    const alertEmbed = baseEmbed(COLOR.danger)
      .setTitle('🚨 تنبيه هجوم نيوك!')
      .setDescription(`رصدنا نشاط تخريبي متتالي من ${who} خلال **${settings.threshold_seconds}** ثانية.\nجاري الاستجابة التلقائية...`)
      .addFields({ name: '📋 تفاصيل النشاط المرصود', value: breakdown || '—' });

    await sendBrandedEmbed(logChannel, alertEmbed).catch(() => {});
  }

  const banEntries = bucket.filter((e) => e.kind === 'ban');
  for (const entry of banEntries) await unbanVictim(guild, entry.payload.victimId, logChannel);

  await purgeSpam(guild, bucket, logChannel);

  let banned = false;
  if (executorId !== 'UNKNOWN') banned = await punishExecutor(guild, executorId, logChannel, settings);

  await reconcileGuild(guild, logChannel);

  if (logChannel) {
    await sendBrandedEmbed(logChannel, baseEmbed(COLOR.success).setTitle('✅ اكتملت الاستجابة').setDescription('تمت معالجة الحادثة والسيرفر بأمان الآن.')).catch(() => {});
  }

  // نسجل الحادثة بقاعدة البيانات بشكل دائم — مين نفذ العملية ومتى، حتى لو تحذفت رسائل اللوق
  try {
    const actionTaken = executorId === 'UNKNOWN' ? 'unknown_no_ban' : (banned ? 'banned' : 'ban_failed');
    await db.logAntiNukeIncident(guild.id, executorId, incidentKinds.join(','), bucket.length, actionTaken);
  } catch (err) {
    console.error('❌ فشل تسجيل الحادثة بقاعدة البيانات:', err.message);
  }

  bucket.length = 0;
}

// ─── معالجات أحداث الحذف ────────────────────────────────────────────────────────

async function handleChannelDelete(channel) {
  if (!channel.guild) return;
  const settings = await db.getAntiNukeSettings(channel.guildId);
  if (!settings.enabled) return;
  const executor = await findExecutorByTarget(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  await trackAndRespond(channel.guild, executor?.id ?? 'UNKNOWN', 'channelDelete', { channelId: channel.id }, settings);
}

async function handleRoleDelete(role) {
  const settings = await db.getAntiNukeSettings(role.guild.id);
  if (!settings.enabled) return;
  const executor = await findExecutorByTarget(role.guild, AuditLogEvent.RoleDelete, role.id);
  await trackAndRespond(role.guild, executor?.id ?? 'UNKNOWN', 'roleDelete', { roleId: role.id }, settings);
}

async function handleGuildBanAdd(ban) {
  const settings = await db.getAntiNukeSettings(ban.guild.id);
  if (!settings.enabled) return;
  const executor = await findExecutorByTarget(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  if (!executor) return;
  await trackAndRespond(ban.guild, executor.id, 'ban', { victimId: ban.user.id }, settings);
}

// نفرق بين مغادرة طوعية وطرد (Kick) عن طريق سجل التدقيق — GuildMemberRemove يطلق بالحالتين
async function handleMemberRemove(member) {
  const settings = await db.getAntiNukeSettings(member.guild.id);
  if (!settings.enabled) return;
  const executor = await findExecutorByTarget(member.guild, AuditLogEvent.MemberKick, member.id, 5000);
  if (!executor) return; // مغادرة طوعية عادية، مو طرد — نتجاهلها
  await trackAndRespond(member.guild, executor.id, 'kick', { victimId: member.id }, settings);
}

async function handleMessageBulkDelete(messages, channel) {
  if (!channel.guild) return;
  const settings = await db.getAntiNukeSettings(channel.guildId);
  if (!settings.enabled) return;
  const executor = await findRecentExecutor(channel.guild, AuditLogEvent.MessageBulkDelete);
  await trackAndRespond(channel.guild, executor?.id ?? 'UNKNOWN', 'bulkDelete', { channelId: channel.id }, settings);
}

// ─── حارس البوتات المشبوهة (تُضاف عبر رابط OAuth) ──────────────────────────────

async function handleMemberAdd(member) {
  if (!member.user.bot) return; // بس البوتات تهمنا هنا

  const settings = await db.getAntiNukeSettings(member.guild.id);
  if (!settings.enabled) return;

  const executor = await findRecentExecutor(member.guild, AuditLogEvent.BotAdd, 8000);
  if (!executor) return;
  if (await isExempt(member.guild, executor.id)) return;

  try {
    await member.kick(`🛡️ ${BRAND}: بوت غير موثوق أُضيف من غير المالك`);
  } catch (err) {
    console.error('❌ فشل طرد البوت المشبوه:', err.message);
  }

  const logChannel = await getLogChannel(member.guild, settings);
  if (logChannel) {
    await sendBrandedEmbed(
      logChannel,
      baseEmbed(COLOR.danger).setTitle('🤖 بوت مشبوه').setDescription(
        `<@${executor.id}> ضاف بوت **${member.user.tag}** غير موثوق للسيرفر. تم طرده فورًا.`
      )
    ).catch(() => {});
  }

  await trackAndRespond(member.guild, executor.id, 'botAdd', {}, settings);
}



async function handleChannelCreate(channel) {
  if (!channel.guild) return;
  const settings = await db.getAntiNukeSettings(channel.guildId);
  if (!settings.enabled) return;
  const executor = await findExecutorByTarget(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  if (!executor) return;
  await trackAndRespond(channel.guild, executor.id, 'channelCreate', { channelId: channel.id, name: channel.name }, settings);
}

async function handleRoleCreate(role) {
  if (role.managed) return;
  const settings = await db.getAntiNukeSettings(role.guild.id);
  if (!settings.enabled) return;
  const executor = await findExecutorByTarget(role.guild, AuditLogEvent.RoleCreate, role.id);
  if (!executor) return;
  await trackAndRespond(role.guild, executor.id, 'roleCreate', { roleId: role.id, name: role.name }, settings);
}

// ─── حارس الويبهوك المشبوه ──────────────────────────────────────────────────────

async function handleWebhookUpdate(channel) {
  if (!channel.guild) return;
  const settings = await db.getAntiNukeSettings(channel.guildId);
  if (!settings.enabled) return;

  let entries = getCachedEntries(channel.guild, AuditLogEvent.WebhookCreate);
  if (!entries) entries = await fetchAuditLogsRaw(channel.guild, AuditLogEvent.WebhookCreate);
  const entry = entries.find((e) => (Date.now() - e.createdTimestamp) < 8000);
  if (!entry || !entry.executor) return;
  if (await isExempt(channel.guild, entry.executor.id)) return;

  try {
    if (entry.target?.delete) {
      await entry.target.delete(`🛡️ ${BRAND}: ويبهوك مشبوه`);
    } else if (entry.target?.id) {
      // خيار احتياطي: نجيب كل ويبهوكات القناة ونحذف اللي يطابق الآيدي
      const hooks = await channel.fetchWebhooks().catch(() => null);
      const match = hooks?.get(entry.target.id);
      if (match) await match.delete(`🛡️ ${BRAND}: ويبهوك مشبوه`);
    }
    const logChannel = await getLogChannel(channel.guild, settings);
    if (logChannel) {
      await sendBrandedEmbed(
        logChannel,
        baseEmbed(COLOR.warning).setDescription(`🗑️ حذفت ويبهوك مشبوه أنشأه <@${entry.executor.id}> بقناة <#${channel.id}>`)
      ).catch(() => {});
    }
  } catch (err) {
    console.error('❌ فشل حذف الويبهوك المشبوه:', err.message);
  }

  await trackAndRespond(channel.guild, entry.executor.id, 'webhookCreate', {}, settings);
}

// ─── حارس الصلاحيات الخطيرة ──────────────────────────────────────────────────────

async function handleRoleUpdateGuard(oldRole, newRole) {
  const newlyGranted = DANGEROUS_FLAGS.filter(
    ([, flag]) => newRole.permissions.has(flag) && !oldRole.permissions.has(flag)
  );
  if (!newlyGranted.length) return;

  const settings = await db.getAntiNukeSettings(newRole.guild.id);
  if (!settings.enabled) return;

  const executor = await findExecutorByTarget(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  if (!executor) return;
  if (await isExempt(newRole.guild, executor.id)) return;

  try {
    await newRole.setPermissions(oldRole.permissions, `🛡️ ${BRAND}: سحب صلاحيات خطيرة مشبوهة`);
  } catch (err) {
    console.error('❌ فشل سحب الصلاحيات الخطيرة:', err.message);
  }

  const logChannel = await getLogChannel(newRole.guild, settings);
  if (logChannel) {
    const flagNames = newlyGranted.map(([name]) => `\`${name}\``).join('، ');
    await sendBrandedEmbed(
      logChannel,
      baseEmbed(COLOR.danger).setTitle('🚨 محاولة رفع صلاحيات مشبوهة').setDescription(
        `<@${executor.id}> حاول يعطي رتبة **${newRole.name}** صلاحيات خطيرة: ${flagNames}\nتم سحبها فورًا.`
      )
    ).catch(() => {});
  }

  await trackAndRespond(newRole.guild, executor.id, 'adminGrant', {}, settings);
}

// ─── حارس هوية السيرفر (الاسم / الشعار) ─────────────────────────────────────────

async function handleGuildUpdateGuard(oldGuild, newGuild) {
  const nameChanged = oldGuild.name !== newGuild.name;
  const iconChanged = oldGuild.icon !== newGuild.icon;
  const verificationLowered = newGuild.verificationLevel < oldGuild.verificationLevel;
  if (!nameChanged && !iconChanged && !verificationLowered) return;

  const settings = await db.getAntiNukeSettings(newGuild.id);
  if (!settings.enabled) return;

  const executor = await findRecentExecutor(newGuild, AuditLogEvent.GuildUpdate);
  if (!executor) return;
  if (await isExempt(newGuild, executor.id)) return;

  try {
    if (nameChanged) await newGuild.setName(oldGuild.name, `🛡️ ${BRAND}: استرجاع اسم السيرفر بعد تغيير مشبوه`);
    if (iconChanged) {
      await newGuild.setIcon(oldGuild.iconURL({ size: 1024 }), `🛡️ ${BRAND}: استرجاع شعار السيرفر بعد تغيير مشبوه`).catch(() => {});
    }
    if (verificationLowered) {
      await newGuild.setVerificationLevel(oldGuild.verificationLevel, `🛡️ ${BRAND}: استرجاع مستوى التحقق بعد خفض مشبوه`).catch(() => {});
    }
  } catch (err) {
    console.error('❌ فشل استرجاع هوية/إعدادات السيرفر:', err.message);
  }

  const logChannel = await getLogChannel(newGuild, settings);
  if (logChannel) {
    const parts = [];
    if (nameChanged) parts.push('اسم');
    if (iconChanged) parts.push('شعار');
    if (verificationLowered) parts.push('مستوى التحقق');

    await sendBrandedEmbed(
      logChannel,
      baseEmbed(COLOR.danger).setTitle('🎭 محاولة تشويه هوية/إعدادات السيرفر').setDescription(
        `<@${executor.id}> غيّر ${parts.join(' و')} السيرفر. تم الاسترجاع فورًا.`
      )
    ).catch(() => {});
  }

  await trackAndRespond(newGuild, executor.id, 'identityChange', {}, settings);
}

module.exports = {
  snapshotChannel,
  snapshotRole,
  fullSnapshotGuild,
  handleChannelDelete,
  handleRoleDelete,
  handleGuildBanAdd,
  handleMemberRemove,
  handleMemberAdd,
  handleMessageBulkDelete,
  handleChannelCreate,
  handleRoleCreate,
  handleWebhookUpdate,
  handleRoleUpdateGuard,
  handleGuildUpdateGuard,
};
