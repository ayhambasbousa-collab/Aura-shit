// tournamentManager.js
// محرك بطولة الأسئلة الكتابية.
// بدون تسجيل مسبق — أي عضو يقدر يجاوب مباشرة أثناء فتح الشات.
// الروم يُقفل فعليًا (صلاحيات ديسكورد) بعد كل إجابة صحيحة، ويُفتح تلقائيًا
// قبل كل سؤال جديد بفترة قراءة قصيرة.

const { EmbedBuilder } = require('discord.js');
const questionsData = require('./questions.json');
const config = require('./tournament-config');

// guildId -> state
const tournaments = new Map();

// لون مختلف لكل جولة (بالترتيب: أزرق، بنفسجي، فيروزي، برتقالي، ذهبي)
const ROUND_COLORS = [0x3498DB, 0x9B59B6, 0x1ABC9C, 0xE67E22, 0xF1C40F];
const NUMBER_EMOJIS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const BRAND_AUTHOR = { name: '🏆 بطولة أورا الكبرى' };

// ─── أدوات مساعدة ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(str) {
  return str
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))  // أرقام عربية (٠-٩) → لاتينية
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))  // أرقام فارسية (۰-۹) → لاتينية
    .replace(/[\u064B-\u0652\u0640]/g, '')   // إزالة التشكيل والتطويل
    .replace(/[أإآا]/g, 'ا')                  // توحيد الألف
    .replace(/ى/g, 'ي')                        // توحيد الياء
    .replace(/ة/g, 'ه')                        // توحيد التاء المربوطة
    .replace(/[^\p{L}\p{N}\s]/gu, '')          // إزالة علامات الترقيم وأي رموز خفية (RTL، Zero-width..)
    .replace(/\s+/g, ' ')
    .trim();
}

function getState(guildId) {
  return tournaments.get(guildId) || null;
}

function getChannel(state, client) {
  const guild = client.guilds.cache.get(state.guildId);
  return guild?.channels.cache.get(state.channelId) || null;
}

// تحقق إن البوت يملك صلاحية Manage Roles على القناة (لازمة للقفل/الفتح الفعلي)
function botCanManageChannel(channel, client) {
  const me = channel.guild.members?.me || channel.guild.members?.cache.get(client.user.id);
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  if (!perms) return false;
  return perms.has('ManageRoles') || perms.has('Administrator');
}

function sortedParticipants(state) {
  return [...state.participants.entries()].sort(
    (a, b) => b[1].score - a[1].score || b[1].correct - a[1].correct
  );
}

function roundColor(round) {
  return ROUND_COLORS[(round.id - 1) % ROUND_COLORS.length];
}

function roundPointsSummary(round) {
  const pts = round.questions.map((q) => q.points);
  const uniq = [...new Set(pts)];
  return uniq.length === 1
    ? `\`${uniq[0]}\` نقطة لكل سؤال`
    : `\`${Math.min(...pts)}–${Math.max(...pts)}\` نقطة (تصاعدي)`;
}

function buildTournamentOverviewEmbed() {
  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setAuthor(BRAND_AUTHOR)
    .setTitle('🏆 بطولة أورا الكبرى')
    .setDescription('### 🎉 استعدوا! 5 جولات • 25 سؤال • إجمالي 106 نقطة');

  for (const round of questionsData.rounds) {
    embed.addFields({
      name: `${round.icon} ${round.name}`,
      value: `${round.questions.length} أسئلة — ${roundPointsSummary(round)}`,
      inline: false,
    });
  }

  embed.setFooter({ text: `🚨 الجولة الأولى تبدأ خلال ${config.TOURNAMENT_INTRO_WAIT_SECONDS} ثانية — استعدوا!` });
  embed.setTimestamp();
  return embed;
}

function totalQuestionsCount() {
  return questionsData.rounds.reduce((sum, r) => sum + r.questions.length, 0);
}

function globalQuestionNumber(state) {
  let n = 0;
  for (let i = 0; i < state.roundIndex; i++) n += questionsData.rounds[i].questions.length;
  return n + state.questionIndex + 1;
}

function progressBar(current, total, size = 12) {
  const filled = Math.max(0, Math.min(size, Math.round((current / total) * size)));
  return '🟩'.repeat(filled) + '⬜'.repeat(size - filled);
}

// ─── قفل / فتح الروم فعليًا عبر صلاحيات ديسكورد ────────────────────────────────

async function ensureBotCanSend(channel, client) {
  await channel.permissionOverwrites
    .edit(client.user.id, { SendMessages: true, ViewChannel: true, EmbedLinks: true })
    .catch(() => {});
}

