const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Connection, PublicKey } = require('@solana/web3.js');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const connection = new Connection(process.env.QUICKNODE_RPC_URL, 'confirmed');
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function saveData(src, mint, d) { try { const dir = path.join(DATA_DIR, src); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${mint}.json`), JSON.stringify(d, null, 2)); } catch (_) {} }

async function getTokenSupply(m) { try { return (await connection.getTokenSupply(new PublicKey(m))).value; } catch (_) { return null; } }
async function getLargest(m) { try { return (await connection.getTokenLargestAccounts(new PublicKey(m))).value.slice(0, 11); } catch (_) { return []; } }
async function getBal(a) { try { return a && typeof a === 'string' ? (await connection.getBalance(new PublicKey(a))) / 1e9 : null; } catch (_) { return null; } }
async function getRug(m) { try { return (await axios.get(`https://api.rugcheck.xyz/v1/tokens/${m}/report/summary`, { timeout: 15000 })).data; } catch (_) { return null; } }
async function getDevHoldings(owner, mint) { try { const accs = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }); let total = 0; for (const a of accs.value) total += a.account.data.parsed?.info?.tokenAmount?.uiAmount || 0; return total; } catch (_) { return 0; } }

// ══════════════════════════════════════════════════════════════
//  Get SOL price in USD
// ══════════════════════════════════════════════════════════════
let cachedSolPrice = null, solPriceTs = 0;
async function getSolPrice() {
    if (cachedSolPrice && Date.now() - solPriceTs < 30000) return cachedSolPrice;
    try {
        const { data } = await axios.get('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112', { timeout: 10000 });
        if (data?.pairs?.[0]?.priceUsd) {
            cachedSolPrice = parseFloat(data.pairs[0].priceUsd);
            solPriceTs = Date.now();
            return cachedSolPrice;
        }
    } catch (_) {}
    try {
        const { data } = await axios.get('https://price.jup.ag/v6/price?ids=SOL', { timeout: 10000 });
        if (data?.data?.SOL?.price) {
            cachedSolPrice = data.data.SOL.price;
            solPriceTs = Date.now();
            return cachedSolPrice;
        }
    } catch (_) {}
    return cachedSolPrice || 200;
}

// ══════════════════════════════════════════════════════════════
//  Get pump.fun token data (name, symbol, image, market cap, etc)
// ══════════════════════════════════════════════════════════════
async function getPumpData(mint) {
    try {
        const { data } = await axios.get(`https://frontend-api-v3.pump.fun/coins/${mint}`, { timeout: 10000 });
        if (data?.mint) return data;
    } catch (_) {}
    return null;
}

// ══════════════════════════════════════════════════════════════
//  Get on-chain liquidity for a token via RPC
//  Finds the largest SOL-paired pool by checking known pool programs
// ══════════════════════════════════════════════════════════════
async function getOnChainLiquidity(mint) {
    try {
        // Get SOL price
        const solPrice = await getSolPrice();

        // Pump.fun migration puts ~85 SOL into the pool
        // Check the token's largest accounts — the pool will hold a big chunk
        // For a rough estimate, check pump.fun API for virtual reserves
        const pump = await getPumpData(mint);
        if (pump) {
            // pump.fun API provides usd_market_cap and virtual_sol_reserves
            if (pump.usd_market_cap && pump.usd_market_cap > 0) {
                // Estimate liquidity from virtual reserves if available
                const vSol = pump.virtual_sol_reserves ? pump.virtual_sol_reserves / 1e9 : null;
                const rSol = pump.real_sol_reserves ? pump.real_sol_reserves / 1e9 : null;
                const liqSol = rSol || vSol;
                const liqUsd = liqSol ? liqSol * solPrice : null;
                return {
                    price: pump.usd_market_cap && pump.total_supply ? pump.usd_market_cap / (pump.total_supply / Math.pow(10, pump.decimals || 6)) : null,
                    mcap: pump.usd_market_cap,
                    liqUsd,
                    liqSol,
                };
            }
        }
        return null;
    } catch (_) { return null; }
}

