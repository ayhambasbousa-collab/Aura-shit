// oracleManager.js
// Aura Oracle — تقييم خطورة استباقي: يحسب "درجة خطورة" لأي عضو بناءً على إشارات
// متاحة (عمر الحساب، متى انضم، هل عنده صورة، هل يحمل صلاحيات خطيرة) — حماية
// استباقية تنبهك قبل ما يصير أي ضرر، مو بس رد فعل بعده.

const { PermissionsBitField } = require('discord.js');

const DANGEROUS_FLAGS = [
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageWebhooks,
];

const DAY_MS = 24 * 60 * 60 * 1000;

function hasDangerousPermissions(member) {
  return DANGEROUS_FLAGS.some((flag) => member.permissions.has(flag));
}

function calculateRisk(member) {
  const now = Date.now();
  const accountAgeMs = now - member.user.createdTimestamp;
  const joinedAgeMs = member.joinedTimestamp ? now - member.joinedTimestamp : null;
  const dangerous = hasDangerousPermissions(member);

  const signals = [];
  let score = 0;

  if (accountAgeMs < 7 * DAY_MS) {
    score += 40;
    signals.push('🆕 حساب عمره أقل من أسبوع');
  } else if (accountAgeMs < 30 * DAY_MS) {
    score += 20;
    signals.push('🆕 حساب عمره أقل من شهر');
  }

  if (joinedAgeMs !== null && joinedAgeMs < DAY_MS && dangerous) {
    score += 30;
    signals.push('⚡ انضم للسيرفر خلال آخر 24 ساعة ويحمل صلاحيات خطيرة');
  }

  if (member.user.avatar === null) {
    score += 10;
    signals.push('🖼️ ما عنده صورة شخصية (افتراضية)');
  }

  if (dangerous) {
    score += 15;
    signals.push('🔑 يحمل صلاحية خطيرة واحدة على الأقل');
  }

  const level = score >= 51 ? 'high' : score >= 21 ? 'medium' : 'low';
  return { score, level, signals, accountAgeMs, joinedAgeMs, dangerous };
}

const LEVEL_LABELS = { low: '🟢 منخفضة', medium: '🟡 متوسطة', high: '🔴 عالية' };
const LEVEL_COLORS = { low: 0x2ECC71, medium: 0xF39C12, high: 0xE74C3C };

// يفحص كل الأعضاء اللي يحملون صلاحيات خطيرة بالسيرفر، مرتبين من الأخطر
async function scanGuild(guild) {
  await guild.members.fetch(); // نضمن الكاش محدث
  const results = [];
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    if (!hasDangerousPermissions(member)) continue;
    results.push({ member, risk: calculateRisk(member) });
  }
  return results.sort((a, b) => b.risk.score - a.risk.score);
}

module.exports = {
  calculateRisk,
  hasDangerousPermissions,
  scanGuild,
  LEVEL_LABELS,
  LEVEL_COLORS,
};
