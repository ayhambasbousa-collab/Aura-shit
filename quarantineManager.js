// quarantineManager.js
// Aura Quarantine — بدل الحظر الفوري، المشتبه فيه يُعزل: تُسحب كل رتبه الحالية
// وتُحفظ، ويُحصر بروم مراجعة وحيد، لين إداري حقيقي يراجع ويقرر (تحرير أو حظر نهائي).

const { EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const db = require('./database');

const BRAND = 'Absolute Aura Protect';
const SYSTEM_NAME = 'Aura Hope';

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setAuthor({ name: `🔒 ${SYSTEM_NAME} — Aura Quarantine` }).setTimestamp();
}

// يتأكد من وجود رتبة وروم الحجر، ينشئهم أول مرة إذا ما كانوا موجودين
async function ensureQuarantineSetup(guild) {
  const settings = await db.getAntiNukeSettings(guild.id);
  let roleId = settings.quarantine_role_id;
  let channelId = settings.quarantine_channel_id;

  let role = roleId ? guild.roles.cache.get(roleId) : null;
  if (!role) {
    role = await guild.roles.create({
      name: '🔒 Aura Quarantine',
      color: 0x2C2F33,
      permissions: [],
      reason: `🛡️ ${BRAND}: إنشاء رتبة الحجر الصحي`,
    });
    roleId = role.id;
  }

  let channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel) {
    channel = await guild.channels.create({
      name: '🔒-aura-quarantine',
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ],
      reason: `🛡️ ${BRAND}: إنشاء روم مراجعة الحجر الصحي`,
    });
    channelId = channel.id;
  }

  if (roleId !== settings.quarantine_role_id || channelId !== settings.quarantine_channel_id) {
    await db.setQuarantineConfig(guild.id, roleId, channelId);
  }

  return { role, channel };
}

async function quarantineMember(guild, userId, reason, logChannel) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, reason: 'member_not_found' };

  const { role: quarantineRole, channel: reviewChannel } = await ensureQuarantineSetup(guild);

  // نحفظ رتبه الحالية (غير @everyone) عشان نقدر نرجعها لاحقًا
  const originalRoles = member.roles.cache
    .filter((r) => r.id !== guild.id && r.id !== quarantineRole.id)
    .map((r) => r.id);

  try {
    await member.roles.set([quarantineRole.id], `🛡️ ${BRAND}: حجر صحي — ${reason}`);
  } catch (err) {
    return { ok: false, reason: 'permission_error', error: err.message };
  }

  const quarantineId = await db.createQuarantine(guild.id, userId, originalRoles, reason);

  await reviewChannel.send({
    embeds: [
      baseEmbed(0xF39C12)
        .setTitle('🔒 عضو تحت الحجر الصحي')
        .setDescription(`<@${userId}> انعزل مؤقتًا وسحبت كل رتبه.\n**السبب:** ${reason}`)
        .addFields(
          { name: '🆔 رقم الحالة', value: `\`${quarantineId}\``, inline: true },
          { name: '📋 الأوامر', value: `\`/quarantine release ${quarantineId}\` — تحرير\n\`/quarantine ban ${quarantineId}\` — حظر نهائي`, inline: false },
        ),
    ],
  }).catch(() => {});

  if (logChannel) {
    await logChannel.send({
      embeds: [baseEmbed(0xF39C12).setDescription(`🔒 تم حجر <@${userId}> بدل الحظر المباشر — بانتظار مراجعة إدارية بـ ${reviewChannel}.`)],
    }).catch(() => {});
  }

  return { ok: true, quarantineId };
}

async function releaseQuarantine(guild, quarantineId) {
  const record = await db.getQuarantineById(quarantineId, guild.id);
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.released) return { ok: false, reason: 'already_released' };

  const member = await guild.members.fetch(record.user_id).catch(() => null);
  const originalRoles = record.original_roles ? record.original_roles.split(',').filter(Boolean) : [];

  if (member) {
    try {
      await member.roles.set(originalRoles, `🛡️ ${BRAND}: تحرير من الحجر الصحي بعد المراجعة`);
    } catch (err) {
      return { ok: false, reason: 'permission_error', error: err.message };
    }
  }

  await db.releaseQuarantine(quarantineId);
  return { ok: true, userId: record.user_id, memberFound: !!member };
}

async function convertQuarantineToBan(guild, quarantineId) {
  const record = await db.getQuarantineById(quarantineId, guild.id);
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.released) return { ok: false, reason: 'already_released' };

  try {
    await guild.members.ban(record.user_id, { reason: `🛡️ ${BRAND}: تأكيد إداري بعد الحجر الصحي` });
  } catch (err) {
    return { ok: false, reason: 'ban_failed', error: err.message };
  }

  await db.releaseQuarantine(quarantineId);
  return { ok: true, userId: record.user_id };
}

module.exports = {
  ensureQuarantineSetup,
  quarantineMember,
  releaseQuarantine,
  convertQuarantineToBan,
};
