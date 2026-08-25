const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { sendLog } = require('../utils');

const REQUIRED_ROLE_ID = '1509317185770750092';
const LOG_CHANNEL_ID = '1502301779705204926';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('خصم')
    .setDescription('خصم نقاط من عضو في الإدارة (للمالك فقط)')
    .addUserOption(o => o.setName('العضو').setDescription('العضو').setRequired(true))
    .addIntegerOption(o => o.setName('النقاط').setDescription('عدد النقاط').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('السبب').setDescription('سبب الخصم').setRequired(true)),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    const ownerRoles = settings.owner_roles?.split(',') || [];

if (!interaction.member.roles.cache.some(role => ownerRoles.includes(role.id))) {
  return interaction.reply({
    content: '❌ هذا الأمر متاح فقط لذوي رتبة المالك.',
    ephemeral: true
  });
}
    

    await interaction.deferReply();
    const targetUser = interaction.options.getUser('العضو');
    const points     = interaction.options.getInteger('النقاط');
    const reason     = interaction.options.getString('السبب');
    const newTotal   = await db.deductPoints(targetUser.id, interaction.guildId, points, reason, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(0xD32F2F)
      .setTitle('➖ تم خصم النقاط')
      .addFields(
        { name: '👤 العضو',           value: `<@${targetUser.id}>`,       inline: true  },
        { name: '➖ النقاط المخصومة', value: `\`-${points}\``,             inline: true  },
        { name: '🏆 المجموع الكلي',   value: `\`${newTotal}\``,            inline: true  },
        { name: '📝 السبب',           value: reason,                       inline: false },
        { name: '👮 خُصم بواسطة',     value: `<@${interaction.user.id}>`,  inline: false },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    await sendLog(interaction.guild, settings, {
      type: 'deduct', targetUser, points, reason, newTotal,
      executorTag: interaction.user.tag, executorId: interaction.user.id,
    }, LOG_CHANNEL_ID);
  },
};
