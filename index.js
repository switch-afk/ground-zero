require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { buildTokenEmbed } = require('./utils');
const migration = require('./routes/migration');
const dexPaid = require('./routes/dexPaid');
const cto = require('./routes/cto');
const scanner = require('./routes/scanner');

for (const k of ['DISCORD_BOT_TOKEN', 'MIGRATION_CHANNEL_ID', 'DEX_PAID_CHANNEL_ID', 'CTO_CHANNEL_ID', 'QUICKNODE_RPC_URL']) {
    if (!process.env[k]) { console.error(`❌ Missing: ${k}`); process.exit(1); }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.on('clientReady', () => {
    console.log(`\n✅ ${client.user.tag} online`);
    client.user.setActivity('Solana Tokens', { type: ActivityType.Watching });
    migration.start(client);
    dexPaid.start(client);
    cto.start(client);
    scanner.start(client);
});

// ── Interaction Handler ──
client.on('interactionCreate', async (interaction) => {

    // Scanner dropdown
    if (interaction.isStringSelectMenu()) {
        const handled = await scanner.handleInteraction(interaction);
        if (handled) return;
    }

    // Buttons
    if (!interaction.isButton()) return;

    const id = interaction.customId;

    if (id.startsWith('copy_ca:')) {
        const mint = id.replace('copy_ca:', '');
        await interaction.reply({ content: `\`\`\`\n${mint}\n\`\`\``, flags: 64 });
        return;
    }

    if (id.startsWith('refresh:')) {
        const parts = id.replace('refresh:', '').split(':');
        const mint = parts[0];
        const sourceTag = parts[1] || 'general';

        await interaction.deferUpdate();

        try {
            const colorMap = { 'migration': 0x00ff88, 'dex-paid': 0x5865F2, 'cto': 0xFF6B00, 'scanner': 0xFFD700 };
            const { embed, components } = await buildTokenEmbed(mint, {
                sourceColor: colorMap[sourceTag] || 0x5865F2,
                sourceTag,
                profileData: {},
            });
            await interaction.editReply({ embeds: [embed], components });
        } catch (e) {
            console.error(`[Refresh] Error: ${e.message}`);
            try { await interaction.followUp({ content: '❌ Failed to refresh token data.', flags: 64 }); } catch (_) {}
        }
        return;
    }
});

client.on('error', e => console.error('[Discord]', e.message));

process.on('SIGINT', () => { migration.stop(); dexPaid.stop(); cto.stop(); scanner.stop(); client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { migration.stop(); dexPaid.stop(); cto.stop(); scanner.stop(); client.destroy(); process.exit(0); });

client.login(process.env.DISCORD_BOT_TOKEN);