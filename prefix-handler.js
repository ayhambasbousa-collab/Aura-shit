const { EmbedBuilder } = require('discord.js');
const db = require('./database');
const { canAddPoints, isOwner, sendLog, checkPromotion, buildReportEmbed } = require('./utils');

const PREFIX = '!';

function parseMention(str) {
  const m = str?.match(/^<@!?(\d+)>$/);
  return m ? m[1] : null;
}

async function fetchUser(client, userId) {
  return client.users.cache.get(userId) ?? await client.users.fetch(userId);
}

function buildBar(pct) {
  const f = Math.round(pct / 10);
  return '🟩'.repeat(f) + '⬛'.repeat(10 - f);
}

const TYPE_ICON = { add: '🟢', deduct: '🔴', set: '🟡', reset: '⚪' };
const TYPE_SIGN = { add: '+', deduct: '-', set: '=', reset: '↩' };

async function handleMessage(message, client) {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift();
  const settings = await db.getGuildSettings(message.guildId);

  // ── !مساعدة ────────────────────────────────────────────────────────────────
  if (command === 'مساعدة') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📖 قائمة أوامر الـ !')
      .addFields(
        { name: '➕ إضافة نقاط',    value: '`!تسجيل @عضو <نقاط> <سبب>`' },
        { name: '➖ خصم نقاط',      value: '`!خصم @عضو <نقاط> <سبب>`' },
        { name: '✏️ تعيين نقاط',   value: '`!تعيين @عضو <نقاط> <سبب>`' },
        { name: '🔄 تصفير',         value: '`!تصفير @عضو تأكيد`' },
        { name: '🗑️ حذف عملية',    value: '`!حذف_سجل <رقم_العملية>`' },
        { name: '📊 النقاط',         value: '`!نقاط @عضو`' },
        { name: '📋 السجل',          value: '`!سجل @عضو`' },
        { name: '🏆 الترتيب',        value: '`!ترتيب`' },
        { name: '📊 تقرير فوري',     value: '`!تقرير`  (المالك)' },
      )
      .setFooter({ text: 'استخدم /مساعدة لقائمة الأوامر الكاملة' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !تسجيل @العضو نقاط سبب ────────────────────────────────────────────────
  if (command === 'تسجيل') {
    if (!canAddPoints(message.member, settings))
      return message.reply('❌ ليس لديك صلاحية استخدام هذا الأمر.');

    const userId = parseMention(args[0]);
    const points = parseInt(args[1], 10);
    const reason = args.slice(2).join(' ');
    if (!userId || !points || points < 1 || !reason)
      return message.reply('⚠️ الاستخدام: `!تسجيل @العضو <نقاط> <سبب>`');

    const targetUser = await fetchUser(client, userId).catch(() => null);
    if (!targetUser) return message.reply('❌ لم يتم العثور على العضو.');

    const prev     = await db.getPoints(userId, message.guildId);
    const newTotal = await db.addPoints(userId, message.guildId, points, reason, message.author.id);

    const embed = new EmbedBuilder().setColor(0x00C853).setTitle('✅ تم تسجيل النقاط')
      .addFields(
        { name: '👤 العضو',          value: `<@${userId}>`,              inline: true  },
        { name: '➕ النقاط المضافة', value: `\`+${points}\``,             inline: true  },
        { name: '🏆 المجموع الكلي',  value: `\`${newTotal}\``,            inline: true  },
        { name: '📝 السبب',          value: reason,                       inline: false },
        { name: '👮 بواسطة',         value: `<@${message.author.id}>`,    inline: false },
      ).setTimestamp();

    await message.reply({ embeds: [embed] });
    await sendLog(message.guild, settings, { type:'add', targetUser, points, reason, newTotal, executorTag: message.author.tag, executorId: message.author.id });
    await checkPromotionMsg(message, targetUser, newTotal, prev, settings);
    return;
  }

  // ── !خصم @العضو نقاط سبب ──────────────────────────────────────────────────
  if (command === 'خصم') {
    if (!isOwner(message.member, settings))
      return message.reply('❌ هذا الأمر للمالك فقط.');

    const userId = parseMention(args[0]);
    const points = parseInt(args[1], 10);
    const reason = args.slice(2).join(' ');
    if (!userId || !points || points < 1 || !reason)
      return message.reply('⚠️ الاستخدام: `!خصم @العضو <نقاط> <سبب>`');

    const targetUser = await fetchUser(client, userId).catch(() => null);
    if (!targetUser) return message.reply('❌ لم يتم العثور على العضو.');

    const newTotal = await db.deductPoints(userId, message.guildId, points, reason, message.author.id);

    const embed = new EmbedBuilder().setColor(0xD32F2F).setTitle('➖ تم خصم النقاط')
      .addFields(
        { name: '👤 العضو',           value: `<@${userId}>`,              inline: true  },
        { name: '➖ النقاط المخصومة', value: `\`-${points}\``,             inline: true  },
        { name: '🏆 المجموع الكلي',   value: `\`${newTotal}\``,            inline: true  },
        { name: '📝 السبب',           value: reason,                       inline: false },
        { name: '👮 بواسطة',          value: `<@${message.author.id}>`,    inline: false },
      ).setTimestamp();

    await message.reply({ embeds: [embed] });
    await sendLog(message.guild, settings, { type:'deduct', targetUser, points, reason, newTotal, executorTag: message.author.tag, executorId: message.author.id });
    return;
  }

  // ── !تعيين @العضو نقاط سبب ────────────────────────────────────────────────
  if (command === 'تعيين') {
    if (!isOwner(message.member, settings))
      return message.reply('❌ هذا الأمر للمالك فقط.');

    const userId   = parseMention(args[0]);
    const newTotal = parseInt(args[1], 10);
    const reason   = args.slice(2).join(' ');
    if (!userId || isNaN(newTotal) || newTotal < 0 || !reason)
      return message.reply('⚠️ الاستخدام: `!تعيين @العضو <نقاط> <سبب>`');

    const targetUser = await fetchUser(client, userId).catch(() => null);
    if (!targetUser) return message.reply('❌ لم يتم العثور على العضو.');

    const prev = await db.getPoints(userId, message.guildId);
    await db.setPoints(userId, message.guildId, newTotal, reason, message.author.id);
    const diff = newTotal - prev;

    const embed = new EmbedBuilder().setColor(0xFFA000).setTitle('✏️ تم تعيين النقاط')
      .addFields(
        { name: '👤 العضو',      value: `<@${userId}>`,                              inline: true  },
        { name: '📊 من → إلى',  value: `\`${prev}\` → \`${newTotal}\``,              inline: true  },
        { name: '↕️ الفرق',     value: `\`${diff >= 0 ? '+' : ''}${diff}\``,         inline: true  },
        { name: '📝 السبب',      value: reason,                                       inline: false },
        { name: '👮 بواسطة',     value: `<@${message.author.id}>`,                   inline: false },
      ).setTimestamp();

    await message.reply({ embeds: [embed] });
    await sendLog(message.guild, settings, { type:'set', targetUser, points: Math.abs(diff), reason, newTotal, executorTag: message.author.tag, executorId: message.author.id });
    return;
  }

  // ── !تصفير @العضو تأكيد ───────────────────────────────────────────────────
  if (command === 'تصفير') {
    if (!isOwner(message.member, settings))
      return message.reply('❌ هذا الأمر للمالك فقط.');

    const userId    = parseMention(args[0]);
    const confirmed = args[1] === 'تأكيد';
    if (!userId) return message.reply('⚠️ الاستخدام: `!تصفير @العضو تأكيد`');
    if (!confirmed) {
      const current = await db.getPoints(userId, message.guildId);
      return message.reply(`⚠️ للتصفير اكتب: \`!تصفير <@${userId}> تأكيد\`\nسيتم حذف **${current}** نقطة.`);
    }

    const targetUser = await fetchUser(client, userId).catch(() => null);
    if (!targetUser) return message.reply('❌ لم يتم العثور على العضو.');

    const prev = await db.getPoints(userId, message.guildId);
    await db.resetPoints(userId, message.guildId, message.author.id);

    const embed = new EmbedBuilder().setColor(0x607D8B).setTitle('🔄 تم التصفير')
      .addFields(
        { name: '👤 العضو',   value: `<@${userId}>`,             inline: true  },
        { name: '📊 النقاط',  value: `\`${prev} → 0\``,           inline: true  },
        { name: '👮 بواسطة',  value: `<@${message.author.id}>`,   inline: false },
      ).setTimestamp();

    await message.reply({ embeds: [embed] });
    await sendLog(message.guild, settings, { type:'reset', targetUser, points: prev, reason:'تصفير النقاط', newTotal:0, executorTag: message.author.tag, executorId: message.author.id });
    return;
  }

  // ── !حذف_سجل <id> ─────────────────────────────────────────────────────────
  if (command === 'حذف_سجل') {
    if (!isOwner(message.member, settings))
      return message.reply('❌ هذا الأمر للمالك فقط.');

    const id = parseInt(args[0], 10);
    if (!id || id < 1) return message.reply('⚠️ الاستخدام: `!حذف_سجل <رقم_العملية>`');

    const tx = await db.deleteTransaction(id, message.guildId);
    if (!tx) return message.reply(`❌ لم يتم العثور على عملية برقم \`${id}\`.`);

    const newTotal = await db.getPoints(tx.user_id, message.guildId);
    const embed = new EmbedBuilder().setColor(0x9E9E9E).setTitle('🗑️ تم حذف العملية')
      .addFields(
        { name: '🔢 رقم العملية',     value: `\`${id}\``,          inline: true  },
        { name: '👤 العضو',           value: `<@${tx.user_id}>`,   inline: true  },
        { name: '📊 نقاط معكوسة',    value: `\`${tx.points}\``,   inline: true  },
        { name: '🏆 المجموع الجديد',  value: `\`${newTotal}\``,    inline: true  },
        { name: '📝 السبب الأصلي',    value: tx.reason,            inline: false },
      ).setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── !نيوك (مقلب) ─────────────────────────────────────────────────────────
  if (command === 'نيوك') {
    return message.reply('جاري عمل نيوك للسيرفر🚀..\n|| مقلب😭✌️||');
  }

  // ── !سجل_قديم (عرض كل السجلات) ──────────────────────────────────────────────
  if (command === 'سجل_قديم') {
    if (!isOwner(message.member, settings))
      return message.reply('❌ هذا الأمر للمالك فقط.');

    const txs = await db.getAllTransactions(message.guildId);
    if (!txs.length) return message.reply('📭 ما فيه أي سجلات مسجلة بعد.');

    const TYPE_LABEL = { add: '➕ إضافة', deduct: '➖ خصم', set: '✏️ تعيين', reset: '↩️ تصفير' };

    const lines = txs.map(tx => {
      const date = new Date(tx.ts * 1000).toLocaleDateString('ar-EG');
      return `**#${tx.id}** | ${TYPE_LABEL[tx.type] ?? tx.type} \`${tx.points}\` | <@${tx.user_id}> | ${tx.reason} | بواسطة <@${tx.added_by}> | ${date}`;
    });

    // تقسيم السجلات إلى دفعات (كل دفعة أقل من 3500 حرف) وإرسال كل دفعة كرسالة embed مستقلة
    const chunks = [];
    let current = '';
    for (const line of lines) {
      if ((current + '\n' + line).length > 3500) {
        chunks.push(current);
        current = line;
      } else {
        current = current ? current + '\n' + line : line;
      }
    }
    if (current) chunks.push(current);

    await message.reply(`📜 إجمالي السجلات: **${txs.length}** — جاري الإرسال (${chunks.length} رسالة)...`);
    for (let i = 0; i < chunks.length; i++) {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setDescription(chunks[i])
        .setFooter({ text: `دفعة ${i + 1}/${chunks.length}` });
      await message.channel.send({ embeds: [embed] });
    }
    return;
  }

  // ── !نقاط @العضو ───────────────────────────────────────────────────────────
  if (command === 'نقاط') {
    const userId = parseMention(args[0]);
    if (!userId) return message.reply('⚠️ الاستخدام: `!نقاط @العضو`');

    const targetUser = await fetchUser(client, userId).catch(() => null);
    if (!targetUser) return message.reply('❌ لم يتم العثور على العضو.');

    const total     = await db.getPoints(userId, message.guildId);
    const threshold = settings.promotion_threshold;
    const pct       = Math.min(Math.round((total / threshold) * 100), 100);
    const eligible  = total >= threshold;
    const near      = !eligible && pct >= 80;

    const embed = new EmbedBuilder()
      .setColor(eligible ? 0xFFD700 : near ? 0xFF9800 : 0x5865F2)
      .setTitle(`🏆 نقاط ${targetUser.username}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '📊 المجموع الكلي', value: `\`${total}\` نقطة`,    inline: true  },
        { name: '🎯 هدف الترقية',   value: `\`${threshold}\` نقطة`, inline: true  },
        { name: '📈 التقدم',        value: `${buildBar(pct)} \`${pct}%\``, inline: false },
        { name: '⭐ الحالة', value:
            eligible ? '✅ **مؤهل للترقية**' :
            near     ? `⚠️ قريب! بقي \`${threshold - total}\` نقطة` :
                       `يحتاج \`${threshold - total}\` نقطة`,
          inline: false },
      ).setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── !سجل @العضو ────────────────────────────────────────────────────────────
  if (command === 'سجل') {
    const userId = parseMention(args[0]);
    if (!userId) return message.reply('⚠️ الاستخدام: `!سجل @العضو`');

    const targetUser = await fetchUser(client, userId).catch(() => null);
    if (!targetUser) return message.reply('❌ لم يتم العثور على العضو.');

    const [history, total] = await Promise.all([
      db.getHistory(userId, message.guildId, 15),
      db.getPoints(userId, message.guildId),
    ]);

    if (!history.length) return message.reply(`📭 لا توجد عمليات لـ <@${userId}>.`);

    const lines = history.map(tx =>
      `${TYPE_ICON[tx.type] ?? '⚪'} \`#${tx.id}\` **${TYPE_SIGN[tx.type] ?? ''}${tx.points}** — ${tx.reason} — <t:${tx.ts}:d>`
    );

    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`📋 سجل ${targetUser.username}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .setDescription(lines.join('\n'))
      .addFields({ name: '🏆 المجموع الحالي', value: `\`${total}\` نقطة` })
      .setFooter({ text: `آخر ${history.length} عملية` }).setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── !ترتيب ─────────────────────────────────────────────────────────────────
  if (command === 'ترتيب') {
    const rows = await db.getLeaderboard(message.guildId, 10);
    if (!rows.length) return message.reply('📭 لا توجد بيانات نقاط بعد.');

    const MEDALS = ['🥇','🥈','🥉'];
    const lines  = await Promise.all(rows.map(async (row, i) => {
      let name;
      try { name = (await fetchUser(client, row.user_id)).username; } catch { name = `<@${row.user_id}>`; }
      const star = row.total_points >= settings.promotion_threshold ? ' ⭐' : '';
      return `${MEDALS[i] ?? `\`#${i+1}\``} **${name}** — \`${row.total_points}\`${star}`;
    }));

    const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('🏆 ترتيب الإداريين بالنقاط')
      .setDescription(lines.join('\n'))
      .setFooter({ text: `⭐ = مؤهل للترقية (${settings.promotion_threshold}+ نقطة)` }).setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── !تقرير (فوري) ──────────────────────────────────────────────────────────
  if (command === 'تقرير') {
    if (!isOwner(message.member, settings))
      return message.reply('❌ هذا الأمر للمالك فقط.');

    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const embed = await buildReportEmbed(message.guild, settings, since, 'الأسبوعي (فوري)');
    return message.reply({ embeds: [embed] });
  }
}

async function checkPromotionMsg(message, targetUser, newTotal, prevTotal, settings) {
  const threshold = settings.promotion_threshold;
  const pct     = (newTotal / threshold) * 100;
  const prevPct = (prevTotal / threshold) * 100;

  if (newTotal >= threshold && prevTotal < threshold) {
    const embed = new EmbedBuilder().setColor(0xFFD700).setTitle('🎉 مبروك! أصبح مؤهلاً للترقية')
      .setDescription(`<@${targetUser.id}> وصل إلى **${newTotal} نقطة** وأصبح مؤهلاً للترقية! 🏆`)
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }
  if (pct >= 80 && prevPct < 80 && newTotal < threshold) {
    const embed = new EmbedBuilder().setColor(0xFF9800).setTitle('⚠️ اقترب من الترقية!')
      .setDescription(`<@${targetUser.id}> وصل إلى **${newTotal} نقطة** — بقي **${threshold - newTotal}** للترقية!`)
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }
}

module.exports = { handleMessage };
