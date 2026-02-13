require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { buildTokenEmbed, sleep } = require('./utils');
const migration = require('./routes/migration');
const dexPaid = require('./routes/dexPaid');
const cto = require('./routes/cto');

for (const k of ['DISCORD_BOT_TOKEN', 'MIGRATION_CHANNEL_ID', 'DEX_PAID_CHANNEL_ID', 'CTO_CHANNEL_ID', 'QUICKNODE_RPC_URL']) {
    if (!process.env[k]) { console.error(`❌ Missing: ${k}`); process.exit(1); }
}

const SCANNER_CHANNEL_ID = process.env.SCANNER_CHANNEL_ID || null;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.on('clientReady', () => {
    console.log(`\n✅ ${client.user.tag} online`);
    if (SCANNER_CHANNEL_ID) console.log(`[Scanner] Watching channel: ${SCANNER_CHANNEL_ID}`);
    else console.log('[Scanner] SCANNER_CHANNEL_ID not set — scanner disabled');
    client.user.setActivity('Solana Tokens', { type: ActivityType.Watching });
    migration.start(client);
    dexPaid.start(client);
    cto.start(client);
});

// ── Scanner: monitor channel for contract addresses ──
// Solana addresses are base58, 32-44 chars, no 0/O/I/l
const SOLANA_ADDR_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

client.on('messageCreate', async (message) => {
    if (!SCANNER_CHANNEL_ID) return;
    if (message.channelId !== SCANNER_CHANNEL_ID) return;
    if (message.author.bot) return;

    const matches = message.content.match(SOLANA_ADDR_RE);
    if (!matches || !matches.length) return;

    // Deduplicate
    const unique = [...new Set(matches)];

    for (const mint of unique) {
        try {
            console.log(`[Scanner] Scanning: ${mint}`);
            const { embed, components } = await buildTokenEmbed(mint, {
                sourceColor: 0xFFD700,
                sourceTag: 'scanner',
                profileData: {},
            });
            await message.channel.send({ embeds: [embed], components });
            console.log(`[Scanner] ✅ ${mint}`);
        } catch (e) {
            console.error(`[Scanner] Error for ${mint}: ${e.message}`);
            await message.channel.send({ content: `❌ Could not scan \`${mint}\` — token data not found or invalid address.` });
        }
        await sleep(2000);
    }
});

// ── Button Interaction Handler ──
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const id = interaction.customId;

    // Copy CA button: send ephemeral message with copyable address
    if (id.startsWith('copy_ca:')) {
        const mint = id.replace('copy_ca:', '');
        await interaction.reply({
            content: `\`\`\`\n${mint}\n\`\`\``,
            flags: 64, // ephemeral
        });
        return;
    }

    // Refresh button: re-fetch token data and update the embed
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
            try {
                await interaction.followUp({
                    content: '❌ Failed to refresh token data. Try again later.',
                    flags: 64,
                });
            } catch (_) {}
        }
        return;
    }
});

client.on('error', e => console.error('[Discord]', e.message));

process.on('SIGINT', () => { migration.stop(); dexPaid.stop(); cto.stop(); client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { migration.stop(); dexPaid.stop(); cto.stop(); client.destroy(); process.exit(0); });

client.login(process.env.DISCORD_BOT_TOKEN);