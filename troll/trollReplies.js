// trollReplies.js
// نظام ردود ترول فكاهية على كلمات مفتاحية - يقرأ من triggers.json
// عشان تضيف كلمات جديدة: افتح triggers.json وضيف عنصر جديد بنفس الشكل، ما تحتاج تلمس هذا الملف

const fs = require('fs');
const path = require('path');

function loadTriggers() {
  const filePath = path.join(__dirname, 'triggers.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

let config = loadTriggers();

function handleTrollReply(message) {
  if (message.author.bot) return; // تجاهل رسائل البوتات (يمنع اللوب)

  const content = message.content.toLowerCase();

  for (const trigger of config.triggers) {
    const matched = trigger.keywords.some((kw) => content.includes(kw.toLowerCase()));
    if (matched) {
      if (Math.random() > config.TRIGGER_CHANCE) return; // أحياناً ما يرد عشان يصير طبيعي

      const reply = trigger.replies[Math.floor(Math.random() * trigger.replies.length)];
      message.reply(reply).catch(() => {});
      return; // رد وحد بس بكل رسالة
    }
  }
}

module.exports = { handleTrollReply };
