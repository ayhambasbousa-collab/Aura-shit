const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');
const { isOwner } = require('../utils');
const quarantineManager = require('../quarantineManager');

const BRAND = 'Absolute Aura Protect';
const SYSTEM_NAME = 'Aura Hope';

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setAuthor({ name: `🔒 ${SYSTEM_NAME} — Aura Quarantine` }).setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quarantine')
    .setDescription('إدارة الحجر الصحي — عزل بدل حظر (إدارة فقط)')
    .addSubcommand((sub) => sub
      .setName('put')
      .setDescription('احجر عضو يدويًا')
      .addUserOption((opt) => opt.setName('user').setDescription('العضو').setRequired(true))
      .addStringOption((opt) => opt.setName('reason').setDescription('السبب').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('release')
      .setDescription('حرر عضو من الحجر الصحي (يرجعله رتبه الأصلية)')
      .addIntegerOption((opt) => opt.setName('id').setDescription('رقم الحالة').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('ban')
      .setDescription('حوّل حالة حجر لحظر نهائي بعد المراجعة')
      .addIntegerOption((opt) => opt.setName('id').setDescription('رقم الحالة').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('اعرض كل الحالات المحجوزة حاليًا')),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ embeds: [baseEmbed(0xE74C3C).setDescription('❌ هذا الأمر للإدارة فقط.')], ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'put') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      await interaction.reply({ embeds: [baseEmbed(0x5865F2).setDescription('⏳ جاري الحجر...')], ephemeral: true });
      const result = await quarantineManager.quarantineMember(interaction.guild, user.id, reason, null);
      if (!result.ok) {
        return interaction.editReply({ embeds: [baseEmbed(0xE74C3C).setDescription(`❌ فشل الحجر: ${result.reason}`)] });
      }
      return interaction.editReply({ embeds: [baseEmbed(0xF39C12).setDescription(`🔒 تم حجر ${user} — رقم الحالة: \`${result.quarantineId}\``)] });
    }

    if (sub === 'release') {
      const id = interaction.options.getInteger('id');
      const result = await quarantineManager.releaseQuarantine(interaction.guild, id);
      if (!result.ok) {
        const messages = { not_found: '❌ ما لقيت هذي الحالة.', already_released: '❌ هذي الحالة محررة أصلاً.', permission_error: '❌ تعذر إرجاع الرتب (صلاحيات).' };
        return interaction.reply({ embeds: [baseEmbed(0xE74C3C).setDescription(messages[result.reason] || '❌ تعذر التحرير.')], ephemeral: true });
      }
      return interaction.reply({ embeds: [baseEmbed(0x2ECC71).setDescription(`✅ تم تحرير <@${result.userId}> وإرجاع رتبه الأصلية.`)] });
    }

    if (sub === 'ban') {
      const id = interaction.options.getInteger('id');
      const result = await quarantineManager.convertQuarantineToBan(interaction.guild, id);
      if (!result.ok) {
        const messages = { not_found: '❌ ما لقيت هذي الحالة.', already_released: '❌ هذي الحالة محررة أصلاً.', ban_failed: '❌ فشل الحظر.' };
        return interaction.reply({ embeds: [baseEmbed(0xE74C3C).setDescription(messages[result.reason] || '❌ تعذر الحظر.')], ephemeral: true });
      }
      return interaction.reply({ embeds: [baseEmbed(0xE74C3C).setDescription(`🔨 تم تأكيد الحظر النهائي لـ <@${result.userId}>.`)] });
    }

    if (sub === 'list') {
      const list = await db.listActiveQuarantines(interaction.guildId);
      if (!list.length) {
        return interaction.reply({ embeds: [baseEmbed(0x2ECC71).setDescription('📭 ماكو أي حالات محجوزة حاليًا.')], ephemeral: true });
      }
      const lines = list.map((q) => `\`#${q.id}\` <@${q.user_id}> — ${q.reason} — <t:${q.quarantined_at}:R>`);
      return interaction.reply({ embeds: [baseEmbed(0xF39C12).setTitle('🔒 الحالات المحجوزة').setDescription(lines.join('\n'))], ephemeral: true });
    }
  },
};
