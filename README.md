# Ground Zero

Solana token tracker Discord bot. Monitors migrations, DexScreener paid profiles, community takeovers, and scans any token by CA or ticker.

## Channels

| Channel | Source | What it tracks |
|---------|--------|---------------|
| #bonding | PumpPortal WebSocket | pump.fun + letsbonk.fun migrations |
| #dex-paid | DexScreener API (2s poll) | Tokens with paid DexScreener profiles |
| #community-takeover | DexScreener API (2s poll) | Community takeover tokens |
| #scanner | User messages | Paste CA or type `$TICKER` to scan any Solana token |

## Scanner

The scanner channel supports two input methods:

- **Contract Address** — paste any Solana CA, bot scans and replies with full token data
- **Ticker Search** — type `$LION`, `$PEPE`, etc. Bot searches DexScreener, shows a dropdown of matching Solana tokens. Pick one to get the full scan. If only one match is found, it scans directly.

## Token Data

Each scan shows:

- Price, market cap, liquidity (aggregated across all pairs)
- Dex Paid status (orders API + profiles + CTO + boosts)
- RugCheck score and risk level
- Top 10 holders (LP wallet excluded)
- Dev wallet with SOL balance
- Social links and token image
- 1H/24H price change, volume, and trade counts
- Copy CA and Refresh buttons

## Setup

```bash
git clone https://github.com/switch-afk/ground-zero.git
cd ground-zero
npm install
cp .env.example .env
```

Fill in your `.env` values, then:

```bash
node index.js
```

## Environment Variables

```
DISCORD_BOT_TOKEN        Discord bot token
MIGRATION_CHANNEL_ID     #bonding channel ID
DEX_PAID_CHANNEL_ID      #dex-paid channel ID
CTO_CHANNEL_ID           #community-takeover channel ID
SCANNER_CHANNEL_ID       #scanner channel ID (optional)
QUICKNODE_RPC_URL        Solana RPC endpoint
```

## Discord Bot Setup

Enable in Developer Portal → Bot → Privileged Gateway Intents:
- Message Content Intent

Bot permissions: Send Messages, Embed Links, Use External Emojis, Read Message History

## File Structure

```
├── index.js              # Entry point, scanner, buttons, ticker dropdown
├── utils.js              # API calls, embed builder, formatting
├── routes/
│   ├── migration.js      # PumpPortal WS (pump.fun + letsbonk.fun)
│   ├── dexPaid.js        # DexScreener paid profiles
│   └── cto.js            # DexScreener community takeovers
├── .env.example
├── .gitignore
└── package.json
```

## PM2

```bash
pm2 start index.js --name ground-zero
pm2 logs ground-zero
```