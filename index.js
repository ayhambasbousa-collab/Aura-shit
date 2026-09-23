require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, ActivityType, Partials } = require('discord.js');
const fs                   = require('fs');
const path                 = require('path');
const db                   = require('./database');
const { handleMessage }    = require('./prefix-handler');
const { startAutoReport }  = require('./auto-report');
const tm                   = require('./tournamentManager');
const rr                   = require('./reactionRoleManager');
const antiNuke              = require('./antiNukeManager');

// ─── Validate env ─────────────────────────────────────────────────────────────
const token = process.env.BOT_TOKEN;
if (!token) { console.error('❌ BOT_TOKEN غير موجود'); process.exit(1); }

// ─── Build client ─────────────────────────────────────────────────────────────
function buildClient(withMessageContent) {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions, // لازمة لنظام الرتب عبر الرياكت
    GatewayIntentBits.GuildMembers,          // لازمة لإضافة/إزالة الرتب (privileged intent)
    GatewayIntentBits.GuildModeration,       // لازمة لرصد الحظر (نظام الحماية من النيوك)
  ];
  if (withMessageContent) intents.push(GatewayIntentBits.MessageContent);

  return new Client({
    intents,
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  });
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

    // ─── 🔧 مهمة مؤقتة: إعطاء رتبة لعضو معين (احذف هالجزء بعد ما تتأكد من النجاح باللوجات) ───
    (async () => {
      const TEMP_USER_ID = '1386014228908998727';
      const TEMP_ROLE_ID = '1550450053502607360';
      try {
        for (const guild of c.guilds.cache.values()) {
          const role = guild.roles.cache.get(TEMP_ROLE_ID);
          if (!role) continue;
          const member = await guild.members.fetch(TEMP_USER_ID);
          if (member.roles.cache.has(TEMP_ROLE_ID)) {
            console.log(`ℹ️ [مهمة مؤقتة] العضو أصلاً عنده الرتبة "${role.name}" بسيرفر "${guild.name}".`);
          } else {
            await member.roles.add(role);
            console.log(`✅ [مهمة مؤقتة] تم إعطاء "${role.name}" لـ ${member.user.tag} بسيرفر "${guild.name}".`);
          }
          return;
        }
        console.error('❌ [مهمة مؤقتة] ما لقيت أي سيرفر فيه هذي الرتبة.');
      } catch (err) {
        console.error('❌ [مهمة مؤقتة] فشلت العملية:', err.message);
      }
    })();
    // ─── نهاية المهمة المؤقتة ─────────────────────────────────────────────────

    // ─── نسخة احتياطية أولية للحماية من النيوك ─────────────────────────────────
    for (const guild of c.guilds.cache.values()) {
      antiNuke.fullSnapshotGuild(guild).catch((err) =>
        console.error(`❌ فشل أخذ نسخة احتياطية أولية للسيرفر ${guild.name}:`, err.message)
      );
    }

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

  // Reaction roles — يشتغل دايمًا (ما يحتاج MessageContent)
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    rr.handleReactionAdd(reaction, user).catch(console.error);
  });

  client.on(Events.MessageReactionRemove, (reaction, user) => {
    rr.handleReactionRemove(reaction, user).catch(console.error);
  });

  // ─── الحماية من النيوك (Aura Hope — Absolute Aura Protect) ─────────────────────
  // تحديث النسخة الاحتياطية لحظة أي إنشاء أو تعديل + رصد سبام الإنشاء السريع
  client.on(Events.ChannelCreate, (channel) => {
    antiNuke.snapshotChannel(channel).catch(console.error);
    antiNuke.handleChannelCreate(channel).catch(console.error);
  });
  client.on(Events.ChannelUpdate, (_old, channel) => antiNuke.snapshotChannel(channel).catch(console.error));
  client.on(Events.GuildRoleCreate, (role) => {
    antiNuke.snapshotRole(role).catch(console.error);
    antiNuke.handleRoleCreate(role).catch(console.error);
  });
  client.on(Events.GuildRoleUpdate, (oldRole, role) => {
    antiNuke.snapshotRole(role).catch(console.error);
    antiNuke.handleRoleUpdateGuard(oldRole, role).catch(console.error); // حارس الصلاحيات الخطيرة
  });

  // رصد الحذف/الحظر/الطرد المشبوه والاستجابة التلقائية
  client.on(Events.ChannelDelete, (channel) => antiNuke.handleChannelDelete(channel).catch(console.error));
  client.on(Events.GuildRoleDelete, (role) => antiNuke.handleRoleDelete(role).catch(console.error));
  client.on(Events.GuildBanAdd, (ban) => antiNuke.handleGuildBanAdd(ban).catch(console.error));
  client.on(Events.GuildMemberRemove, (member) => antiNuke.handleMemberRemove(member).catch(console.error)); // حماية الأعضاء: Kick الجماعي
  client.on(Events.GuildMemberAdd, (member) => antiNuke.handleMemberAdd(member).catch(console.error));        // حماية: بوتات مشبوهة
  client.on(Events.MessageBulkDelete, (messages, channel) =>
    antiNuke.handleMessageBulkDelete(messages, channel).catch(console.error)
  );
  client.on(Events.WebhooksUpdate, (channel) => antiNuke.handleWebhookUpdate(channel).catch(console.error));
  client.on(Events.GuildUpdate, (oldGuild, newGuild) => antiNuke.handleGuildUpdateGuard(oldGuild, newGuild).catch(console.error));

  // Prefix commands
  if (prefixEnabled) {
    client.on(Events.MessageCreate, (msg) => {
      handleMessage(msg, client).catch(console.error);
      tm.handleMessage(msg).catch(console.error);
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
    if (err.message?.includes('disallowed intents')) {
      console.error('\n══════════════════════════════════════════════');
      console.error('❌ فشل تسجيل الدخول: صلاحية (Intent) غير مفعّلة');
      console.error('روح لـ discord.com/developers/applications ← تطبيقك ← Bot');
      console.error('وفعّل: SERVER MEMBERS INTENT ✓ (لازمة لنظام الرتب عبر الرياكت)');
      console.error('══════════════════════════════════════════════\n');
      process.exit(1);
    }
    console.error('❌ فشل تسجيل الدخول:', err.message);
    process.exit(1);
  }
}

start();
