# Discord Community Bot

A powerful, production-ready Discord bot built for managing and growing communities. Originally developed for the [DS6Music](https://ds6music.com) community server, this bot handles everything from member onboarding to subscription verification, support tickets, giveaways and multilingual communication.

---

## Features

### Member Management
- **Welcome system** — Automatic welcome messages in the member's language (ES/EN/PT)
- **Role assignment** — Automatic roles based on level, subscription plan, and language
- **Invite tracking** — Tracks who invited each member and accumulates giveaway tickets

### XP & Leveling System
- Members earn XP by chatting (1 XP per message, 60-second cooldown)
- Level-up notifications with automatic role upgrades
- Level milestones: Active (5), Regular (10), Veteran (20), Legend (50)

### DS6 Coins Economy
- Members earn coins by leveling up and completing daily rewards
- Coin balance tracked per user with persistent JSON storage

### Subscription Verification
- `!verificar [IMVU username]` — Checks if a user has an active subscription via external API
- Automatically assigns the corresponding subscriber role upon verification

### Support Tickets
- `!ticket [query]` — Creates a private thread for the user and staff
- `!cerrar` — Closes the ticket thread when resolved

### Giveaways
- Invite-based giveaway system — more invites = more tickets = higher win probability
- `!invitaciones` — View your invite count and giveaway tickets
- `!invitaciones top` — Server-wide leaderboard

### Multilingual Support (ES / EN / PT)
- All bot responses adapt to the user's selected language
- Language selection via reaction in a dedicated channel

### Live Rooms Panel
- Displays active subscriber rooms with direct stream links
- Auto-updates every 10 minutes

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **Node.js** | Runtime environment |
| **discord.js v14** | Discord API wrapper |
| **JSON** | Persistent data storage (XP, coins, invites) |
| **REST API** | External subscription verification |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

### Installation

```bash
git clone https://github.com/dimitrilinds/discord-music-bot.git
cd discord-music-bot
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:

```env
DISCORD_TOKEN=your_bot_token
GUILD_ID=your_server_id

# Channel IDs
CHANNEL_BIENVENIDOS=...
CHANNEL_LOGS=...
CHANNEL_SOPORTE=...
# (see .env.example for full list)

# Role IDs
ROLE_ACTIVO=...
ROLE_REGULAR=...
ROLE_VETERANO=...
ROLE_LEYENDA=...
```

Also create a `config.json` file:

```json
{
  "guild_id": "your_guild_id",
  "lang_channel_id": "channel_id_for_language_selection",
  "verify_channel_id": "channel_id_for_verification"
}
```

### Run

```bash
node index.js
```

Or with PM2 for production:

```bash
pm2 start index.js --name discord-bot
```

---

## Commands

| Command | Description |
|---|---|
| `!verificar [user]` | Verify IMVU subscription |
| `!ticket [query]` | Open a support ticket |
| `!cerrar` | Close current ticket |
| `!invitaciones` | View your invite stats and giveaway tickets |
| `!invitaciones top` | View the invite leaderboard |
| `!precios` | Show subscription plans |
| `!ayuda` | Show command list |

---

## Project Structure

```
discord-community-bot/
├── index.js          # Main bot file
├── package.json      # Dependencies
├── .env.example      # Environment variables template
├── .gitignore
├── xp_data.json      # XP data (auto-generated)
├── coins_data.json   # Coins data (auto-generated)
├── daily_data.json   # Daily rewards data (auto-generated)
├── invites.json      # Invite tracking (auto-generated)
└── role_ids.json     # Role configuration
```

---

## License

MIT — feel free to use, modify and distribute.

---

Built with ❤️ by [dimitrilinds](https://github.com/dimitrilinds) · [ds6music.com](https://ds6music.com)
