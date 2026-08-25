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
    owner_roles:          process.env.ALLOWED_ROLES || '',
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

// ─── Queries ──────────────────────────────────────────────────────────────────

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

module.exports = {
  init,
  getGuildSettings, setGuildSetting, updateLastReport, getAllGuildSettings,
  addPoints, deductPoints, setPoints, resetPoints, deleteTransaction,
  getPoints, getHistory, getAllTransactions, getLeaderboard, getGuildStats,
};
