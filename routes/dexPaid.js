const axios = require('axios');
const { buildTokenEmbed, sleep } = require('../utils');

const POLL_INTERVAL = 60_000;
const API = 'https://api.dexscreener.com/token-profiles/latest/v1';
let pollTimer = null, seen = new Set();

function start(client) {
    const ch = process.env.DEX_PAID_CHANNEL_ID;
    if (!ch) { console.error('[DexPaid] DEX_PAID_CHANNEL_ID not set'); return; }
    console.log('[DexPaid] Starting...');
    poll(client, ch);
    pollTimer = setInterval(() => poll(client, ch), POLL_INTERVAL);
}

async function poll(client, channelId) {
    try {
        const { data: profiles } = await axios.get(API, { timeout: 15000 });
        if (!Array.isArray(profiles)) return;
        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        const batch = profiles
            .filter(p => p.chainId === 'solana' && typeof p.tokenAddress === 'string' && !seen.has(p.tokenAddress))
            .slice(0, 10);

        for (const p of batch) {
            seen.add(p.tokenAddress);
            try {
                const { embed, components } = await buildTokenEmbed(p.tokenAddress, {
                    sourceColor: 0x5865F2,
                    sourceTag: 'dex-paid',
                    profileData: { icon: p.icon, description: p.description, links: p.links || [] },
                });
                await channel.send({ embeds: [embed], components });
                console.log(`[DexPaid] ✅ ${p.tokenAddress}`);
            } catch (e) { console.error(`[DexPaid] ${p.tokenAddress}: ${e.message}`); }
            await sleep(2000);
        }

        if (seen.size > 5000) seen = new Set([...seen].slice(-2000));
    } catch (e) { console.error('[DexPaid] Poll:', e.message); }
}

function stop() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
module.exports = { start, stop };