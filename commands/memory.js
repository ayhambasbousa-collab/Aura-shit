const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { isOwner } = require('../utils');
const memoryManager = require('../memoryManager');

const SYSTEM_NAME = 'Aura Hope';

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setAuthor({ name: `🧠 ${SYSTEM_NAME} — Aura Memory` }).setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('memory')
    .setDescription('آلة الزمن — لقطات تاريخية لهيكل السيرفر (إدارة فقط)')
    .addSubcommand((sub) => sub
      .setName('snapshot')
      .setDescription('خذ لقطة الآن')
      .addStringOption((opt) => opt.setName('label').setDescription('وصف مختصر (اختياري)').setRequired(false)))
    .addSubcommand((sub) => sub.setName('list').setDescription('اعرض آخر اللقطات المحفوظة'))
    .addSubcommand((sub) => sub
      .setName('diff')
      .setDescription('قارن بين لقطتين')
      .addIntegerOption((opt) => opt.setName('a').setDescription('رقم اللقطة الأولى').setRequired(true))
      .addIntegerOption((opt) => opt.setName('b').setDescription('رقم اللقطة الثانية').setRequired(true))),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ embeds: [baseEmbed(0xE74C3C).setDescription('❌ هذا الأمر للإدارة فقط.')], ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'snapshot') {
      const label = interaction.options.getString('label') || '';
      await interaction.reply({ embeds: [baseEmbed(0x5865F2).setDescription('⏳ جاري أخذ اللقطة...')], ephemeral: true });
      const snap = await memoryManager.takeSnapshot(interaction.guild, label);
      return interaction.editReply({
        embeds: [baseEmbed(0x2ECC71).setDescription(`✅ تم حفظ اللقطة \`#${snap.id}\`${label ? ` — "${label}"` : ''}`)],
      });
    }

    if (sub === 'list') {
      const list = await memoryManager.listSnapshots(interaction.guildId, 15);
      if (!list.length) {
        return interaction.reply({ embeds: [baseEmbed(0x5865F2).setDescription('📭 ماكو أي لقطات محفوظة بعد. استخدم `/memory snapshot`.')], ephemeral: true });
      }
      const lines = list.map((s) => `\`#${s.id}\` <t:${s.taken_at}:f>${s.label ? ` — "${s.label}"` : ''}`);
      return interaction.reply({ embeds: [baseEmbed(0x5865F2).setTitle('🧠 اللقطات المحفوظة').setDescription(lines.join('\n'))], ephemeral: true });
    }

    if (sub === 'diff') {
      const a = interaction.options.getInteger('a');
      const b = interaction.options.getInteger('b');
      const result = await memoryManager.compareSnapshots(interaction.guildId, a, b);
      if (!result) {
        return interaction.reply({ embeds: [baseEmbed(0xE74C3C).setDescription('❌ ما لقيت وحدة من اللقطتين أو الاثنتين.')], ephemeral: true });
      }
      const summary = memoryManager.formatDiffSummary(result.diff);
      const embed = baseEmbed(0x5865F2)
        .setTitle('🧠 مقارنة اللقطات')
        .setDescription(`من <t:${result.older.taken_at}:f> إلى <t:${result.newer.taken_at}:f>\n\n${summary}`);
      return interaction.reply({ embeds: [embed] });
    }
  },
};