async function lockChannel(channel) {
  await channel.permissionOverwrites
    .edit(channel.guild.roles.everyone, { SendMessages: false })
    .catch(() => {});
}

async function unlockChannel(channel) {
  // نحذف الـ Override بدل ما نفرض فتح — يرجع الروم لإعداداته الافتراضية
  await channel.permissionOverwrites
    .edit(channel.guild.roles.everyone, { SendMessages: null })
    .catch(() => {});
}

// ─── إنشاء وإيقاف ──────────────────────────────────────────────────────────────

async function start(guildId, channelId, hostId, client) {
  if (tournaments.has(guildId)) return { ok: false, reason: 'already_running' };

  const state = {
    guildId,
    channelId,
    hostId,
    participants: new Map(), // userId -> { tag, score, correct }
    roundIndex: 0,
    questionIndex: 0,
    currentQuestion: null,
  };
  tournaments.set(guildId, state);

  const channel = getChannel(state, client);
  if (!channel) {
    tournaments.delete(guildId);
    return { ok: false, reason: 'channel_not_found' };
  }

  if (!channel.isTextBased?.()) {
    tournaments.delete(guildId);
    return { ok: false, reason: 'invalid_channel_type' };
  }

  if (!botCanManageChannel(channel, client)) {
    tournaments.delete(guildId);
    return { ok: false, reason: 'missing_permissions' };
  }

  await ensureBotCanSend(channel, client);
  await lockChannel(channel);

  // نكمل بالخلفية بدون ما نأخر رد أمر /start-tournament بعدة ثواني
  runTournamentSequence(guildId, client).catch((err) => {
    console.error('❌ خطأ أثناء تشغيل تسلسل البطولة:', err);
  });

  return { ok: true };
}

async function runTournamentSequence(guildId, client) {
  const state = tournaments.get(guildId);
  if (!state) return;

  const channel = getChannel(state, client);
  if (!channel) return;

  // رسالة وحدة مختصرة توضح كل الجولات دفعة وحدة
  await channel.send({ embeds: [buildTournamentOverviewEmbed()] }).catch(() => {});

  // ربع دقيقة انتظار — لحظة مميزة قبل انطلاق البطولة
  await sleep(config.TOURNAMENT_INTRO_WAIT_SECONDS * 1000);

  await runQuestionCycle(guildId, client);
}

async function stopTournament(guildId, client) {
  const state = tournaments.get(guildId);
  if (!state) return false;

  if (state.currentQuestion?.timer) clearTimeout(state.currentQuestion.timer);

  const channel = getChannel(state, client);
  if (channel) await unlockChannel(channel).catch(() => {});

  tournaments.delete(guildId);
  return true;
}

async function resetTournament(guildId, client) {
  return stopTournament(guildId, client);
}

// ─── دورة السؤال: قفل → عد تنازلي → سؤال → مهلة قراءة → فتح ──────────────────

async function runQuestionCycle(guildId, client) {
  const state = tournaments.get(guildId);
  if (!state) return;

  const round = questionsData.rounds[state.roundIndex];
  if (!round) return finishTournament(guildId, client);

  const q = round.questions[state.questionIndex];
  if (!q) return finishTournament(guildId, client); // احتياط

  const channel = getChannel(state, client);
  if (!channel) return;

  await lockChannel(channel);
  await showCountdown(channel, round);

  // تأكد إن البطولة ما انوقفت أثناء العد التنازلي (حماية من race condition)
  if (tournaments.get(guildId) !== state) return;

  state.currentQuestion = {
    answers: q.answers.map(normalize),
    rawAnswer: q.answers[0],
    points: q.points,
    closed: false,
    timer: null,
  };

  const color = roundColor(round);
  const globalNum = globalQuestionNumber(state);
  const total = totalQuestionsCount();

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor(BRAND_AUTHOR)
    .setTitle(`${round.icon} ${round.name}`)
    .setDescription(`### «${q.question}»`)
    .addFields(
      { name: '📍 السؤال', value: `\`${state.questionIndex + 1}/5\``, inline: true },
      { name: '⭐ القيمة', value: `\`${q.points}\` نقطة`, inline: true },
      { name: '⏱️ المدة', value: `\`${config.QUESTION_TIMEOUT}\` ثانية`, inline: true },
    )
    .setFooter({ text: `${progressBar(globalNum, total)}  ${globalNum}/${total}` })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});

  await sleep(config.OPEN_DELAY_SECONDS * 1000);

  // تأكد إن البطولة ما انوقفت أثناء مهلة القراءة (حماية من race condition)
  if (tournaments.get(guildId) !== state) return;

  await unlockChannel(channel);

  state.currentQuestion.timer = setTimeout(
    () => handleTimeout(guildId, client),
    config.QUESTION_TIMEOUT * 1000
  );
}