// ══════════════════════════════════════════════════════════════
//  DexScreener Data — aggregates liquidity across ALL pairs
// ══════════════════════════════════════════════════════════════
async function getDexData(mint) {
    let pairs = null;

    try {
        const { data } = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { timeout: 15000 });
        if (Array.isArray(data?.pairs) && data.pairs.length) pairs = data.pairs;
    } catch (_) {}

    if (!pairs) {
        try {
            const { data } = await axios.get(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, { timeout: 15000 });
            if (Array.isArray(data) && data.length) pairs = data;
        } catch (_) {}
    }

    if (!pairs || !pairs.length) return { pair: null, totalLiq: null };

    let totalLiq = 0;
    for (const p of pairs) {
        if (p.liquidity?.usd) totalLiq += p.liquidity.usd;
    }

    const best = [...pairs].sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    return { pair: best, totalLiq: totalLiq > 0 ? totalLiq : null };
}

// ══════════════════════════════════════════════════════════════
//  Dex Paid Check — COMPREHENSIVE
// ══════════════════════════════════════════════════════════════
async function checkPaid(mint) {
    try {
        const { data } = await axios.get(`https://api.dexscreener.com/orders/v1/solana/${mint}`, { timeout: 10000 });
        if (Array.isArray(data) && data.length > 0) {
            const active = data.filter(o => o.status !== 'cancelled' && o.status !== 'rejected');
            if (active.length > 0) {
                const approved = active.filter(o => o.status === 'approved');
                const processing = active.filter(o => o.status === 'processing');
                const types = [...new Set(active.map(o => o.type).filter(Boolean))].map(t => {
                    if (t === 'tokenProfile') return 'Profile';
                    if (t === 'communityTakeover') return 'CTO';
                    if (t === 'tokenAd') return 'Ad';
                    if (t === 'trendingBarAd') return 'Trending';
                    return t;
                });
                const typeStr = types.join(', ');
                if (approved.length > 0) return { paid: true, text: `✅ Paid (${typeStr})` };
                if (processing.length > 0) return { paid: true, text: `⏳ Paid — Processing (${typeStr})` };
                return { paid: true, text: `✅ Paid (${typeStr})` };
            }
        }
    } catch (_) {}

    try {
        const { data } = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1', { timeout: 10000 });
        if (Array.isArray(data)) {
            const match = data.find(p => p.tokenAddress === mint && p.chainId === 'solana');
            if (match) return { paid: true, text: '✅ Paid (Profile)' };
        }
    } catch (_) {}

    try {
        const { data } = await axios.get('https://api.dexscreener.com/community-takeovers/latest/v1', { timeout: 10000 });
        if (Array.isArray(data)) {
            const match = data.find(p => p.tokenAddress === mint && p.chainId === 'solana');
            if (match) return { paid: true, text: '✅ Paid (CTO)' };
        }
    } catch (_) {}

    try {
        const { data } = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', { timeout: 10000 });
        if (Array.isArray(data)) {
            const match = data.find(p => p.tokenAddress === mint && p.chainId === 'solana');
            if (match) return { paid: true, text: `✅ Paid (Boost: ${match.totalAmount || match.amount || 0})` };
        }
    } catch (_) {}

    return { paid: false, text: 'Not Paid' };
}

// ══════════════════════════════════════════════════════════════
//  Fetch token image — multiple fallbacks
// ══════════════════════════════════════════════════════════════
async function getImg(mint) {
    try {
        const { data } = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1', { timeout: 10000 });
        if (Array.isArray(data)) {
            const match = data.find(p => p.tokenAddress === mint && p.chainId === 'solana');
            if (match?.icon) return match.icon;
        }
    } catch (_) {}
    try {
        const { data } = await axios.get('https://api.dexscreener.com/community-takeovers/latest/v1', { timeout: 10000 });
        if (Array.isArray(data)) {
            const match = data.find(p => p.tokenAddress === mint && p.chainId === 'solana');
            if (match?.icon) return match.icon;
        }
    } catch (_) {}
    try {
        const { data } = await axios.get(`https://frontend-api-v3.pump.fun/coins/${mint}`, { timeout: 10000 });
        if (data?.image_uri) return data.image_uri;
    } catch (_) {}
    return null;
}

