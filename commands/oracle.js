const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { isOwner } = require('../utils');
const oracleManager = require('../oracleManager');

const SYSTEM_NAME = 'Aura Hope';

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setAuthor({ name: `🔮 ${SYSTEM_NAME} — Aura Oracle` }).setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('oracle')
    .setDescription('تقييم خطورة استباقي للأعضاء (إدارة فقط)')
    .addSubcommand((sub) => sub
      .setName('check')
      .setDescription('افحص خطورة عضو معين')
      .addUserOption((opt) => opt.setName('user').setDescription('العضو').setRequired(true)))
    .addSubcommand((sub) => sub.setName('scan').setDescription('افحص كل الأعضاء اللي يحملون صلاحيات خطيرة')),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ embeds: [baseEmbed(0xE74C3C).setDescription('❌ هذا الأمر للإدارة فقط.')], ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'check') {
      const user = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) {
        return interaction.reply({ embeds: [baseEmbed(0xE74C3C).setDescription('❌ ما لقيت هذا العضو بالسيرفر.')], ephemeral: true });
      }

      const risk = oracleManager.calculateRisk(member);
      const embed = baseEmbed(oracleManager.LEVEL_COLORS[risk.level])
        .setTitle(`🔮 تقييم خطورة ${user.username}`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: '📊 درجة الخطورة', value: `${oracleManager.LEVEL_LABELS[risk.level]} (\`${risk.score}\`)`, inline: true },
          { name: '📅 عمر الحساب', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '📥 انضم للسيرفر', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'غير معروف', inline: true },
          { name: '🚩 الإشارات المرصودة', value: risk.signals.length ? risk.signals.join('\n') : 'ماكو أي إشارة خطر — كل شي طبيعي ✅' },
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'scan') {
      await interaction.reply({ embeds: [baseEmbed(0x5865F2).setDescription('⏳ جاري فحص كل الأعضاء اللي يحملون صلاحيات خطيرة...')], ephemeral: true });

      const results = await oracleManager.scanGuild(interaction.guild);
      if (!results.length) {
        return interaction.editReply({ embeds: [baseEmbed(0x2ECC71).setDescription('✅ ماكو أي عضو (غير المالك) يحمل صلاحيات خطيرة حاليًا.')] });
      }

      const lines = results.slice(0, 15).map(
        ({ member, risk }) => `${oracleManager.LEVEL_LABELS[risk.level]} **${member.user.username}** — \`${risk.score}\` نقطة خطر`
      );

      const embed = baseEmbed(0x5865F2)
        .setTitle('🔮 فحص شامل — أصحاب الصلاحيات الخطيرة')
        .setDescription(lines.join('\n'))
        .setFooter({ text: `إجمالي: ${results.length} عضو` });

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
