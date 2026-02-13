const axios = require('axios');
const { buildTokenEmbed, sleep } = require('../utils');

const POLL_INTERVAL = 60_000;
const API = 'https://api.dexscreener.com/community-takeovers/latest/v1';
let pollTimer = null, seen = new Set();

function start(client) {
    const ch = process.env.CTO_CHANNEL_ID;
    if (!ch) { console.error('[CTO] CTO_CHANNEL_ID not set'); return; }
    console.log('[CTO] Starting...');
    poll(client, ch);
    pollTimer = setInterval(() => poll(client, ch), POLL_INTERVAL);
}

async function poll(client, channelId) {
    try {
        const { data: items } = await axios.get(API, { timeout: 15000 });
        if (!Array.isArray(items)) return;
        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        const batch = items
            .filter(t => t.chainId === 'solana' && typeof t.tokenAddress === 'string' && !seen.has(t.tokenAddress))
            .slice(0, 10);

        for (const t of batch) {
            seen.add(t.tokenAddress);
            try {
                const { embed, components } = await buildTokenEmbed(t.tokenAddress, {
                    sourceColor: 0xFF6B00,
                    sourceTag: 'cto',
                    profileData: { icon: t.icon, description: t.description, links: t.links || [] },
                });
                await channel.send({ embeds: [embed], components });
                console.log(`[CTO] ✅ ${t.tokenAddress}`);
            } catch (e) { console.error(`[CTO] ${t.tokenAddress}: ${e.message}`); }
            await sleep(2000);
        }

        if (seen.size > 5000) seen = new Set([...seen].slice(-2000));
    } catch (e) { console.error('[CTO] Poll:', e.message); }
}

function stop() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
module.exports = { start, stop };