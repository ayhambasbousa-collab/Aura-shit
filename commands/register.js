const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { canAddPoints, sendLog, checkPromotion } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('تسجيل')
    .setDescription('إضافة نقاط لعضو في الإدارة')
    .addUserOption(o => o.setName('العضو').setDescription('العضو').setRequired(true))
    .addIntegerOption(o => o.setName('النقاط').setDescription('عدد النقاط').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('السبب').setDescription('سبب الإضافة').setRequired(true)),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!canAddPoints(interaction.member, settings)) {
      return interaction.reply({ content: '❌ ليس لديك صلاحية استخدام هذا الأمر.', ephemeral: true });
    }

    await interaction.deferReply();
    const targetUser = interaction.options.getUser('العضو');
    const points     = interaction.options.getInteger('النقاط');
    const reason     = interaction.options.getString('السبب');
    const prevTotal  = await db.getPoints(targetUser.id, interaction.guildId);
    const newTotal   = await db.addPoints(targetUser.id, interaction.guildId, points, reason, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x00C853)
      .setTitle('✅ تم تسجيل النقاط')
      .addFields(
        { name: '👤 العضو',          value: `<@${targetUser.id}>`,       inline: true  },
        { name: '➕ النقاط المضافة', value: `\`+${points}\``,             inline: true  },
        { name: '🏆 المجموع الكلي',  value: `\`${newTotal}\``,            inline: true  },
        { name: '📝 السبب',          value: reason,                       inline: false },
        { name: '👮 سُجّل بواسطة',   value: `<@${interaction.user.id}>`, inline: false },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    await sendLog(interaction.guild, settings, {
      type: 'add', targetUser, points, reason, newTotal,
      executorTag: interaction.user.tag, executorId: interaction.user.id,
    });
    await checkPromotion(interaction, targetUser, newTotal, prevTotal, settings);
  },
};
