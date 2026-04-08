const axios = require('axios');
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { buildTokenEmbed, sleep } = require('../utils');

const SOLANA_ADDR_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const TICKER_RE = /\$([a-zA-Z0-9][a-zA-Z0-9]{0,19})/g;

let channelId = null;

function start(client) {
    channelId = process.env.SCANNER_CHANNEL_ID || null;
    if (!channelId) { console.log('[Scanner] SCANNER_CHANNEL_ID not set — disabled'); return; }
    console.log(`[Scanner] Watching channel: ${channelId}`);

    // ── Message listener: CA scan + ticker search ──
    client.on('messageCreate', async (message) => {
        if (message.channelId !== channelId) return;
        if (message.author.bot) return;

        const text = message.content;

        // ── Contract address scan ──
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

        // ── Ticker search ($LION, $PEPE, $49, etc.) ──
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

                // Filter Solana pairs, deduplicate, exact symbol match first
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

                const results = [...exact, ...partial].slice(0, 10);

                if (!results.length) {
                    await message.channel.send({ content: `❌ No Solana tokens found for **$${ticker}**` });
                    continue;
                }

                // Single result → scan directly
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

                // Multiple results → dropdown
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
}

// ── Handle dropdown selection ──
async function handleInteraction(interaction) {
    if (!interaction.isStringSelectMenu()) return false;
    if (!interaction.customId.startsWith('ticker:')) return false;

    const selected = interaction.values[0];
    if (!selected?.startsWith('scan:')) return false;

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
    return true;
}

function stop() {}

module.exports = { start, stop, handleInteraction };