async function showCountdown(channel, round) {
  const color = roundColor(round);
  let n = config.COUNTDOWN_SECONDS;

  const buildEmbed = (num) => new EmbedBuilder()
    .setColor(color)
    .setAuthor(BRAND_AUTHOR)
    .setDescription(`### ⏳ السؤال القادم خلال ${NUMBER_EMOJIS[num] ?? num}`);

  const msg = await channel.send({ embeds: [buildEmbed(n)] }).catch(() => null);
  if (!msg) return;

  for (n = config.COUNTDOWN_SECONDS - 1; n >= 1; n--) {
    await sleep(1000);
    await msg.edit({ embeds: [buildEmbed(n)] }).catch(() => {});
  }
  await sleep(1000);
}

// ─── انتهاء الوقت ──────────────────────────────────────────────────────────────

async function handleTimeout(guildId, client) {
  const state = tournaments.get(guildId);
  if (!state || !state.currentQuestion || state.currentQuestion.closed) return;
  state.currentQuestion.closed = true;

  const channel = getChannel(state, client);
  if (channel) {
    await lockChannel(channel);
    const embed = new EmbedBuilder()
      .setColor(0x607D8B)
      .setAuthor(BRAND_AUTHOR)
      .setTitle('⏰ انتهى الوقت!')
      .setDescription(
        `❌ لم يجب أحد بشكل صحيح.\n\n✅ الإجابة الصحيحة: **${state.currentQuestion.rawAnswer}**`
      );
    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  await afterQuestionResolved(guildId, client);
}

// ─── استقبال الإجابات (من messageCreate) ───────────────────────────────────────

async function handleMessage(message) {
  if (message.author.bot) return;

  const state = tournaments.get(message.guildId);
  if (!state) return;
  if (message.channelId !== state.channelId) return;

  const cq = state.currentQuestion;
  if (!cq || cq.closed) return;

  const normalized = normalize(message.content);
  if (!normalized || !cq.answers.includes(normalized)) return;

  // أغلق فورًا لمنع أي سباق أو إجابات مكررة
  cq.closed = true;
  clearTimeout(cq.timer);

  // قفل الروم فعليًا فور وجود إجابة صحيحة
  await lockChannel(message.channel);

  if (!state.participants.has(message.author.id)) {
    state.participants.set(message.author.id, {
      tag: message.author.username ?? message.author.tag ?? 'مستخدم',
      score: 0,
      correct: 0,
    });
  }
  const p = state.participants.get(message.author.id);
  p.score += cq.points;
  p.correct += 1;

  const embed = new EmbedBuilder()
    .setColor(0x00C853)
    .setAuthor(BRAND_AUTHOR)
    .setTitle('✅ تمت الإجابة بنجاح!')
    .addFields(
      { name: '👤 الفائز', value: `<@${message.author.id}>`, inline: true },
      { name: '✅ الإجابة', value: `${message.content}`.slice(0, 100), inline: true },
      { name: '⭐ حصل على', value: `+${cq.points} نقطة`, inline: true },
      { name: '🏅 مجموعه بالبطولة', value: `\`${p.score}\` نقطة`, inline: false },
    )
    .setTimestamp();

  await message.channel.send({ embeds: [embed] }).catch(() => {});
  await afterQuestionResolved(message.guildId, message.client);
}

// ─── بعد حل السؤال (إجابة صحيحة أو انتهاء وقت) ────────────────────────────────

async function afterQuestionResolved(guildId, client) {
  const state = tournaments.get(guildId);
  if (!state) return;

  const channel = getChannel(state, client);
  const round = questionsData.rounds[state.roundIndex];
  const isLastQuestionOfRound = (state.questionIndex + 1) >= round.questions.length;
  const nextRound = isLastQuestionOfRound ? questionsData.rounds[state.roundIndex + 1] : null;
  const isTournamentEnd = isLastQuestionOfRound && !nextRound;

  // ما نعرض "الترتيب الحالي" إذا هذا آخر سؤال بالبطولة (بيطلع النتيجة النهائية بعده مباشرة)
  if (channel && !isTournamentEnd) {
    await sleep(config.MESSAGE_GAP_SECONDS * 1000);
    await sendTopEmbed(channel, state);
  }

  state.questionIndex += 1;

  if (isLastQuestionOfRound) {
    if (isTournamentEnd) {
      return finishTournament(guildId, client);
    }
    if (channel) {
      await sleep(config.MESSAGE_GAP_SECONDS * 1000);
      await announceRoundTransition(channel, round, nextRound);
    }
    state.roundIndex += 1;
    state.questionIndex = 0;
  }

  await runQuestionCycle(guildId, client);
}

// ─── الرسائل الإعلانية (توب، شرح فئة، انتقال) ──────────────────────────────────

async function sendTopEmbed(channel, state) {
  const sorted = sortedParticipants(state);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = sorted
    .slice(0, 10)
    .map(([uid, p], i) => `${medals[i] ?? `\`#${i + 1}\``} <@${uid}> — \`${p.score}\` نقطة`);

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setAuthor(BRAND_AUTHOR)
    .setTitle('📊 الترتيب الحالي')
    .setDescription(lines.length ? lines.join('\n') : 'لا يوجد مشاركون بعد')
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}


