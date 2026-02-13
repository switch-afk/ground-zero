# Solana Token Tracker — Discord Bot

Tracks new Solana token migrations, DexScreener paid profiles, community takeovers, and lets users scan any token by pasting a contract address.

## Channels

| Channel | Source | What it tracks |
|---------|--------|---------------|
| #bonding | PumpPortal WebSocket | pump.fun + letsbonk.fun migrations |
| #dex-paid | DexScreener API (polls every 60s) | Tokens that paid for DexScreener profile listing |
| #community-takeover | DexScreener API (polls every 60s) | Community takeover tokens |
| #scanner | User messages | Paste any Solana CA → bot scans and replies with full token data |

## Features

- Token price, market cap, liquidity (aggregated across all pairs)
- Dex Paid status (checks orders API + profiles + CTO + boosts endpoints)
- RugCheck score and risk level
- Top 10 holders (LP wallet excluded)
- Dev wallet balance
- Social links and token image
- Copy CA button (sends copyable address)
- Refresh button (re-fetches latest data)

## Setup

```bash
git clone <repo>
cd solana-discord-bot
npm install
cp .env.example .env
# Fill in your .env values
node index.js
```

## Environment Variables

```
DISCORD_BOT_TOKEN=       # Discord bot token
MIGRATION_CHANNEL_ID=    # #bonding channel ID
DEX_PAID_CHANNEL_ID=     # #dex-paid channel ID
CTO_CHANNEL_ID=          # #community-takeover channel ID
SCANNER_CHANNEL_ID=      # #scanner channel ID (optional)
QUICKNODE_RPC_URL=       # Solana RPC endpoint (QuickNode recommended)
```

## Bot Permissions

Enable these intents in Discord Developer Portal:
- Server Members Intent
- Message Content Intent

Bot needs these permissions:
- Send Messages
- Embed Links
- Use External Emojis
- Read Message History

## File Structure

```
├── index.js              # Entry point, button handlers, scanner listener
├── utils.js              # Core logic: API calls, embed builder, formatting
├── routes/
│   ├── migration.js      # PumpPortal WebSocket (pump.fun + letsbonk.fun)
│   ├── dexPaid.js        # DexScreener paid profiles polling
│   └── cto.js            # DexScreener community takeovers polling
├── data/                 # Auto-created, stores token JSON snapshots
├── package.json
└── .env
```

## Run with PM2

```bash
pm2 start index.js --name solana-bot
pm2 logs solana-bot
```