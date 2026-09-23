// give-role.js
// سكربت مستقل يشتغل مرة وحدة: يعطي عضو معين رتبة معينة، وبعدها يطلع.
// يدور تلقائيًا على كل السيرفرات اللي البوت فيها، يلقى السيرفر اللي فيه هذي الرتبة.

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const USER_ID = '1386014228908998727';
const ROLE_ID = '1550450053502607360';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('ready', async () => {
  console.log(`✅ متصل باسم ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    const role = guild.roles.cache.get(ROLE_ID);
    if (!role) continue; // هذي الرتبة مو بهذا السيرفر، جرب السيرفر التالي

    try {
      const member = await guild.members.fetch(USER_ID);
      if (member.roles.cache.has(ROLE_ID)) {
        console.log(`ℹ️ العضو أصلاً عنده الرتبة "${role.name}" بسيرفر "${guild.name}".`);
      } else {
        await member.roles.add(role);
        console.log(`✅ تم إعطاء "${role.name}" لـ ${member.user.tag} بسيرفر "${guild.name}".`);
      }
      process.exit(0);
    } catch (err) {
      console.error(`❌ لقيت الرتبة بسيرفر "${guild.name}" بس فشلت العملية:`, err.message);
      process.exit(1);
    }
  }

  console.error('❌ ما لقيت أي سيرفر فيه هذي الرتبة، أو البوت مو موجود بالسيرفر الصحيح.');
  process.exit(1);
});

client.login(process.env.BOT_TOKEN);
