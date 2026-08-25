const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { isOwner, sendLog } = require('../utils');

const TYPE_AR = { add: 'إضافة', deduct: 'خصم', set: 'تعيين', reset: 'تصفير' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('حذف_سجل')
    .setDescription('حذف عملية خاطئة من السجل وعكس أثرها (للمالك فقط)')
    .addIntegerOption(o => o.setName('رقم_العملية').setDescription('ID العملية (يظهر في أمر /سجل)').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ content: '❌ هذا الأمر للمالك فقط.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const txId = interaction.options.getInteger('رقم_العملية');
    const tx   = await db.deleteTransaction(txId, interaction.guildId);

    if (!tx) {
      return interaction.editReply(`❌ لم يتم العثور على عملية برقم \`${txId}\` في هذا الخادم.`);
    }

    const newTotal = await db.getPoints(tx.user_id, interaction.guildId);
    const embed = new EmbedBuilder()
      .setColor(0x9E9E9E)
      .setTitle('🗑️ تم حذف العملية')
      .addFields(
        { name: '🔢 رقم العملية', value: `\`${txId}\``,                        inline: true  },
        { name: '📌 النوع',        value: TYPE_AR[tx.type] ?? tx.type,           inline: true  },
        { name: '👤 العضو',        value: `<@${tx.user_id}>`,                    inline: true  },
        { name: '📊 النقاط المعكوسة', value: `\`${tx.points}\``,               inline: true  },
        { name: '🏆 المجموع الجديد', value: `\`${newTotal}\``,                  inline: true  },
        { name: '📝 السبب الأصلي', value: tx.reason,                            inline: false },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Log the deletion
    try {
      const targetUser = await interaction.client.users.fetch(tx.user_id);
      await sendLog(interaction.guild, settings, {
        type: 'reset',
        targetUser,
        points: tx.points,
        reason: `حذف عملية #${txId}: ${tx.reason}`,
        newTotal,
        executorTag: interaction.user.tag,
        executorId:  interaction.user.id,
      });
    } catch {}
  },
};