// ══════════════════════════════════════════════════════════════
//  Formatting helpers
// ══════════════════════════════════════════════════════════════
function fN(n) { if (n == null || isNaN(Number(n))) return 'N/A'; n = Number(n); if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`; if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`; if (n >= 1e3) return `${(n/1e3).toFixed(2)}K`; if (n > 0 && n < 0.0001) return n.toExponential(2); return n.toFixed(2); }
function fU(n) { return n == null || isNaN(Number(n)) ? 'N/A' : `$${fN(Number(n))}`; }
function fP(v) { if (v == null) return 'N/A'; const n = Number(v); if (isNaN(n)) return 'N/A'; if (n < 0.000001) return `$${n.toExponential(2)}`; if (n < 0.01) return `$${n.toFixed(8)}`; if (n < 1) return `$${n.toFixed(6)}`; return `$${n.toFixed(2)}`; }
function fPct(n) { if (n == null || isNaN(Number(n))) return 'N/A'; n = Number(n); return `${n >= 0 ? '🟢' : '🔴'} ${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }
function tA(ts) { if (!ts) return 'N/A'; const d = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime()); if (isNaN(d) || d < 0) return 'Just now'; const s = Math.floor(d/1000); if (s < 60) return `${s}s ago`; const m = Math.floor(s/60); if (m < 60) return `${m}m ago`; const h = Math.floor(m/60); if (h < 24) return `${h}h ${m%60}m ago`; return `${Math.floor(h/24)}d ${h%24}h ago`; }
function cap(s) { return s && typeof s === 'string' ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function detectLP(p) {
    if (!p) return 'Unknown';
    const d = (p.dexId||'').toLowerCase(), l = (p.labels||[]).map(x=>String(x).toLowerCase()), a = String(p.baseToken?.address||'');
    if (d.includes('pumpswap')||d.includes('pumpfun')||l.includes('pump.fun')||a.endsWith('pump')) return 'pump.fun';
    if (d.includes('bonk')||d.includes('letsbonk')||l.includes('letsbonk')||a.endsWith('bonk')) return 'letsbonk.fun';
    if (d.includes('raydium')) return 'Raydium'; if (d.includes('orca')) return 'Orca'; if (d.includes('meteora')) return 'Meteora';
    return d || 'Unknown';
}

// ══════════════════════════════════════════════════════════════
//  Build Token Embed
// ══════════════════════════════════════════════════════════════
async function buildTokenEmbed(mint, { sourceColor, sourceTag, profileData }) {
    const [{ pair, totalLiq }, supply, topRaw, rug, paid] = await Promise.all([
        getDexData(mint),
        getTokenSupply(mint),
        getLargest(mint),
        getRug(mint),
        checkPaid(mint),
    ]);

    // ── Fallback: pump.fun API + RPC when DexScreener has no data ──
    let pumpData = await getPumpData(mint);
    let onChain = null;
    if (!pair) {
        onChain = await getOnChainLiquidity(mint);
    }

    const name = pair?.baseToken?.name || pumpData?.name || profileData?.name || 'Unknown';
    const symbol = pair?.baseToken?.symbol || pumpData?.symbol || profileData?.symbol || '???';
    const dexUrl = pair?.url || `https://dexscreener.com/solana/${mint}`;
    const chainId = pair?.chainId || 'solana';

    // ── Detect launchpad from mint suffix when no pair ──
    let lp = detectLP(pair);
    if (lp === 'Unknown') {
        if (mint.endsWith('pump')) lp = 'pump.fun';
        else if (mint.endsWith('bonk')) lp = 'letsbonk.fun';
    }
    const isPump = lp === 'pump.fun', isBonk = lp === 'letsbonk.fun';

    let img = pair?.info?.imageUrl || profileData?.icon || pumpData?.image_uri || null;
    if (!img) img = await getImg(mint);

    // ── Socials ──
    const socials = [], seenUrls = new Set();
    for (const w of (pair?.info?.websites||[])) { if (w?.url && !seenUrls.has(w.url)) { socials.push(`[Website](${w.url})`); seenUrls.add(w.url); } }
    for (const s of (pair?.info?.socials||[])) { if (s?.url && !seenUrls.has(s.url)) { socials.push(`[${cap(s.platform||s.type||'Social')}](${s.url})`); seenUrls.add(s.url); } }
    for (const l of (profileData?.links||[])) { if (l?.url && !seenUrls.has(l.url)) { socials.push(`[${cap(l.label||l.type||'Link')}](${l.url})`); seenUrls.add(l.url); } }
    if (pumpData) {
        if (pumpData.website && !seenUrls.has(pumpData.website)) { socials.push(`[Website](${pumpData.website})`); seenUrls.add(pumpData.website); }
        if (pumpData.twitter && !seenUrls.has(pumpData.twitter)) { socials.push(`[Twitter](${pumpData.twitter})`); seenUrls.add(pumpData.twitter); }
        if (pumpData.telegram && !seenUrls.has(pumpData.telegram)) { socials.push(`[Telegram](${pumpData.telegram})`); seenUrls.add(pumpData.telegram); }
    }

    const creator = (rug?.creator && typeof rug.creator === 'string') ? rug.creator :
                    (pumpData?.creator ? pumpData.creator : null);
    const [creatorBal, devHoldings] = creator ? await Promise.all([getBal(creator), getDevHoldings(creator, mint)]) : [null, 0];

    // ── Market Data — DexScreener primary, on-chain/pump.fun fallback ──
    const price = pair?.priceUsd ? fP(pair.priceUsd) :
                  (onChain?.price ? fP(onChain.price) : 'N/A');

    const mcap = pair?.marketCap || pair?.fdv ? fU(pair.marketCap || pair.fdv) :
                 (onChain?.mcap ? fU(onChain.mcap) :
                 (pumpData?.usd_market_cap ? fU(pumpData.usd_market_cap) : 'N/A'));

    const liq = totalLiq != null ? fU(totalLiq) :
                (pair?.liquidity?.usd != null ? fU(pair.liquidity.usd) :
                (onChain?.liqUsd ? fU(onChain.liqUsd) : null));

    const launched = tA(pair?.pairCreatedAt || (pumpData?.created_timestamp ? pumpData.created_timestamp * 1000 : null));
    const supplyStr = supply ? fN(supply.uiAmount) : 'N/A';
    const vol1h = pair?.volume?.h1 != null ? fU(pair.volume.h1) : 'N/A';
    const vol24h = pair?.volume?.h24 != null ? fU(pair.volume.h24) : 'N/A';
    const ch1h = pair?.priceChange?.h1 != null ? fPct(pair.priceChange.h1) : 'N/A';
    const ch24h = pair?.priceChange?.h24 != null ? fPct(pair.priceChange.h24) : 'N/A';
    const tx1h = pair?.txns?.h1 || {}, tx24h = pair?.txns?.h24 || {};
    const tr1h = `${tx1h.buys??0}B / ${tx1h.sells??0}S`, tr24h = `${tx24h.buys??0}B / ${tx24h.sells??0}S`;

    // ── Dex Paid ──
    let paidText = paid.text;
    if (pair?.boosts?.active) {
        if (!paid.paid) paidText = '✅ Paid';
        paidText += ` | 🚀 ${pair.boosts.active} boosts`;
    }
    if (!paid.paid && !pair?.boosts?.active && pair?.info?.imageUrl && (pair?.info?.websites?.length || pair?.info?.socials?.length)) {
        paidText = '✅ Paid';
    }

    // ── RugCheck ──
    let rugLvl = '❓ Unknown', rugScr = 'N/A', rugR = [];
    if (rug) {
        rugScr = rug.score ?? 'N/A';
        const s = typeof rug.score === 'number' ? rug.score : 99999;
        rugLvl = s > 8000 ? '🔴 EXTREME RISK' : s > 5000 ? '🟠 HIGH RISK' : s > 2000 ? '🟡 MODERATE RISK' : '🟢 LOW RISK';
        rugR = (rug.risks||[]).slice(0,5).map(r => `${r.level==='danger'?'🔴':r.level==='warn'?'🟡':'⚪'} ${r.name||r.description||'Unknown'}`);
    }

    // ── Top 10 Holders ──
    let holdersField = '';
    if (topRaw.length > 1 && supply?.uiAmount > 0) {
        const tot = supply.uiAmount, h = topRaw.slice(1, 11);
        let pctS = 0;
        const L = [], R = [];
        h.forEach((x, i) => {
            const pct = ((x.uiAmount||0)/tot*100).toFixed(2);
            pctS += parseFloat(pct);
            const ln = `**${i+1}.** ${fN(x.uiAmount)} (${pct}%)`;
            i < 5 ? L.push(ln) : R.push(ln);
        });
        const lines = [];
        for (let i = 0; i < Math.max(L.length, R.length); i++) {
            const left = L[i] || '';
            const right = R[i] ? `\u2003\u2003\u2003${R[i]}` : '';
            lines.push(`${left}${right}`);
        }
        holdersField = `👥 **Top 10 Holders (${pctS.toFixed(2)}% Total)**\n\n${lines.join('\n\n')}`;
    }

    // ── Persist ──
    saveData(sourceTag||'general', mint, { mint, name, symbol, chainId, lp, price: pair?.priceUsd || onChain?.price, mcap: pair?.marketCap || onChain?.mcap || pumpData?.usd_market_cap, liq: totalLiq || onChain?.liqUsd, volume: pair?.volume, priceChange: pair?.priceChange, txns: pair?.txns, supply: supply ? { uiAmount: supply.uiAmount, decimals: supply.decimals } : null, dexPaid: paidText, rugScore: rugScr, rugLevel: rugLvl, creator, img, pairCreatedAt: pair?.pairCreatedAt, at: new Date().toISOString() });

    // ══════════════════════════════════════════════════════════
    //  Build Embed
    // ══════════════════════════════════════════════════════════
    const embed = new EmbedBuilder()
        .setColor(sourceColor || 0x5865F2);

    embed.setTitle(`${name} ($${symbol})`).setURL(dexUrl);
    if (img) embed.setThumbnail(img);

    const desc = [];
    if (profileData?.description) desc.push(profileData.description.slice(0,200));
    else if (pumpData?.description) desc.push(pumpData.description.slice(0,200));
    if (socials.length) desc.push(`🔗 ${socials.join(' • ')}`);
    if (desc.length) embed.setDescription(desc.join('\n\n'));

    embed.addFields(
        { name: '📋 Contract Address', value: `\`${mint}\``, inline: false },
    );
    if (creator) {
        const solscanUrl = `https://solscan.io/account/${creator}`;
        const details = [];
        if (creatorBal !== null) details.push(`💰 ${creatorBal.toFixed(2)} SOL`);
        if (devHoldings > 0 && supply?.uiAmount > 0) details.push(`📦 Holdings: ${(devHoldings / supply.uiAmount * 100).toFixed(2)}%`);
        const detailLine = details.length ? `\n${details.join(' | ')}` : '';
        embed.addFields({ name: '👤 Dev Wallet', value: `[${creator}](${solscanUrl})${detailLine}`, inline: false });
    }

    embed.addFields(
        { name: '⛓️ Chain', value: cap(chainId), inline: true },
        { name: '🚀 Launchpad', value: lp, inline: true },
        { name: '⏰ Launched', value: launched, inline: true },

        { name: '💰 Price', value: price, inline: true },
        { name: '📊 Market Cap', value: mcap, inline: true },
    );

    if (liq && liq !== 'N/A') {
        embed.addFields({ name: '💧 Liquidity', value: liq, inline: true });
    } else {
        embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
    }

    embed.addFields(
        { name: '📦 Total Supply', value: supplyStr, inline: true },
        { name: '🏷️ Dex Paid', value: paidText, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: '📈 1H Change', value: ch1h, inline: true },
        { name: '💵 1H Volume', value: vol1h, inline: true },
        { name: '🔄 1H Trades', value: tr1h, inline: true },

        { name: '📈 24H Change', value: ch24h, inline: true },
        { name: '💵 24H Volume', value: vol24h, inline: true },
        { name: '🔄 24H Trades', value: tr24h, inline: true },

        { name: `🛡️ RugCheck — ${rugLvl}`, value: [`**Score:** ${rugScr}`, ...rugR].join('\n') || 'No data', inline: false },
    );

    if (holdersField) {
        embed.addFields({ name: '\u200b', value: holdersField, inline: false });
    }

    // ── Buttons ──
    const row = new ActionRowBuilder();
    row.addComponents(
        new ButtonBuilder().setLabel('DexScreener').setStyle(ButtonStyle.Link).setURL(dexUrl).setEmoji('📊'),
    );
    if (isPump) row.addComponents(
        new ButtonBuilder().setLabel('Pump.fun').setStyle(ButtonStyle.Link).setURL(`https://pump.fun/coin/${mint}`).setEmoji('🟢'),
    );
    if (isBonk) row.addComponents(
        new ButtonBuilder().setLabel('LetsBonk.fun').setStyle(ButtonStyle.Link).setURL(`https://letsbonk.fun/token/${mint}`).setEmoji('🐕'),
    );
    row.addComponents(
        new ButtonBuilder().setLabel('Padre').setStyle(ButtonStyle.Link).setURL(`https://trade.padre.gg/trade/solana/${mint}`).setEmoji('🪖'),
        new ButtonBuilder().setCustomId(`copy_ca:${mint}`).setLabel('Copy CA').setStyle(ButtonStyle.Secondary).setEmoji('📋'),
        new ButtonBuilder().setCustomId(`refresh:${mint}:${sourceTag||'general'}`).setLabel('Refresh').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
    );

    return { embed, components: [row] };
}

module.exports = { buildTokenEmbed, sleep };