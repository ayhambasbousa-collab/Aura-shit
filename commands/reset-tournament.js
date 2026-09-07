const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const { isOwner } = require('../utils');
const tm = require('../tournamentManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reset-tournament')
    .setDescription('إعادة ضبط البطولة (إدارة فقط)'),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ content: '❌ هذا الأمر للإدارة فقط.', ephemeral: true });
    }

    const ok = await tm.resetTournament(interaction.guildId, interaction.client);
    await interaction.reply(ok ? '♻️ تم إعادة ضبط البطولة وفتح القناة.' : '❌ لا توجد بطولة لإعادة ضبطها.');
  },
};
