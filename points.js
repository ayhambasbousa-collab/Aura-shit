const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../database');

function buildBar(pct) {
  const f = Math.round(pct / 10);
  return '🟩'.repeat(f) + '⬛'.repeat(10 - f);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('نقاط')
    .setDescription('عرض نقاط عضو')
    .addUserOption(o => o.setName('العضو').setDescription('العضو (افتراضياً أنت)').setRequired(false)),

  async execute(interaction) {
    const settings   = await db.getGuildSettings(interaction.guildId);
    const targetUser = interaction.options.getUser('العضو') ?? interaction.user;

    const total     = await db.getPoints(targetUser.id, interaction.guildId);
    const threshold = settings.promotion_threshold;
    const pct       = Math.min(Math.round((total / threshold) * 100), 100);
    const eligible  = total >= threshold;
    const near      = !eligible && pct >= 80;

    const embed = new EmbedBuilder()
      .setColor(eligible ? 0xFFD700 : near ? 0xFF9800 : 0x5865F2)
      .setTitle(`🏆 نقاط ${targetUser.username}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: '📊 المجموع الكلي', value: `\`${total}\` نقطة`,            inline: true  },
        { name: '🎯 هدف الترقية',   value: `\`${threshold}\` نقطة`,        inline: true  },
        { name: '📈 التقدم',        value: `${buildBar(pct)} \`${pct}%\``, inline: false },
        { name: '⭐ الحالة', value:
            eligible ? '✅ **مؤهل للترقية**' :
            near     ? `⚠️ قريب! بقي \`${threshold - total}\` نقطة` :
                       `يحتاج \`${threshold - total}\` نقطة`,
          inline: false },
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
