const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');

const BRAND_IMAGES = ['aura1.jpg', 'aura2.jpg', 'aura3.jpg'];
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('كل أوامر البوت بمكان وحد'),

  async execute(interaction) {
    const filename = BRAND_IMAGES[Math.floor(Math.random() * BRAND_IMAGES.length)];
    const attachment = new AttachmentBuilder(path.join(ASSETS_DIR, filename), { name: filename });

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({ name: '📖 دليل أوامر أورا' })
      .setThumbnail(`attachment://${filename}`)
      .setDescription('كل أنظمة البوت وأوامرها بمكان وحد 👇')
      .addFields(
        {
          name: '🏆 نظام النقاط',
          value: [
            '`!تسجيل @عضو <نقاط> <سبب>` — إضافة نقاط',
            '`!خصم @عضو <نقاط> <سبب>` — خصم نقاط (المالك)',
            '`!تعيين @عضو <نقاط> <سبب>` — تعيين نقاط (المالك)',
            '`!تصفير @عضو تأكيد` — تصفير (المالك)',
            '`!حذف_سجل <رقم>` — حذف عملية (المالك)',
            '`!نقاط @عضو` — عرض نقاط عضو',
            '`!سجل @عضو` — السجل الكامل لعضو',
            '`!سجل_قديم` — سجل كل السيرفر (المالك)',
            '`!ترتيب` — لوحة الصدارة',
            '`!تقرير` — تقرير فوري (المالك)',
          ].join('\n'),
        },
        {
          name: '🎭 الرتب عبر الرياكت',
          value: [
            '`/reaction-role add` — اربط إيموجي على رسالة برتبة',
            '`/reaction-role remove` — احذف ربط',
            '`/reaction-role list` — اعرض كل الروابط',
          ].join('\n'),
        },
        {
          name: '🛡️ الحماية من النيوك — Aura Hope',
          value: [
            '`/anti-nuke on` / `off` — تشغيل/إيقاف',
            '`/anti-nuke status` — الحالة والعتبة',
            '`/anti-nuke log-channel` — قناة التنبيهات',
            '`/anti-nuke resync` — تحديث النسخة الاحتياطية',
            '`/anti-nuke whitelist add/remove/list` — الأعضاء الموثوقون',
          ].join('\n'),
        },
      )
      .setFooter({ text: 'أورا 🏆 — يراقب النقاط ويحمي السيرفر' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], files: [attachment] });
  },
};
