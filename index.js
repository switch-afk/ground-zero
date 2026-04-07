require('dotenv').config();
const axios = require('axios');
const { Client, GatewayIntentBits, ActivityType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
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

// ── Scanner: monitor channel for contract addresses + ticker search ──
const SOLANA_ADDR_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const TICKER_RE = /\$([a-zA-Z][a-zA-Z0-9]{0,19})/g;

client.on('messageCreate', async (message) => {
    if (!SCANNER_CHANNEL_ID) return;
    if (message.channelId !== SCANNER_CHANNEL_ID) return;
    if (message.author.bot) return;

    const text = message.content;

    // ── Check for contract addresses first ──
    const addrMatches = text.match(SOLANA_ADDR_RE);
    if (addrMatches && addrMatches.length) {
        const unique = [...new Set(addrMatches)];
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
        return;
    }

    // ── Check for ticker symbols ($LION, $PEPE, etc.) ──
    const tickerMatches = [...text.matchAll(TICKER_RE)].map(m => m[1]);
    if (!tickerMatches.length) return;

    const uniqueTickers = [...new Set(tickerMatches.map(t => t.toUpperCase()))];

    for (const ticker of uniqueTickers) {
        try {
            console.log(`[Scanner] Searching ticker: $${ticker}`);
            const { data } = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${ticker}`, { timeout: 15000 });

            if (!data?.pairs?.length) {
                await message.channel.send({ content: `❌ No results found for **$${ticker}**` });
                continue;
            }

            // Filter Solana pairs, deduplicate by token address, prioritize exact symbol match
            const seen = new Set();
            const exact = [];
            const partial = [];

            for (const pair of data.pairs) {
                if (pair.chainId !== 'solana') continue;
                const addr = pair.baseToken?.address;
                if (!addr || seen.has(addr)) continue;
                seen.add(addr);

                if (pair.baseToken?.symbol?.toUpperCase() === ticker) {
                    exact.push(pair);
                } else {
                    partial.push(pair);
                }
            }

            // Exact matches first, then partial, max 10
            const results = [...exact, ...partial].slice(0, 10);

            if (!results.length) {
                await message.channel.send({ content: `❌ No Solana tokens found for **$${ticker}**` });
                continue;
            }

            // If only 1 result, scan directly
            if (results.length === 1) {
                const mint = results[0].baseToken.address;
                console.log(`[Scanner] Single result for $${ticker}, scanning: ${mint}`);
                const { embed, components } = await buildTokenEmbed(mint, {
                    sourceColor: 0xFFD700,
                    sourceTag: 'scanner',
                    profileData: {},
                });
                await message.channel.send({ embeds: [embed], components });
                continue;
            }

            // Multiple results → show dropdown
            const fmtMcap = (n) => {
                if (!n) return '???';
                if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
                if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
                return `${n.toFixed(0)}`;
            };

            const options = results.map((pair) => {
                const name = pair.baseToken?.name || 'Unknown';
                const sym = pair.baseToken?.symbol || '???';
                const mcap = fmtMcap(pair.marketCap || pair.fdv);
                const liq = fmtMcap(pair.liquidity?.usd);
                const addr = pair.baseToken.address;
                const label = `${name} ($${sym})`.slice(0, 100);
                const desc = `MC: $${mcap} | Liq: $${liq} | ${addr.slice(0,6)}...${addr.slice(-4)}`.slice(0, 100);

                return { label, description: desc, value: `scan:${addr}` };
            });

            const select = new StringSelectMenuBuilder()
                .setCustomId(`ticker:${message.id}`)
                .setPlaceholder(`Select a token for $${ticker}`)
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(select);

            await message.channel.send({
                content: `🔍 Found **${results.length}** Solana tokens for **$${ticker}** — pick one:`,
                components: [row],
            });

            console.log(`[Scanner] Showed ${results.length} results for $${ticker}`);

        } catch (e) {
            console.error(`[Scanner] Ticker search error for $${ticker}: ${e.message}`);
            await message.channel.send({ content: `❌ Error searching for **$${ticker}**` });
        }
        await sleep(1000);
    }
});

// ── Interaction Handler (buttons + dropdown) ──
client.on('interactionCreate', async (interaction) => {

    // ── Dropdown selection: scan the chosen token ──
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticker:')) {
        const selected = interaction.values[0];
        if (!selected?.startsWith('scan:')) return;

        const mint = selected.replace('scan:', '');
        await interaction.deferUpdate();

        try {
            console.log(`[Scanner] Dropdown selected: ${mint}`);
            const { embed, components } = await buildTokenEmbed(mint, {
                sourceColor: 0xFFD700,
                sourceTag: 'scanner',
                profileData: {},
            });

            await interaction.editReply({
                content: null,
                embeds: [embed],
                components,
            });
            console.log(`[Scanner] ✅ ${mint} (from dropdown)`);
        } catch (e) {
            console.error(`[Scanner] Dropdown scan error: ${e.message}`);
            await interaction.editReply({
                content: `❌ Could not scan this token. Try pasting the CA directly.`,
                components: [],
            });
        }
        return;
    }

    // ── Button interactions ──
    if (!interaction.isButton()) return;

    const id = interaction.customId;

    if (id.startsWith('copy_ca:')) {
        const mint = id.replace('copy_ca:', '');
        await interaction.reply({
            content: `\`\`\`\n${mint}\n\`\`\``,
            flags: 64,
        });
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