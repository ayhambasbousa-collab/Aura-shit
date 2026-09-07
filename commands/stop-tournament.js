const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const { isOwner } = require('../utils');
const tm = require('../tournamentManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop-tournament')
    .setDescription('إيقاف البطولة الحالية (إدارة فقط)'),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ content: '❌ هذا الأمر للإدارة فقط.', ephemeral: true });
    }

    const ok = await tm.stopTournament(interaction.guildId, interaction.client);
    await interaction.reply(ok ? '🛑 تم إيقاف البطولة وفتح القناة.' : '❌ لا توجد بطولة نشطة حالياً.');
  },
};
