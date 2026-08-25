const db = require('./database');
const { buildReportEmbed } = require('./utils');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // every hour

function startAutoReport(client) {
  setInterval(() => runReportCheck(client).catch(console.error), CHECK_INTERVAL_MS);
  console.log('⏰ مجدول التقارير التلقائية يعمل (يفحص كل ساعة)');
}

async function runReportCheck(client) {
  const allSettings = await db.getAllGuildSettings();
  const now = Math.floor(Date.now() / 1000);

  for (const s of allSettings) {
    if (!s.report_channel_id) continue;

    const shouldSend = isDue(s, now);
    if (!shouldSend) continue;

    const guild = client.guilds.cache.get(s.guild_id);
    if (!guild) continue;

    const channel = guild.channels.cache.get(s.report_channel_id);
    if (!channel) continue;

    const sinceTs = s.last_report_at || (now - 7 * 24 * 3600);
    const periodLabel = s.report_schedule === 'monthly' ? 'الشهري' : 'الأسبوعي';

    try {
      const embed = await buildReportEmbed(guild, s, sinceTs, periodLabel);
      await channel.send({ embeds: [embed] });
      await db.updateLastReport(s.guild_id, now);
      console.log(`📊 تم إرسال التقرير ${periodLabel} لـ ${guild.name}`);
    } catch (err) {
      console.error(`خطأ في إرسال التقرير لـ ${guild.name}:`, err.message);
    }
  }
}

function isDue(settings, nowTs) {
  const now = new Date(nowTs * 1000);
  const hour = now.getUTCHours();

  // Only fire at the configured hour
  if (hour !== settings.report_hour) return false;

  const lastSent = new Date(settings.last_report_at * 1000);

  if (settings.report_schedule === 'weekly') {
    // 1=Monday … 7=Sunday (ISO weekday)
    const isoDay = now.getUTCDay() || 7;
    if (isoDay !== settings.report_day) return false;
    // Didn't send this week yet
    const daysSinceLast = (nowTs - settings.last_report_at) / 86400;
    return daysSinceLast >= 6;
  }

  if (settings.report_schedule === 'monthly') {
    if (now.getUTCDate() !== settings.report_day) return false;
    // Didn't send this month yet
    return (
      lastSent.getUTCMonth() !== now.getUTCMonth() ||
      lastSent.getUTCFullYear() !== now.getUTCFullYear()
    );
  }

  return false;
}

module.exports = { startAutoReport, runReportCheck };
