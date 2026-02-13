const WebSocket = require('ws');
const { buildTokenEmbed, sleep } = require('../utils');

let ws = null, reconnectTimeout = null, processing = false;
const queue = [];

function start(client) {
    const ch = process.env.MIGRATION_CHANNEL_ID;
    if (!ch) { console.error('[Migration] MIGRATION_CHANNEL_ID not set'); return; }
    connect(client, ch);
}

function connect(client, channelId) {
    if (ws) try { ws.close(); } catch (_) {}
    console.log('[Migration] Connecting to PumpPortal (pump.fun + letsbonk.fun)...');
    ws = new WebSocket('wss://pumpportal.fun/api/data');

    ws.on('open', () => {
        console.log('[Migration] Connected — subscribing to migrations (pump.fun + letsbonk.fun)...');
        // Single subscribeMigration covers BOTH pump.fun and letsbonk.fun migrations
        ws.send(JSON.stringify({ method: 'subscribeMigration' }));
    });

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw.toString());
            if (data.message) { console.log(`[Migration] ${data.message}`); return; }
            if (!data.mint || typeof data.mint !== 'string') return;

            // Detect platform from mint address suffix or pool info
            const mint = data.mint;
            const platform = mint.endsWith('bonk') ? 'letsbonk.fun' :
                             mint.endsWith('pump') ? 'pump.fun' : 'unknown';
            data._platform = platform;

            console.log(`[Migration] Queued: ${mint} (${platform} → ${data.pool || 'unknown pool'})`);
            queue.push(data);
            processQueue(client, channelId);
        } catch (e) { console.error('[Migration] Parse:', e.message); }
    });

    ws.on('close', () => { console.log('[Migration] Disconnected, reconnecting 5s...'); scheduleReconnect(client, channelId); });
    ws.on('error', (e) => console.error('[Migration] WS:', e.message));
}

async function processQueue(client, channelId) {
    if (processing) return;
    processing = true;
    while (queue.length > 0) {
        const data = queue.shift();
        try {
            const channel = client.channels.cache.get(channelId);
            if (!channel) { console.error('[Migration] Channel not found'); continue; }

            console.log(`[Migration] Processing: ${data.mint} (${data._platform})`);
            const { embed, components } = await buildTokenEmbed(data.mint, {
                sourceColor: 0x00ff88,
                sourceTag: 'migration',
                profileData: {},
            });
            await channel.send({ embeds: [embed], components });
            console.log(`[Migration] ✅ ${data.mint} (${data._platform})`);
        } catch (e) { console.error(`[Migration] Error: ${e.message}`); }
        await sleep(2000);
    }
    processing = false;
}

function scheduleReconnect(client, ch) {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(() => connect(client, ch), 5000);
}

function stop() {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (ws) try { ws.close(); } catch (_) {}
    ws = null;
}

module.exports = { start, stop };