const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database');
const { isOwner, sendLog } = require('../utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('تصفير')
    .setDescription('إعادة تعيين نقاط عضو إلى صفر (للمالك فقط)')
    .addUserOption(o => o.setName('العضو').setDescription('العضو').setRequired(true)),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ content: '❌ هذا الأمر للمالك فقط.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('العضو');
    const current    = await db.getPoints(targetUser.id, interaction.guildId);

    const confirmId = `reset_confirm_${interaction.user.id}_${targetUser.id}`;
    const cancelId  = `reset_cancel_${interaction.user.id}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel('✅ نعم، صفّر النقاط').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel('❌ إلغاء').setStyle(ButtonStyle.Secondary),
    );

    const embed = new EmbedBuilder()
      .setColor(0xFF5722)
      .setTitle('⚠️ تأكيد التصفير')
      .setDescription(
        `هل أنت متأكد من تصفير نقاط <@${targetUser.id}>؟\n` +
        `سيتم حذف **${current}** نقطة بشكل نهائي.`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

    // Collect button response (60 seconds)
    const filter = i => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId);
    try {
      const btn = await interaction.channel.awaitMessageComponent({ filter, time: 60_000 });
      if (btn.customId === cancelId) {
        return btn.update({ content: '❌ تم إلغاء التصفير.', embeds: [], components: [] });
      }

      await btn.deferUpdate();
      await db.resetPoints(targetUser.id, interaction.guildId, interaction.user.id);

      const done = new EmbedBuilder()
        .setColor(0x607D8B)
        .setTitle('🔄 تم التصفير')
        .addFields(
          { name: '👤 العضو',     value: `<@${targetUser.id}>`,       inline: true  },
          { name: '📊 النقاط',    value: `\`${current} → 0\``,         inline: true  },
          { name: '👮 بواسطة',    value: `<@${interaction.user.id}>`, inline: false },
        )
        .setTimestamp();

      await btn.editReply({ embeds: [done], components: [] });
      await sendLog(interaction.guild, settings, {
        type: 'reset', targetUser, points: current, reason: 'تصفير النقاط', newTotal: 0,
        executorTag: interaction.user.tag, executorId: interaction.user.id,
      });
    } catch {
      await interaction.editReply({ content: '⏱️ انتهى وقت التأكيد.', embeds: [], components: [] });
    }
  },
};
