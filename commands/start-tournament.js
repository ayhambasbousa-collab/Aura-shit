const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const { isOwner } = require('../utils');
const tm = require('../tournamentManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('start-tournament')
    .setDescription('بدء بطولة الأسئلة بهذه القناة (إدارة فقط)'),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ content: '❌ هذا الأمر للإدارة فقط.', ephemeral: true });
    }

    await interaction.reply({ content: '🏆 يتم تجهيز البطولة...', ephemeral: true });

    const result = await tm.start(
      interaction.guildId,
      interaction.channelId,
      interaction.user.id,
      interaction.client
    );

    if (!result.ok) {
      const messages = {
        already_running: '❌ فيه بطولة شغالة أصلاً بهذا السيرفر.',
        channel_not_found: '❌ تعذر الوصول لهذه القناة.',
        invalid_channel_type: '❌ هذا الأمر لازم يُستخدم بقناة نصية عادية (مو ثريد أو قناة صوتية).',
        missing_permissions:
          '❌ البوت ما يملك صلاحية **Manage Roles** بهذه القناة، وهي لازمة لقفل/فتح الشات تلقائيًا.\n' +
          'روح لإعدادات القناة ← Permissions ← فعّل Manage Roles لرتبة البوت، وحاول مرة ثانية.',
      };
      return interaction.editReply(messages[result.reason] || '❌ تعذر بدء البطولة.');
    }

    await interaction.editReply('🏆 **بدأت بطولة أورا الكبرى!** بالتوفيق للجميع 🔥');
  },
};
