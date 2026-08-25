require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const token    = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token)    { console.error('❌ BOT_TOKEN غير موجود'); process.exit(1); }
if (!clientId) { console.error('❌ CLIENT_ID غير موجود'); process.exit(1); }

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    commands.push(command.data.toJSON());
    console.log(`📦 تجهيز أمر: /${command.data.name}`);
  }
}

const rest = new REST().setToken(token);

(async () => {
  try {
    console.log(`\n🔄 جاري تسجيل ${commands.length} أمر...`);

    const data = await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands },
    );

    console.log(`✅ تم تسجيل ${data.length} أمر بنجاح!`);
  } catch (error) {
    console.error('❌ فشل تسجيل الأوامر:', error);
  }
})();
