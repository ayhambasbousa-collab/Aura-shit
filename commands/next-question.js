const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const { isOwner } = require('../utils');
const tm = require('../tournamentManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('next-question')
    .setDescription('الانتقال للسؤال التالي يدويًا (إدارة فقط)'),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ content: '❌ هذا الأمر للإدارة فقط.', ephemeral: true });
    }

    if (!tm.getState(interaction.guildId)) {
      return interaction.reply({ content: '❌ لا توجد بطولة نشطة حالياً.', ephemeral: true });
    }

    const result = await tm.advanceManual(interaction.guildId, interaction.client);
    if (!result.ok) {
      const messages = {
        no_active_question: '❌ لا يوجد سؤال مفتوح حاليًا للتخطي (يمكن نحن بمنتصف العد التنازلي).',
        already_closed: '❌ السؤال الحالي مغلق بالفعل.',
      };
      return interaction.reply({ content: messages[result.reason] || '❌ تعذر التنفيذ.', ephemeral: true });
    }

    await interaction.reply({ content: '⏭️ تم تخطي السؤال والانتقال للتالي.', ephemeral: true });
  },
};
