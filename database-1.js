const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_members (
      user_id      TEXT NOT NULL,
      guild_id     TEXT NOT NULL,
      total_points INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS discord_transactions (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      guild_id   TEXT NOT NULL,
      points     INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      type       TEXT NOT NULL CHECK(type IN ('add', 'deduct', 'set', 'reset')),
      added_by   TEXT NOT NULL,
      ts         BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE TABLE IF NOT EXISTS discord_guild_settings (
      guild_id              TEXT PRIMARY KEY,
      log_channel_id        TEXT,
      report_channel_id     TEXT,
      promotion_threshold   INTEGER NOT NULL DEFAULT 50,
      owner_roles           TEXT NOT NULL DEFAULT '',
      staff_roles           TEXT NOT NULL DEFAULT '',
      report_schedule       TEXT NOT NULL DEFAULT 'weekly',
      report_day            INTEGER NOT NULL DEFAULT 1,
      report_hour           INTEGER NOT NULL DEFAULT 9,
      last_report_at        BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS discord_reaction_roles (
      id          SERIAL PRIMARY KEY,
      guild_id    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      emoji_key   TEXT NOT NULL,
      emoji_label TEXT NOT NULL,
      role_id     TEXT NOT NULL,
      UNIQUE(message_id, emoji_key)
    );

    CREATE TABLE IF NOT EXISTS discord_backup_channels (
      guild_id             TEXT NOT NULL,
      channel_id           TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      type                 INTEGER NOT NULL,
      position             INTEGER NOT NULL DEFAULT 0,
      parent_id            TEXT,
      topic                TEXT,
      nsfw                 BOOLEAN NOT NULL DEFAULT false,
      bitrate              INTEGER,
      user_limit           INTEGER,
      rate_limit_per_user  INTEGER,
      overwrites           JSONB NOT NULL DEFAULT '[]',
      updated_at           BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE TABLE IF NOT EXISTS discord_backup_roles (
      guild_id     TEXT NOT NULL,
      role_id      TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      color        INTEGER NOT NULL DEFAULT 0,
      hoist        BOOLEAN NOT NULL DEFAULT false,
      mentionable  BOOLEAN NOT NULL DEFAULT false,
      permissions  TEXT NOT NULL DEFAULT '0',
      position     INTEGER NOT NULL DEFAULT 0,
      updated_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE TABLE IF NOT EXISTS discord_antinuke_settings (
      guild_id           TEXT PRIMARY KEY,
      enabled            BOOLEAN NOT NULL DEFAULT true,
      threshold_count    INTEGER NOT NULL DEFAULT 3,
      threshold_seconds  INTEGER NOT NULL DEFAULT 5,
      log_channel_id     TEXT
    );

    CREATE TABLE IF NOT EXISTS discord_antinuke_whitelist (
      guild_id  TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      added_by  TEXT NOT NULL,
      added_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS discord_antinuke_logs (
      id            SERIAL PRIMARY KEY,
      guild_id      TEXT NOT NULL,
      executor_id   TEXT NOT NULL,
      kinds         TEXT NOT NULL,
      action_count  INTEGER NOT NULL,
      action_taken  TEXT NOT NULL,
      ts            BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE TABLE IF NOT EXISTS discord_quarantine (
      id               SERIAL PRIMARY KEY,
      guild_id         TEXT NOT NULL,
      user_id          TEXT NOT NULL,
      original_roles   TEXT NOT NULL,
      quarantined_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      reason           TEXT NOT NULL DEFAULT '',
      released         BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS discord_memory_snapshots (
      id            SERIAL PRIMARY KEY,
      guild_id      TEXT NOT NULL,
      taken_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      label         TEXT NOT NULL DEFAULT '',
      snapshot_data JSONB NOT NULL
    );

    ALTER TABLE discord_antinuke_settings ADD COLUMN IF NOT EXISTS punishment_mode TEXT NOT NULL DEFAULT 'ban';
    ALTER TABLE discord_antinuke_settings ADD COLUMN IF NOT EXISTS quarantine_role_id TEXT;
    ALTER TABLE discord_antinuke_settings ADD COLUMN IF NOT EXISTS quarantine_channel_id TEXT;
  `);
  console.log('✅ قاعدة البيانات جاهزة');
}

// ─── Guild Settings ───────────────────────────────────────────────────────────

async function getGuildSettings(guildId) {
  const { rows } = await pool.query(
    'SELECT * FROM discord_guild_settings WHERE guild_id = $1', [guildId]
  );
  if (rows[0]) return rows[0];

  // Fall back to env vars for first-time guilds
  return {
    guild_id:             guildId,
    log_channel_id:       process.env.LOG_CHANNEL_ID || null,
    report_channel_id:    null,
    promotion_threshold:  parseInt(process.env.PROMOTION_THRESHOLD || '50', 10),
    owner_roles:          process.env.OWNER_ROLE_ID || process.env.ALLOWED_ROLES || '',
    staff_roles:          process.env.STAFF_ROLES || '',
    report_schedule:      'weekly',
    report_day:           1,
    report_hour:          9,
    last_report_at:       0,
  };
}

async function setGuildSetting(guildId, key, value) {
  // Ensure row exists first
  await pool.query(`
    INSERT INTO discord_guild_settings (guild_id)
    VALUES ($1)
    ON CONFLICT (guild_id) DO NOTHING
  `, [guildId]);

  const allowed = [
    'log_channel_id','report_channel_id','promotion_threshold',
    'owner_roles','staff_roles','report_schedule','report_day','report_hour',
  ];
  if (!allowed.includes(key)) throw new Error(`Invalid setting key: ${key}`);

  await pool.query(
    `UPDATE discord_guild_settings SET ${key} = $1 WHERE guild_id = $2`,
    [value, guildId]
  );
}

async function updateLastReport(guildId, ts) {
  await pool.query(
    `UPDATE discord_guild_settings SET last_report_at = $1 WHERE guild_id = $2`,
    [ts, guildId]
  );
}

async function getAllGuildSettings() {
  const { rows } = await pool.query('SELECT * FROM discord_guild_settings');
  return rows;
}

// ─── Points Operations ────────────────────────────────────────────────────────

async function addPoints(userId, guildId, points, reason, addedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO discord_members (user_id, guild_id, total_points)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, guild_id)
      DO UPDATE SET total_points = discord_members.total_points + $3
    `, [userId, guildId, points]);
    await client.query(
      `INSERT INTO discord_transactions (user_id, guild_id, points, reason, type, added_by)
       VALUES ($1, $2, $3, $4, 'add', $5)`,
      [userId, guildId, points, reason, addedBy]
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  return getPoints(userId, guildId);
}

async function deductPoints(userId, guildId, points, reason, addedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO discord_members (user_id, guild_id, total_points)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, guild_id)
      DO UPDATE SET total_points = discord_members.total_points - $3
    `, [userId, guildId, points]);
    await client.query(
      `INSERT INTO discord_transactions (user_id, guild_id, points, reason, type, added_by)
       VALUES ($1, $2, $3, $4, 'deduct', $5)`,
      [userId, guildId, points, reason, addedBy]
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  return getPoints(userId, guildId);
}

async function setPoints(userId, guildId, newTotal, reason, addedBy) {
  const prev = await getPoints(userId, guildId);
  const diff = newTotal - prev;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO discord_members (user_id, guild_id, total_points)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, guild_id)
      DO UPDATE SET total_points = $3
    `, [userId, guildId, newTotal]);
    await client.query(
      `INSERT INTO discord_transactions (user_id, guild_id, points, reason, type, added_by)
       VALUES ($1, $2, $3, $4, 'set', $5)`,
      [userId, guildId, Math.abs(diff), `تعيين من ${prev} إلى ${newTotal} — ${reason}`, addedBy]
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  return newTotal;
}

async function resetPoints(userId, guildId, addedBy) {
  const prev = await getPoints(userId, guildId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE discord_members SET total_points = 0 WHERE user_id = $1 AND guild_id = $2`,
      [userId, guildId]
    );
    await client.query(
      `INSERT INTO discord_transactions (user_id, guild_id, points, reason, type, added_by)
       VALUES ($1, $2, $3, 'تصفير النقاط', 'reset', $4)`,
      [userId, guildId, prev, addedBy]
    );
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  return 0;
}

async function deleteTransaction(id, guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_transactions WHERE id = $1 AND guild_id = $2`,
    [id, guildId]
  );
  if (!rows[0]) return null;
  const tx = rows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Reverse the effect
    const reverse = (tx.type === 'add' || tx.type === 'set') ? -tx.points : tx.points;
    // For 'set' and 'reset' we just remove the record without reversing (too complex)
    if (tx.type === 'add') {
      await client.query(
        `UPDATE discord_members SET total_points = total_points - $1
         WHERE user_id = $2 AND guild_id = $3`,
        [tx.points, tx.user_id, guildId]
      );
    } else if (tx.type === 'deduct') {
      await client.query(
        `UPDATE discord_members SET total_points = total_points + $1
         WHERE user_id = $2 AND guild_id = $3`,
        [tx.points, tx.user_id, guildId]
      );
    }
    await client.query(`DELETE FROM discord_transactions WHERE id = $1`, [id]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  return tx;
}

// ─── Queries ────────────────────────────────────────────────────────────────

async function getPoints(userId, guildId) {
  const { rows } = await pool.query(
    'SELECT total_points FROM discord_members WHERE user_id = $1 AND guild_id = $2',
    [userId, guildId]
  );
  return rows[0]?.total_points ?? 0;
}

async function getHistory(userId, guildId, limit = 15) {
  const { rows } = await pool.query(`
    SELECT id, points, reason, type, added_by, ts
    FROM discord_transactions
    WHERE user_id = $1 AND guild_id = $2
    ORDER BY ts DESC LIMIT $3
  `, [userId, guildId, limit]);
  return rows;
}
async function getFullHistory(userId, guildId) {
  const { rows } = await pool.query(`
    SELECT id, points, reason, type, added_by, ts
    FROM discord_transactions
    WHERE user_id = $1 AND guild_id = $2
    ORDER BY ts ASC
  `, [userId, guildId]);
  return rows;
}
async function getAllTransactions(guildId) {
  const { rows } = await pool.query(`
    SELECT id, user_id, points, reason, type, added_by, ts
    FROM discord_transactions
    WHERE guild_id = $1
    ORDER BY ts ASC
  `, [guildId]);
  return rows;
}

async function getLeaderboard(guildId, limit = 10) {
  const { rows } = await pool.query(`
    SELECT user_id, total_points FROM discord_members
    WHERE guild_id = $1
    ORDER BY total_points DESC LIMIT $2
  `, [guildId, limit]);
  return rows;
}

async function getGuildStats(guildId, since) {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE type = 'add') AS add_count,
      COALESCE(SUM(points) FILTER (WHERE type = 'add'), 0) AS total_added,
      COUNT(*) FILTER (WHERE type = 'deduct') AS deduct_count,
      COALESCE(SUM(points) FILTER (WHERE type = 'deduct'), 0) AS total_deducted,
      COUNT(DISTINCT user_id) AS unique_members
    FROM discord_transactions
    WHERE guild_id = $1 AND ts >= $2
  `, [guildId, since]);
  return rows[0];
}

// ─── Reaction Roles ────────────────────────────────────────────────────────────

async function addReactionRole(guildId, channelId, messageId, emojiKey, emojiLabel, roleId) {
  await pool.query(`
    INSERT INTO discord_reaction_roles (guild_id, channel_id, message_id, emoji_key, emoji_label, role_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (message_id, emoji_key)
    DO UPDATE SET role_id = $6, emoji_label = $5
  `, [guildId, channelId, messageId, emojiKey, emojiLabel, roleId]);
}

async function removeReactionRole(messageId, emojiKey) {
  const { rowCount } = await pool.query(
    `DELETE FROM discord_reaction_roles WHERE message_id = $1 AND emoji_key = $2`,
    [messageId, emojiKey]
  );
  return rowCount > 0;
}

async function getReactionRole(messageId, emojiKey) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_reaction_roles WHERE message_id = $1 AND emoji_key = $2`,
    [messageId, emojiKey]
  );
  return rows[0] || null;
}

async function listReactionRoles(guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_reaction_roles WHERE guild_id = $1 ORDER BY id ASC`,
    [guildId]
  );
  return rows;
}

// ─── Anti-Nuke: Channel/Role Backups ───────────────────────────────────────────

async function upsertChannelBackup(guildId, snapshot) {
  await pool.query(`
    INSERT INTO discord_backup_channels
      (guild_id, channel_id, name, type, position, parent_id, topic, nsfw, bitrate, user_limit, rate_limit_per_user, overwrites, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, EXTRACT(EPOCH FROM NOW())::BIGINT)
    ON CONFLICT (channel_id) DO UPDATE SET
      name = $3, type = $4, position = $5, parent_id = $6, topic = $7, nsfw = $8,
      bitrate = $9, user_limit = $10, rate_limit_per_user = $11, overwrites = $12,
      updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
  `, [
    guildId, snapshot.channelId, snapshot.name, snapshot.type, snapshot.position,
    snapshot.parentId, snapshot.topic, snapshot.nsfw, snapshot.bitrate,
    snapshot.userLimit, snapshot.rateLimitPerUser, JSON.stringify(snapshot.overwrites || []),
  ]);
}

async function deleteChannelBackup(channelId) {
  await pool.query(`DELETE FROM discord_backup_channels WHERE channel_id = $1`, [channelId]);
}

async function listChannelBackups(guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_backup_channels WHERE guild_id = $1 ORDER BY position ASC`,
    [guildId]
  );
  return rows;
}

async function upsertRoleBackup(guildId, snapshot) {
  await pool.query(`
    INSERT INTO discord_backup_roles
      (guild_id, role_id, name, color, hoist, mentionable, permissions, position, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, EXTRACT(EPOCH FROM NOW())::BIGINT)
    ON CONFLICT (role_id) DO UPDATE SET
      name = $3, color = $4, hoist = $5, mentionable = $6, permissions = $7, position = $8,
      updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
  `, [
    guildId, snapshot.roleId, snapshot.name, snapshot.color, snapshot.hoist,
    snapshot.mentionable, snapshot.permissions, snapshot.position,
  ]);
}

async function deleteRoleBackup(roleId) {
  await pool.query(`DELETE FROM discord_backup_roles WHERE role_id = $1`, [roleId]);
}

async function listRoleBackups(guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_backup_roles WHERE guild_id = $1 ORDER BY position DESC`,
    [guildId]
  );
  return rows;
}

// ─── Anti-Nuke: Settings ────────────────────────────────────────────────────────

async function getAntiNukeSettings(guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_antinuke_settings WHERE guild_id = $1`,
    [guildId]
  );
  if (rows[0]) return rows[0];
  return {
    guild_id: guildId, enabled: true, threshold_count: 3, threshold_seconds: 5, log_channel_id: null,
    punishment_mode: 'ban', quarantine_role_id: null, quarantine_channel_id: null,
  };
}

async function setAntiNukeEnabled(guildId, enabled) {
  await pool.query(`
    INSERT INTO discord_antinuke_settings (guild_id, enabled)
    VALUES ($1, $2)
    ON CONFLICT (guild_id) DO UPDATE SET enabled = $2
  `, [guildId, enabled]);
}

async function setAntiNukeLogChannel(guildId, channelId) {
  await pool.query(`
    INSERT INTO discord_antinuke_settings (guild_id, log_channel_id)
    VALUES ($1, $2)
    ON CONFLICT (guild_id) DO UPDATE SET log_channel_id = $2
  `, [guildId, channelId]);
}

async function setAntiNukeThreshold(guildId, count, seconds) {
  await pool.query(`
    INSERT INTO discord_antinuke_settings (guild_id, threshold_count, threshold_seconds)
    VALUES ($1, $2, $3)
    ON CONFLICT (guild_id) DO UPDATE SET threshold_count = $2, threshold_seconds = $3
  `, [guildId, count, seconds]);
}

// ─── Anti-Nuke: سجل الحوادث الدائم ────────────────────────────────────────────

async function logAntiNukeIncident(guildId, executorId, kinds, actionCount, actionTaken) {
  await pool.query(`
    INSERT INTO discord_antinuke_logs (guild_id, executor_id, kinds, action_count, action_taken)
    VALUES ($1, $2, $3, $4, $5)
  `, [guildId, executorId, kinds, actionCount, actionTaken]);
}

async function listAntiNukeIncidents(guildId, limit = 10) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_antinuke_logs WHERE guild_id = $1 ORDER BY ts DESC LIMIT $2`,
    [guildId, limit]
  );
  return rows;
}

// ─── Anti-Nuke: Whitelist ────────────────────────────────────────────────────────

async function addToAntiNukeWhitelist(guildId, userId, addedBy) {
  await pool.query(`
    INSERT INTO discord_antinuke_whitelist (guild_id, user_id, added_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (guild_id, user_id) DO NOTHING
  `, [guildId, userId, addedBy]);
}

async function removeFromAntiNukeWhitelist(guildId, userId) {
  const { rowCount } = await pool.query(
    `DELETE FROM discord_antinuke_whitelist WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );
  return rowCount > 0;
}

async function isAntiNukeWhitelisted(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM discord_antinuke_whitelist WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );
  return rows.length > 0;
}

async function listAntiNukeWhitelist(guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_antinuke_whitelist WHERE guild_id = $1 ORDER BY added_at ASC`,
    [guildId]
  );
  return rows;
}

// ─── Aura Quarantine ────────────────────────────────────────────────────────────

async function setPunishmentMode(guildId, mode) {
  await pool.query(`
    INSERT INTO discord_antinuke_settings (guild_id, punishment_mode)
    VALUES ($1, $2)
    ON CONFLICT (guild_id) DO UPDATE SET punishment_mode = $2
  `, [guildId, mode]);
}

async function setQuarantineConfig(guildId, roleId, channelId) {
  await pool.query(`
    INSERT INTO discord_antinuke_settings (guild_id, quarantine_role_id, quarantine_channel_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (guild_id) DO UPDATE SET quarantine_role_id = $2, quarantine_channel_id = $3
  `, [guildId, roleId, channelId]);
}

async function createQuarantine(guildId, userId, originalRoles, reason) {
  const { rows } = await pool.query(`
    INSERT INTO discord_quarantine (guild_id, user_id, original_roles, reason)
    VALUES ($1, $2, $3, $4) RETURNING id
  `, [guildId, userId, originalRoles.join(','), reason]);
  return rows[0].id;
}

async function getActiveQuarantine(guildId, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_quarantine WHERE guild_id = $1 AND user_id = $2 AND released = false ORDER BY id DESC LIMIT 1`,
    [guildId, userId]
  );
  return rows[0] || null;
}

async function getQuarantineById(id, guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_quarantine WHERE id = $1 AND guild_id = $2`,
    [id, guildId]
  );
  return rows[0] || null;
}

async function releaseQuarantine(id) {
  await pool.query(`UPDATE discord_quarantine SET released = true WHERE id = $1`, [id]);
}

async function listActiveQuarantines(guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_quarantine WHERE guild_id = $1 AND released = false ORDER BY quarantined_at DESC`,
    [guildId]
  );
  return rows;
}

// ─── Aura Memory ────────────────────────────────────────────────────────────────

async function saveMemorySnapshot(guildId, label, snapshotData) {
  const { rows } = await pool.query(`
    INSERT INTO discord_memory_snapshots (guild_id, label, snapshot_data)
    VALUES ($1, $2, $3) RETURNING id, taken_at
  `, [guildId, label, JSON.stringify(snapshotData)]);
  return rows[0];
}

async function listMemorySnapshots(guildId, limit = 15) {
  const { rows } = await pool.query(
    `SELECT id, taken_at, label FROM discord_memory_snapshots WHERE guild_id = $1 ORDER BY taken_at DESC LIMIT $2`,
    [guildId, limit]
  );
  return rows;
}

async function getMemorySnapshot(id, guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM discord_memory_snapshots WHERE id = $1 AND guild_id = $2`,
    [id, guildId]
  );
  return rows[0] || null;
}

module.exports = {
  init,
  getGuildSettings, setGuildSetting, updateLastReport, getAllGuildSettings,
  addPoints, deductPoints, setPoints, resetPoints, deleteTransaction,
  getPoints, getHistory, getFullHistory, getAllTransactions, getLeaderboard, getGuildStats,
  addReactionRole, removeReactionRole, getReactionRole, listReactionRoles,
  upsertChannelBackup, deleteChannelBackup, listChannelBackups,
  upsertRoleBackup, deleteRoleBackup, listRoleBackups,
  getAntiNukeSettings, setAntiNukeEnabled, setAntiNukeLogChannel, setAntiNukeThreshold,
  addToAntiNukeWhitelist, removeFromAntiNukeWhitelist, isAntiNukeWhitelisted, listAntiNukeWhitelist,
  logAntiNukeIncident, listAntiNukeIncidents,
  setPunishmentMode, setQuarantineConfig,
  createQuarantine, getActiveQuarantine, getQuarantineById, releaseQuarantine, listActiveQuarantines,
  saveMemorySnapshot, listMemorySnapshots, getMemorySnapshot,
};