async function announceRoundTransition(channel, finishedRound, nextRound) {
  const embed = new EmbedBuilder()
    .setColor(roundColor(nextRound))
    .setAuthor(BRAND_AUTHOR)
    .setTitle(`🏁 انتهت ${finishedRound.name}!`)
    .setDescription(`### ${nextRound.icon} التالي: ${nextRound.name}\n${nextRound.description || ''}`)
    .addFields(
      { name: '🔢 عدد الأسئلة', value: `\`${nextRound.questions.length}\``, inline: true },
      { name: '⭐ النقاط', value: roundPointsSummary(nextRound), inline: true },
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

// ─── نهاية البطولة ─────────────────────────────────────────────────────────────

async function finishTournament(guildId, client) {
  const state = tournaments.get(guildId);
  if (!state) return;

  const channel = getChannel(state, client);
  const sorted = sortedParticipants(state);
  const topLabels = ['🥇 المركز الأول', '🥈 المركز الثاني', '🥉 المركز الثالث'];

  const top = sorted.slice(0, 3).map(([uid, p], i) => `${topLabels[i]}: <@${uid}> — \`${p.score}\` نقطة`);

  const totalCorrect = sorted.reduce((sum, [, p]) => sum + p.correct, 0);

  const description = [
    '### 🎉🎉 مبروك للفائزين! 🎉🎉',
    '',
    ...top,
  ].join('\n') || 'لا يوجد مشاركون';

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('🏆 انتهت بطولة أورا الكبرى!')
    .setDescription(description)
    .addFields(
      { name: '👥 عدد المشاركين', value: `\`${sorted.length}\``, inline: true },
      { name: '✅ إجمالي الإجابات الصحيحة', value: `\`${totalCorrect}\``, inline: true },
    )
    .setFooter({ text: 'شكرًا للجميع على المشاركة 🏆' })
    .setTimestamp();

  if (channel) {
    await channel.send({ embeds: [embed] }).catch(() => {});
    await unlockChannel(channel).catch(() => {});
  }

  tournaments.delete(guildId);
}

// ─── الانتقال اليدوي (أمر إداري) ───────────────────────────────────────────────

async function advanceManual(guildId, client) {
  const state = tournaments.get(guildId);
  if (!state || !state.currentQuestion || state.currentQuestion.closed) {
    return { ok: false, reason: 'no_active_question' };
  }

  state.currentQuestion.closed = true;
  clearTimeout(state.currentQuestion.timer);

  const channel = getChannel(state, client);
  if (channel) {
    await lockChannel(channel);
    const embed = new EmbedBuilder()
      .setColor(0x95A5A6)
      .setAuthor(BRAND_AUTHOR)
      .setDescription('⏭️ **تم تخطي هذا السؤال بواسطة الإدارة.**');
    await channel.send({ embeds: [embed] }).catch(() => {});
  }

  await afterQuestionResolved(guildId, client);
  return { ok: true };
}

function currentScoreEmbed(guildId) {
  const state = tournaments.get(guildId);
  if (!state) return null;

  const sorted = sortedParticipants(state);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = sorted.map(([uid, p], i) => `${medals[i] ?? `\`#${i + 1}\``} <@${uid}> — \`${p.score}\` نقطة`);

  return new EmbedBuilder()
    .setColor(0xFFD700)
    .setAuthor(BRAND_AUTHOR)
    .setTitle('📊 الترتيب الحالي')
    .setDescription(lines.length ? lines.join('\n') : 'لا يوجد مشاركون بعد')
    .setTimestamp();
}

module.exports = {
  getState,
  start,
  stopTournament,
  resetTournament,
  handleMessage,
  advanceManual,
  currentScoreEmbed,
};
       
