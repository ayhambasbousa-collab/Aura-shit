const { EmbedBuilder } = require('discord.js');
const db = require('./database');

// ─── Roles ────────────────────────────────────────────────────────────────────

function parseRoleNames(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

function hasAnyRole(member, roleIdsStr) {
  const ids = parseRoleNames(roleIdsStr);
  if (!ids.length) return false;
  return member.roles.cache.some(r => ids.includes(r.id));
}

function isOwner(member, settings) {
  return hasAnyRole(member, settings.owner_roles);
}

function canAddPoints(member, settings) {
  if (isOwner(member, settings)) return true;
  return hasAnyRole(member, settings.staff_roles);
}

// ─── Logging ──────────────────────────────────────────────────────────────────

const TYPE_COLOR = {
  add: 0x00C853,
  deduct: 0xD32F2F,
  set: 0xFFA000,
  reset: 0x607D8B
};

const TYPE_SIGN = {
  add: '+',
  deduct: '-',
  set: '=',
  reset: '↩'
};

const TYPE_LABEL = {
  add: 'إضافة نقاط',
  deduct: 'خصم نقاط',
  set: 'تعيين نقاط',
  reset: 'تصفير نقاط'
};

async function sendLog(guild, settings, data, forcedChannelId = null) {
  const channelId = forcedChannelId || settings.log_channel_id;
  if (!channelId) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(TYPE_COLOR[data.type] ?? 0x5865F2)
    .setTitle(`📋 سجل: ${TYPE_LABEL[data.type] ?? data.type}`)
    .addFields(
      {
        name: '👤 العضو',
        value: `<@${data.targetUser.id}>`,
        inline: true
      },
      {
        name: '📊 التغيير',
        value: `\`${TYPE_SIGN[data.type] ?? ''}${data.points}\``,
        inline: true
      },
      {
        name: '🏆 المجموع الجديد',
        value: `\`${data.newTotal}\``,
        inline: true
      },
      {
        name: '📝 السبب',
        value: data.reason || '—',
        inline: false
      },
      {
        name: '👮 بواسطة',
        value: `${data.executorTag} (<@${data.executorId}>)`,
        inline: false
      }
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

// ─── Promotion checks ─────────────────────────────────────────────────────────

async function checkPromotion(interaction, targetUser, newTotal, prevTotal, settings) {
  const threshold = settings.promotion_threshold;
  const pct = (newTotal / threshold) * 100;
  const prevPct = (prevTotal / threshold) * 100;

  if (newTotal >= threshold && prevTotal < threshold) {
    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle('🎉 مبروك! أصبح مؤهلاً للترقية')
      .setDescription(`<@${targetUser.id}> وصل إلى **${newTotal} نقطة** وأصبح مؤهلاً للترقية! 🏆`)
      .setTimestamp();

    return interaction.channel.send({ embeds: [embed] }).catch(() => {});
  }

  if (pct >= 80 && prevPct < 80 && newTotal < threshold) {
    const embed = new EmbedBuilder()
      .setColor(0xFF9800)
      .setTitle('⚠️ اقترب من الترقية!')
      .setDescription(`<@${targetUser.id}> وصل إلى **${newTotal} نقطة** — بقي **${threshold - newTotal}** للترقية!`)
      .setTimestamp();

    return interaction.channel.send({ embeds: [embed] }).catch(() => {});
  }
}

// ─── Reports ──────────────────────────────────────────────────────────────────

async function buildReportEmbed(guild, settings, since, periodLabel) {
  const stats = await db.getGuildStats(guild.id, since);
  const leaderboard = await db.getLeaderboard(guild.id, 5);
  const MEDALS = ['🥇', '🥈', '🥉'];

  const lines = await Promise.all(
    leaderboard.map(async (row, i) => {
      let name;

      try {
        name = (await guild.members.fetch(row.user_id)).user.username;
      } catch {
        name = `<@${row.user_id}>`;
      }

      return `${MEDALS[i] ?? `#${i + 1}`} **${name}** — \`${row.total_points}\``;
    })
  );

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📊 التقرير ${periodLabel}`)
    .addFields(
      {
        name: '➕ عمليات الإضافة',
        value: `\`${stats.add_count}\` (${stats.total_added} نقطة)`,
        inline: true
      },
      {
        name: '➖ عمليات الخصم',
        value: `\`${stats.deduct_count}\` (${stats.total_deducted} نقطة)`,
        inline: true
      },
      {
        name: '👥 أعضاء نشطون',
        value: `\`${stats.unique_members}\``,
        inline: true
      },
      {
        name: '🏆 أفضل 5 أعضاء',
        value: lines.length ? lines.join('\n') : 'لا توجد بيانات',
        inline: false
      }
    )
    .setTimestamp();
}

module.exports = {
  canAddPoints,
  isOwner,
  sendLog,
  checkPromotion,
  buildReportEmbed
};
