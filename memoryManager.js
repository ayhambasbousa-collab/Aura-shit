// memoryManager.js
// Aura Memory — آلة الزمن: يحفظ لقطة كاملة لهيكل السيرفر (قنوات + رتب) بأي لحظة،
// وتقدر تقارن بين أي لقطتين وتشوف بالضبط شنو تغيّر — زي git diff لسيرفرك.

const db = require('./database');

function buildSnapshotData(guild) {
  const channels = [...guild.channels.cache.values()].map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    parentId: c.parentId ?? null,
  }));

  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id) // نتجاهل @everyone
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      permissions: r.permissions.bitfield.toString(),
    }));

  return { channels, roles, memberCount: guild.memberCount, guildName: guild.name };
}

async function takeSnapshot(guild, label = '') {
  const data = buildSnapshotData(guild);
  return db.saveMemorySnapshot(guild.id, label, data);
}

async function listSnapshots(guildId, limit = 15) {
  return db.listMemorySnapshots(guildId, limit);
}

// يقارن لقطتين ويرجع التغييرات: قنوات/رتب انضافت، انحذفت، أو تغيّر اسمها
function diffSnapshots(oldData, newData) {
  const oldChannels = new Map(oldData.channels.map((c) => [c.id, c]));
  const newChannels = new Map(newData.channels.map((c) => [c.id, c]));
  const oldRoles = new Map(oldData.roles.map((r) => [r.id, r]));
  const newRoles = new Map(newData.roles.map((r) => [r.id, r]));

  const channelsAdded = [...newChannels.values()].filter((c) => !oldChannels.has(c.id));
  const channelsRemoved = [...oldChannels.values()].filter((c) => !newChannels.has(c.id));
  const channelsRenamed = [...newChannels.values()].filter((c) => {
    const old = oldChannels.get(c.id);
    return old && old.name !== c.name;
  }).map((c) => ({ id: c.id, from: oldChannels.get(c.id).name, to: c.name }));

  const rolesAdded = [...newRoles.values()].filter((r) => !oldRoles.has(r.id));
  const rolesRemoved = [...oldRoles.values()].filter((r) => !newRoles.has(r.id));
  const rolesPermChanged = [...newRoles.values()].filter((r) => {
    const old = oldRoles.get(r.id);
    return old && old.permissions !== r.permissions;
  }).map((r) => ({ id: r.id, name: r.name }));

  const memberCountDiff = (newData.memberCount ?? 0) - (oldData.memberCount ?? 0);

  return {
    channelsAdded, channelsRemoved, channelsRenamed,
    rolesAdded, rolesRemoved, rolesPermChanged,
    memberCountDiff,
    nameChanged: oldData.guildName !== newData.guildName ? { from: oldData.guildName, to: newData.guildName } : null,
  };
}

async function compareSnapshots(guildId, idA, idB) {
  const [snapA, snapB] = await Promise.all([
    db.getMemorySnapshot(idA, guildId),
    db.getMemorySnapshot(idB, guildId),
  ]);
  if (!snapA || !snapB) return null;

  // نرتب زمنيًا (الأقدم أول) بغض النظر عن ترتيب الإدخال
  const [older, newer] = snapA.taken_at <= snapB.taken_at ? [snapA, snapB] : [snapB, snapA];
  const diff = diffSnapshots(older.snapshot_data, newer.snapshot_data);
  return { older, newer, diff };
}

function formatDiffSummary(diff) {
  const lines = [];
  if (diff.nameChanged) lines.push(`🎭 اسم السيرفر: **${diff.nameChanged.from}** ← **${diff.nameChanged.to}**`);
  if (diff.memberCountDiff !== 0) lines.push(`👥 عدد الأعضاء: ${diff.memberCountDiff > 0 ? '+' : ''}${diff.memberCountDiff}`);

  if (diff.channelsAdded.length) lines.push(`➕ قنوات جديدة: ${diff.channelsAdded.map((c) => `#${c.name}`).join('، ')}`);
  if (diff.channelsRemoved.length) lines.push(`➖ قنوات محذوفة: ${diff.channelsRemoved.map((c) => `#${c.name}`).join('، ')}`);
  if (diff.channelsRenamed.length) lines.push(`✏️ قنوات تغيّر اسمها: ${diff.channelsRenamed.map((c) => `${c.from}→${c.to}`).join('، ')}`);

  if (diff.rolesAdded.length) lines.push(`➕ رتب جديدة: ${diff.rolesAdded.map((r) => r.name).join('، ')}`);
  if (diff.rolesRemoved.length) lines.push(`➖ رتب محذوفة: ${diff.rolesRemoved.map((r) => r.name).join('، ')}`);
  if (diff.rolesPermChanged.length) lines.push(`🔑 صلاحيات تغيّرت: ${diff.rolesPermChanged.map((r) => r.name).join('، ')}`);

  return lines.length ? lines.join('\n') : 'ماكو أي فرق ملحوظ بين اللقطتين. 🎉';
}

module.exports = {
  takeSnapshot,
  listSnapshots,
  compareSnapshots,
  diffSnapshots,
  formatDiffSummary,
};
