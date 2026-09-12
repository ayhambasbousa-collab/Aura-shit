const { SlashCommandBuilder } = require('discord.js');
const db = require('../database');
const { isOwner } = require('../utils');
const { normalizeEmojiInput } = require('../reactionRoleManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reaction-role')
    .setDescription('إدارة نظام الرتب عبر الرياكت (إدارة فقط)')
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('اربط إيموجي على رسالة معينة برتبة — يجب تنفيذ الأمر بنفس القناة اللي فيها الرسالة')
      .addStringOption((opt) => opt.setName('message_id').setDescription('آيدي الرسالة').setRequired(true))
      .addStringOption((opt) => opt.setName('emoji').setDescription('الإيموجي (عادي أو مخصص بالسيرفر)').setRequired(true))
      .addRoleOption((opt) => opt.setName('role').setDescription('الرتبة اللي بتنعطى').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('احذف ربط رياكت-رتبة')
      .addStringOption((opt) => opt.setName('message_id').setDescription('آيدي الرسالة').setRequired(true))
      .addStringOption((opt) => opt.setName('emoji').setDescription('الإيموجي').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('اعرض كل روابط الرياكت-رتبة بهذا السيرفر')),

  async execute(interaction) {
    const settings = await db.getGuildSettings(interaction.guildId);
    if (!isOwner(interaction.member, settings)) {
      return interaction.reply({ content: '❌ هذا الأمر للإدارة فقط.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const messageId = interaction.options.getString('message_id');
      const emojiRaw = interaction.options.getString('emoji');
      const role = interaction.options.getRole('role');

      let message;
      try {
        message = await interaction.channel.messages.fetch(messageId);
      } catch {
        return interaction.reply({
          content: '❌ ما لقيت هذي الرسالة بهذي القناة. تأكد إنك تنفّذ الأمر بنفس الروم اللي فيها الرسالة، وإن الآيدي صحيح.',
          ephemeral: true,
        });
      }

      let reaction;
      try {
        reaction = await message.react(emojiRaw);
      } catch {
        return interaction.reply({
          content: '❌ الإيموجي غير صالح، أو البوت ما يملك صلاحية Add Reactions بهذي القناة.',
          ephemeral: true,
        });
      }

      const { key, label } = normalizeEmojiInput(emojiRaw);
      await db.addReactionRole(interaction.guildId, interaction.channelId, messageId, key, label, role.id);

      // نطبّق الرتبة رجعيًا على أي عضو كان حاط نفس الرياكت من قبل الربط
      let addedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      try {
        const reactedUsers = await reaction.users.fetch();
        for (const [, reactedUser] of reactedUsers) {
          if (reactedUser.bot) continue; // نتجاهل رياكت البوت نفسه
          try {
            const member = await interaction.guild.members.fetch(reactedUser.id);
            if (member.roles.cache.has(role.id)) {
              skippedCount++; // عنده الرتبة أصلاً، نتجاهله
              continue;
            }
            await member.roles.add(role.id);
            addedCount++;
          } catch {
            failedCount++; // يمكن الرتبة أعلى من رتبة البوت أو عضو غادر
          }
        }
      } catch (err) {
        console.error('❌ فشل التطبيق الرجعي لرتبة الرياكت:', err.message);
      }

      const extra = [];
      if (addedCount) extra.push(`تم إعطاء الرتبة رجعيًا لـ **${addedCount}** عضو كانوا حاطين الرياكت من قبل`);
      if (skippedCount) extra.push(`تجاهلت **${skippedCount}** عضو عندهم الرتبة أصلاً`);
      if (failedCount) extra.push(`تعذر إعطاؤها لـ **${failedCount}** عضو (يمكن الرتبة أعلى من رتبة البوت)`);

      await interaction.reply({
        content: [
          `✅ تم الربط! أي عضو يحط ${label} على الرسالة بياخذ رتبة ${role} تلقائيًا (وتنحذف لو شال الرياكت).`,
          ...(extra.length ? ['', ...extra.map((l) => `• ${l}`)] : []),
        ].join('\n'),
        ephemeral: true,
      });
      return;
    }

    if (sub === 'remove') {
      const messageId = interaction.options.getString('message_id');
      const emojiRaw = interaction.options.getString('emoji');
      const { key } = normalizeEmojiInput(emojiRaw);

      const removed = await db.removeReactionRole(messageId, key);
      await interaction.reply({
        content: removed ? '🗑️ تم حذف الربط.' : '❌ ما لقيت هذا الربط أصلاً.',
        ephemeral: true,
      });
      return;
    }

    if (sub === 'list') {
      const list = await db.listReactionRoles(interaction.guildId);
      if (!list.length) {
        return interaction.reply({ content: 'ماكو أي روابط رياكت-رتبة بهذا السيرفر حاليًا.', ephemeral: true });
      }

      const lines = list.map(
        (r) => `• <#${r.channel_id}> — رسالة \`${r.message_id}\` — ${r.emoji_label} → <@&${r.role_id}>`
      );
      await interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
  },
};
