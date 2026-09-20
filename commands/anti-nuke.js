const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const db = require('../database');
const antiNuke = require('../antiNukeManager');

// شخص واحد بس يقدر يتحكم بنظام الحماية (تشغيل/إيقاف/تعديل الإعدادات الحساسة)
// عشان لو حساب إدمن عادي انسرق، ما يقدر يعطّل الحماية أو يضعفها
const SUPER_ADMIN_ID = '1386014228908998727';

const BRAND = 'Absolute Aura Protect';
const SYSTEM_NAME = 'Aura Hope';
const COLOR = { danger: 0xE74C3C, warning: 0xF39C12, success: 0x2ECC71, info: 0x5865F2 };

const BRAND_IMAGES = ['aura1.jpg', 'aura2.jpg', 'aura3.jpg'];
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setAuthor({ name: `🛡️ ${SYSTEM_NAME} — ${BRAND}` }).setTimestamp();
}

// يبني رد جاهز (embed + صورة مرفقة عشوائية) عشان نبعثه بـ interaction.reply/editReply مباشرة
function branded(embed, ephemeral = true) {
  const filename = BRAND_IMAGES[Math.floor(Math.random() * BRAND_IMAGES.length)];
  const attachment = new AttachmentBuilder(path.join(ASSETS_DIR, filename), { name: filename });
  embed.setThumbnail(`attachment://${filename}`);
  return { embeds: [embed], files: [attachment], ephemeral };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anti-nuke')
    .setDescription(`إدارة ${BRAND} — نظام الحماية من النيوك (إدارة فقط)`)
    .addSubcommand((sub) => sub.setName('on').setDescription(`تفعيل ${BRAND}`))
    .addSubcommand((sub) => sub.setName('off').setDescription(`إيقاف ${BRAND}`))
    .addSubcommand((sub) => sub.setName('status').setDescription('عرض حالة النظام الحالية'))
    .addSubcommand((sub) => sub
      .setName('log-channel')
      .setDescription(`حدد قناة تنبيهات ${BRAND}`)
      .addChannelOption((opt) => opt.setName('channel').setDescription('القناة').setRequired(true)))
    .addSubcommand((sub) => sub.setName('resync').setDescription('خذ نسخة احتياطية جديدة من كل القنوات والرتب الحالية'))
    .addSubcommand((sub) => sub
      .setName('punishment')
      .setDescription('اختر شلون يتعامل النظام مع الفاعل: حظر مباشر أو حجر صحي للمراجعة')
      .addStringOption((opt) => opt.setName('mode').setDescription('الوضع').setRequired(true)
        .addChoices({ name: '🔨 حظر مباشر', value: 'ban' }, { name: '🔒 حجر صحي (Aura Quarantine)', value: 'quarantine' })))
    .addSubcommand((sub) => sub
      .setName('threshold')
      .setDescription('عدّل حساسية نظام الحماية')
      .addIntegerOption((opt) => opt.setName('count').setDescription('عدد العمليات المشبوهة').setRequired(true).setMinValue(2).setMaxValue(20))
      .addIntegerOption((opt) => opt.setName('seconds').setDescription('خلال كم ثانية').setRequired(true).setMinValue(2).setMaxValue(60)))
    .addSubcommand((sub) => sub.setName('logs').setDescription('اعرض آخر الحوادث المسجلة (مين ومتى)'))
    .addSubcommandGroup((group) => group
      .setName('whitelist')
      .setDescription('إدارة قائمة الأعضاء الموثوقين المستثنين من الحماية')
      .addSubcommand((sub) => sub
        .setName('add')
        .setDescription('أضف عضو للقائمة الموثوقة')
        .addUserOption((opt) => opt.setName('user').setDescription('العضو').setRequired(true)))
      .addSubcommand((sub) => sub
        .setName('remove')
        .setDescription('احذف عضو من القائمة الموثوقة')
        .addUserOption((opt) => opt.setName('user').setDescription('العضو').setRequired(true)))
      .addSubcommand((sub) => sub.setName('list').setDescription('اعرض القائمة الموثوقة الحالية'))),

  async execute(interaction) {
    if (interaction.user.id !== SUPER_ADMIN_ID) {
      return interaction.reply(branded(baseEmbed(COLOR.danger).setDescription('❌ هذا الأمر مقتصر على شخص واحد محدد بس.')));
    }

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    // ── مجموعة whitelist ─────────────────────────────────────────────────────
    if (group === 'whitelist') {
      if (sub === 'add') {
        const user = interaction.options.getUser('user');
        await db.addToAntiNukeWhitelist(interaction.guildId, user.id, interaction.user.id);
        return interaction.reply(branded(
          baseEmbed(COLOR.success).setDescription(`✅ ${user} انضاف للقائمة الموثوقة. أي نشاط منه ما يُحسب ضد نظام الحماية أبدًا.`)
        ));
      }

      if (sub === 'remove') {
        const user = interaction.options.getUser('user');
        const removed = await db.removeFromAntiNukeWhitelist(interaction.guildId, user.id);
        return interaction.reply(branded(
          baseEmbed(removed ? COLOR.warning : COLOR.info).setDescription(
            removed ? `🗑️ تم حذف ${user} من القائمة الموثوقة.` : `❌ ${user} مو موجود بالقائمة الموثوقة أصلاً.`
          )
        ));
      }

      if (sub === 'list') {
        const list = await db.listAntiNukeWhitelist(interaction.guildId);
        const embed = baseEmbed(COLOR.info).setTitle('📋 القائمة الموثوقة');
        embed.setDescription(
          list.length
            ? list.map((w) => `• <@${w.user_id}> — أضافه <@${w.added_by}>`).join('\n')
            : 'ماكو أي عضو بالقائمة الموثوقة حاليًا (غير صاحب السيرفر، وهو مستثنى دائمًا).'
        );
        return interaction.reply(branded(embed));
      }
      return;
    }

    // ── الأوامر الرئيسية ──────────────────────────────────────────────────────
    if (sub === 'on') {
      await db.setAntiNukeEnabled(interaction.guildId, true);
      return interaction.reply(branded(baseEmbed(COLOR.success).setDescription(`🛡️ تم تفعيل ${BRAND}.`)));
    }

    if (sub === 'off') {
      await db.setAntiNukeEnabled(interaction.guildId, false);
      return interaction.reply(branded(
        baseEmbed(COLOR.warning).setDescription(`⚠️ تم إيقاف ${BRAND}. السيرفر بدون حماية تلقائية الآن.`)
      ));
    }

    if (sub === 'status') {
      const s = await db.getAntiNukeSettings(interaction.guildId);
      const embed = baseEmbed(s.enabled ? COLOR.success : COLOR.warning)
        .setTitle(s.enabled ? '✅ الحماية مفعّلة' : '❌ الحماية متوقفة')
        .addFields(
          { name: '⚡ العتبة', value: `**${s.threshold_count}** عمليات خلال **${s.threshold_seconds}** ثانية`, inline: true },
          { name: '📋 قناة التنبيهات', value: s.log_channel_id ? `<#${s.log_channel_id}>` : 'غير محددة', inline: true },
          {
            name: '🛡️ الحماية النشطة',
            value: [
              '• حذف قنوات/رتب سريع → استرجاع تلقائي',
              '• حظر/طرد أعضاء جماعي → فك حظر تلقائي',
              '• حذف رسائل جماعي مشبوه',
              '• سبام إنشاء قنوات/رتب → حذف تلقائي',
              '• ويبهوكات مشبوهة → حذف فوري',
              '• بوتات مشبوهة (OAuth) → طرد فوري',
              '• صلاحيات خطيرة (Administrator، Ban، Kick، Manage Roles/Channels/Webhooks...) → سحب فوري',
              '• تغيير اسم/شعار/مستوى التحقق بالسيرفر → استرجاع فوري',
            ].join('\n'),
          },
        );
      return interaction.reply(branded(embed));
    }

    if (sub === 'log-channel') {
      const channel = interaction.options.getChannel('channel');
      await db.setAntiNukeLogChannel(interaction.guildId, channel.id);
      return interaction.reply(branded(
        baseEmbed(COLOR.success).setDescription(`✅ راح ترسل تنبيهات ${BRAND} بقناة ${channel}.`)
      ));
    }

    if (sub === 'resync') {
      await interaction.reply(branded(baseEmbed(COLOR.info).setDescription('⏳ جاري أخذ نسخة احتياطية جديدة...')));
      await antiNuke.fullSnapshotGuild(interaction.guild);
      const { ephemeral, ...editPayload } = branded(
        baseEmbed(COLOR.success).setDescription('✅ تم تحديث النسخة الاحتياطية من كل القنوات والرتب الحالية.')
      );
      return interaction.editReply(editPayload);
    }

    if (sub === 'punishment') {
      const mode = interaction.options.getString('mode');
      await db.setPunishmentMode(interaction.guildId, mode);
      const label = mode === 'quarantine' ? '🔒 حجر صحي (مراجعة بشرية قبل القرار النهائي)' : '🔨 حظر مباشر فوري';
      return interaction.reply(branded(baseEmbed(COLOR.success).setDescription(`✅ وضع العقاب صار: ${label}`)));
    }

    if (sub === 'threshold') {
      const count = interaction.options.getInteger('count');
      const seconds = interaction.options.getInteger('seconds');
      await db.setAntiNukeThreshold(interaction.guildId, count, seconds);
      return interaction.reply(branded(
        baseEmbed(COLOR.success).setDescription(`⚡ العتبة الجديدة: **${count}** عمليات مشبوهة خلال **${seconds}** ثانية.`)
      ));
    }

    if (sub === 'logs') {
      const logs = await db.listAntiNukeIncidents(interaction.guildId, 10);
      if (!logs.length) {
        return interaction.reply(branded(baseEmbed(COLOR.info).setDescription('📭 ماكو أي حوادث مسجلة لهذا السيرفر — كل شي هادئ 🎉')));
      }

      const ACTION_LABELS = { banned: '🔨 تم الحظر', ban_failed: '⚠️ فشل الحظر', unknown_no_ban: '❓ فاعل مجهول' };
      const lines = logs.map((l) => {
        const kindsAr = l.kinds.split(',').join('، ');
        return `**<@${l.executor_id}>** — ${kindsAr} (×${l.action_count}) — ${ACTION_LABELS[l.action_taken] ?? l.action_taken} — <t:${l.ts}:R>`;
      });

      const embed = baseEmbed(COLOR.info).setTitle('📋 آخر الحوادث المسجلة').setDescription(lines.join('\n\n'));
      return interaction.reply(branded(embed));
    }
  },
};
