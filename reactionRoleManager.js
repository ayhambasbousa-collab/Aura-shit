// reactionRoleManager.js
// نظام "رتبة مقابل رياكت": أي عضو يحط إيموجي معين على رسالة معينة ياخذ رتبة تلقائيًا.
// يدعم الإيموجي العادي (يونيكود) والإيموجي المخصص بالسيرفر (ثابت وحتى لو تغيّر اسمه).

const db = require('./database');

// ─── تطبيع الإيموجي إلى مفتاح ثابت للمقارنة/التخزين ────────────────────────────

// من نص أدخله الإداري بأمر السلاش (يونيكود، أو <:name:id>، أو <a:name:id>)
function normalizeEmojiInput(raw) {
  const custom = raw.match(/^<a?:\w+:(\d+)>$/);
  if (custom) return { key: `custom:${custom[1]}`, label: raw };
  return { key: `unicode:${raw}`, label: raw };
}

// من كائن reaction.emoji الحقيقي اللي يوصل من حدث الرياكت بديسكورد
function normalizeEmojiObject(emoji) {
  if (emoji.id) return { key: `custom:${emoji.id}`, label: emoji.toString() };
  return { key: `unicode:${emoji.name}`, label: emoji.name };
}

// ─── معالجة الأحداث ─────────────────────────────────────────────────────────────

async function handleReactionAdd(reaction, user) {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch {
    return; // الرسالة انحذفت أو تعذر جلبها
  }

  const { message } = reaction;
  if (!message.guildId) return; // تجاهل أي شي خارج السيرفر

  const { key } = normalizeEmojiObject(reaction.emoji);
  const mapping = await db.getReactionRole(message.id, key);
  if (!mapping) return;

  try {
    const guild = message.guild;
    const member = await guild.members.fetch(user.id);
    if (member.roles.cache.has(mapping.role_id)) return; // عنده الرتبة أصلاً
    await member.roles.add(mapping.role_id);
  } catch (err) {
    console.error('❌ فشل إضافة رتبة الرياكت:', err.message);
  }
}

async function handleReactionRemove(reaction, user) {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch {
    return;
  }

  const { message } = reaction;
  if (!message.guildId) return;

  const { key } = normalizeEmojiObject(reaction.emoji);
  const mapping = await db.getReactionRole(message.id, key);
  if (!mapping) return;

  try {
    const guild = message.guild;
    const member = await guild.members.fetch(user.id);
    if (!member.roles.cache.has(mapping.role_id)) return; // ما عنده الرتبة أصلاً
    await member.roles.remove(mapping.role_id);
  } catch (err) {
    console.error('❌ فشل إزالة رتبة الرياكت:', err.message);
  }
}

module.exports = {
  normalizeEmojiInput,
  normalizeEmojiObject,
  handleReactionAdd,
  handleReactionRemove,
};
