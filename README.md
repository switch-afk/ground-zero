# Ground Zero

Solana token tracker Discord bot. Monitors migrations, DexScreener paid profiles, community takeovers, and scans any token by CA or ticker.

## Channels

| Channel | Source | What it tracks |
|---------|--------|---------------|
| #bonding | PumpPortal WebSocket | pump.fun + letsbonk.fun migrations |
| #dex-paid | DexScreener API (2s poll) | Tokens with paid DexScreener profiles |
| #community-takeover | DexScreener API (2s poll) | Community takeover tokens |
| #scanner | User messages | Paste CA or type `$TICKER` to scan any Solana token |

## Features

- Token price, market cap, liquidity (aggregated across all pairs)
- Dex Paid status (checks orders API + profiles + CTO + boosts endpoints)
- RugCheck score and risk level
- Top 10 holders (LP wallet excluded)
- Dev wallet balance
- Social links and token image
- Ticker search with dropdown selector (`$LION`, `$PEPE`, etc.)
- Copy CA button (sends copyable address)
- Refresh button (re-fetches latest data)

## Demo

[![Ground Zero](https://img.youtube.com/vi/fRbbp0uBzrc/maxresdefault.jpg)](https://youtu.be/fRbbp0uBzrc)

## Setup

```bash
git clone https://github.com/switch-afk/ground-zero
cd ground-zero
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
├── index.js              # Entry point, button handlers
├── utils.js              # Core logic: API calls, embed builder, formatting
├── routes/
│   ├── migration.js      # PumpPortal WebSocket (pump.fun + letsbonk.fun)
│   ├── dexPaid.js        # DexScreener paid profiles polling
│   ├── cto.js            # DexScreener community takeovers polling
│   └── scanner.js        # CA scan + ticker search with dropdown
├── data/                 # Auto-created, stores token JSON snapshots
├── package.json
└── .env
```

## Run with PM2

```bash
pm2 start index.js --name ground-zero
pm2 logs ground-zero
```