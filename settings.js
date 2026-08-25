const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../database');
const { isOwner } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('إعدادات')
    .setDescription('عرض وتعديل إعدادات البوت (للمالك فقط)')
    .addSubcommand(s => s
      .setName('عرض')
      .setDescription('عرض الإعدادات الحالية'))
    .addSubcommand(s => s
      .setName('حد_الترقية')
      .setDescription('تغيير عدد النقاط المطلوبة للترقية')
      .addIntegerOption(o => o.setName('النقاط').setDescription('العدد الجديد').setRequired(true).setMinValue(1)))
    .addSubcommand(s => s
      .setName('قناة_اللوق')
      .setDescription('تغيير قناة اللوق')
      .addChannelOption(o => o.setName('القناة').setDescription('القناة').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s
      .setName('قناة_التقارير')
      .setDescription('تغيير قناة التقارير الأسبوعية/الشهرية')
      .addChannelOption(o => o.setName('القناة').setDescription('القناة').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s
      .setName('رتب_المالك')
      .setDescription('تحديد رتبة المالك (تملك كل الصلاحيات)')
      .addRoleOption(o => o.setName('الرتبة').setDescription('اختر الرتبة').setRequired(true)))
    .addSubcommand(s => s
      .setName('رتب_الإدارة')
      .setDescription('تحديد رتبة الإدارة (تستطيع إضافة النقاط فقط)')
      .addRoleOption(o => o.setName('الرتبة').setDescription('اختر الرتبة').setRequired(true)))
    .addSubcommand(s => s
      .setName('جدول_التقارير')
      .setDescription('تعديل جدول التقارير التلقائية')
      .addStringOption(o => o.setName('النوع').setDescription('أسبوعي أو شهري').setRequired(true)
        .addChoices({ name: 'أسبوعي', value: 'weekly' }, { name: 'شهري', value: 'monthly' }))
      .addIntegerOption(o => o.setName('اليوم').setDescription('رقم اليوم (1=الإثنين للأسبوعي، 1-31 للشهري)').setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption(o => o.setName('الساعة').setDescription('الساعة (UTC) 0-23').setRequired(false).setMinValue(0).setMaxValue(23))),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ content: '❌ هذا الأمر للمالك فقط.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    // ── عرض ──────────────────────────────────────────────────────────────────
    if (sub === 'عرض') {
      const ownerRoles = settings.owner_roles || '*(غير محدد)*';
      const staffRoles = settings.staff_roles || '*(غير محدد)*';
      const logCh     = settings.log_channel_id     ? `<#${settings.log_channel_id}>`     : '*(غير محدد)*';
      const repCh     = settings.report_channel_id  ? `<#${settings.report_channel_id}>`  : '*(غير محدد)*';
      const schedule  = settings.report_schedule === 'monthly' ? 'شهري' : 'أسبوعي';
      const dayLabel  = settings.report_schedule === 'weekly'
        ? ['الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'][settings.report_day - 1] ?? settings.report_day
        : `اليوم ${settings.report_day}`;

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚙️ إعدادات البوت')
        .addFields(
          { name: '🎯 حد الترقية',        value: `\`${settings.promotion_threshold}\` نقطة`,    inline: true  },
          { name: '📋 قناة اللوق',         value: logCh,                                         inline: true  },
          { name: '📊 قناة التقارير',      value: repCh,                                         inline: true  },
          { name: '👑 رتب المالك',         value: `\`${ownerRoles}\``,                           inline: false },
          { name: '🛡️ رتب الإدارة',       value: `\`${staffRoles}\``,                           inline: false },
          { name: '🗓️ جدول التقارير',    value: `${schedule} — ${dayLabel} — الساعة \`${settings.report_hour}:00\` UTC`, inline: false },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── تعديل ─────────────────────────────────────────────────────────────────
    const messages = {
      'حد_الترقية':    async () => {
        const v = interaction.options.getInteger('النقاط');
        await db.setGuildSetting(interaction.guildId, 'promotion_threshold', v);
        return `✅ تم تغيير حد الترقية إلى **${v}** نقطة.`;
      },
      'قناة_اللوق':    async () => {
        const ch = interaction.options.getChannel('القناة');
        await db.setGuildSetting(interaction.guildId, 'log_channel_id', ch.id);
        return `✅ تم تغيير قناة اللوق إلى ${ch}.`;
      },
      'قناة_التقارير': async () => {
        const ch = interaction.options.getChannel('القناة');
        await db.setGuildSetting(interaction.guildId, 'report_channel_id', ch.id);
        return `✅ تم تغيير قناة التقارير إلى ${ch}.`;
      },
      'رتب_المالك':    async () => {
        const role = interaction.options.getRole('الرتبة');
        await db.setGuildSetting(interaction.guildId, 'owner_roles', role.id);
        return `✅ تم تحديث رتبة المالك: ${role}`;
      },
      'رتب_الإدارة':   async () => {
        const role = interaction.options.getRole('الرتبة');
        await db.setGuildSetting(interaction.guildId, 'staff_roles', role.id);
        return `✅ تم تحديث رتبة الإدارة: ${role}`;
      },
      'جدول_التقارير': async () => {
        const type = interaction.options.getString('النوع');
        const day  = interaction.options.getInteger('اليوم');
        const hour = interaction.options.getInteger('الساعة') ?? 9;
        await db.setGuildSetting(interaction.guildId, 'report_schedule', type);
        await db.setGuildSetting(interaction.guildId, 'report_day', day);
        await db.setGuildSetting(interaction.guildId, 'report_hour', hour);
        return `✅ تم ضبط التقارير: ${type === 'monthly' ? 'شهري' : 'أسبوعي'} — يوم ${day} — الساعة ${hour}:00 UTC`;
      },
    };

    await interaction.deferReply({ ephemeral: true });
    const msg = await messages[sub]?.();
    await interaction.editReply(msg ?? '❌ أمر غير معروف.');
  },
};
