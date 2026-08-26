require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, ActivityType } = require('discord.js');
const fs                   = require('fs');
const path                 = require('path');
const db                   = require('./database');
const { handleMessage }    = require('./prefix-handler');
const { startAutoReport }  = require('./auto-report');

// ─── Validate env ─────────────────────────────────────────────────────────────
const token = process.env.BOT_TOKEN;
if (!token) { console.error('❌ BOT_TOKEN غير موجود'); process.exit(1); }

// ─── Build client ─────────────────────────────────────────────────────────────
function buildClient(withMessageContent) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (withMessageContent) intents.push(GatewayIntentBits.MessageContent);
  return new Client({ intents });
}

// ─── Load commands ────────────────────────────────────────────────────────────
function loadCommands(client) {
  client.commands = new Collection();
  const dir = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const cmd = require(path.join(dir, file));
    if (cmd.data && cmd.execute) {
      client.commands.set(cmd.data.name, cmd);
      console.log(`✅ تم تحميل الأمر: /${cmd.data.name}`);
    }
  }
}

// ─── Attach events ────────────────────────────────────────────────────────────
function attachEvents(client, prefixEnabled) {
  client.once(Events.ClientReady, async (c) => {
    await db.init();

    const C = { reset: '\x1b[0m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m', dim: '\x1b[2m', bold: '\x1b[1m' };

    console.log(`${C.magenta}${C.bold}
   █████╗ ██╗   ██╗██████╗  █████╗
  ██╔══██╗██║   ██║██╔══██╗██╔══██╗
  ███████║██║   ██║██████╔╝███████║
  ██╔══██║██║   ██║██╔══██╗██║  ██║
  ██║  ██║╚██████╔╝██║  ██║██║  ██║
  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝${C.reset}`);

    console.log(`${C.dim}  ────────────────────────────────────────${C.reset}`);
    console.log(`  ${C.green}●${C.reset} متصل باسم   ${C.bold}${c.user.tag}${C.reset}`);
    console.log(`  ${C.cyan}●${C.reset} الخوادم      ${C.bold}${c.guilds.cache.size}${C.reset}`);
    console.log(`  ${prefixEnabled ? C.green : C.yellow}●${C.reset} أوامر الـ !   ${prefixEnabled ? C.green + 'مفعّلة ✓' : C.yellow + 'معطّلة'}${C.reset}`);
    console.log(`${C.dim}  ────────────────────────────────────────${C.reset}\n`);

    if (!prefixEnabled) {
      console.log('\n══════════════════════════════════════════════');
      console.log('⚠️  لتفعيل أوامر ! اتبع الخطوات:');
      console.log('  1. discord.com/developers/applications');
      console.log(`  2. افتح تطبيقك (ID: ${process.env.CLIENT_ID})`);
      console.log('  3. Bot ← Privileged Gateway Intents');
      console.log('  4. فعّل: MESSAGE CONTENT INTENT ✓');
      console.log('  5. أعد تشغيل البوت');
      console.log('══════════════════════════════════════════════\n');
    }

    startAutoReport(c);

    // ─── حالة البوت ─────────────────────────────────────────────────────────
    c.user.setPresence({
      activities: [{ name: 'يراقب النقاط 🏆', type: ActivityType.Watching }],
      status: 'online',
    });
  });

  // Slash commands + button interactions
  client.on(Events.InteractionCreate, async (interaction) => {
    // Button interactions (e.g. reset confirmation)
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('reset_cancel_')) {
        return interaction.update({ content: '❌ تم إلغاء التصفير.', embeds: [], components: [] });
      }
      // reset_confirm_ is handled inside reset.js via awaitMessageComponent — ignore here
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`خطأ في /${interaction.commandName}:`, error);
      const msg = { content: '❌ حدث خطأ أثناء تنفيذ الأمر.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  });

  // Prefix commands
  if (prefixEnabled) {
    client.on(Events.MessageCreate, (msg) => {
      handleMessage(msg, client).catch(console.error);
    });
  }
}

// ─── Start with fallback ──────────────────────────────────────────────────────
async function start(withMessageContent = true) {
  const client = buildClient(withMessageContent);
  loadCommands(client);
  attachEvents(client, withMessageContent);

  try {
    await client.login(token);
  } catch (err) {
    if (withMessageContent && err.message?.includes('disallowed intents')) {
      console.warn('\n⚠️  MessageContent intent غير مفعّل — إعادة المحاولة بدون أوامر !\n');
      client.destroy();
      return start(false);
    }
    console.error('❌ فشل تسجيل الدخول:', err.message);
    process.exit(1);
  }
}

start();
