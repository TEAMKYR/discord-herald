# 📢 DiscordHerald — Stream & Content Notification Bot

A modular, production-ready Discord bot built with **TypeScript** and **discord.js v14** that automatically notifies your Discord server when a Twitch streamer goes live or a YouTube creator publishes a new video, with customizable role pings, rich embeds, interactive buttons, and state deduplication.

---

## ✨ Features

- 🟣 **Twitch Live Notifications**:
  - Automatically queries the official **Twitch Helix API** using OAuth Client Credentials grant with self-refreshing tokens.
  - Generates rich Discord Embeds containing the stream game/category, viewer count, custom live thumbnail, and direct link button.
  - Mentions target roles (e.g. `<@&ROLE_ID>`) with customizable message templates.
  - Persistent state caching (`data/state.json`) prevents duplicate alerts if streams drop or the bot restarts.
- 🔴 **YouTube Video & Premiere Notifications (Extensible)**:
  - Supports **zero-API-key Atom XML feeds** (instant updates with zero quota usage) and optional YouTube Data API v3.
  - Rich embed with channel avatar, title, description preview, max-resolution thumbnail, and "Watch on YouTube" button.
- 🧩 **Pluggable Architecture**:
  - Modular `BaseWatcher` base class allows adding any custom platform (Kick, Twitter/X, TikTok, Podcast RSS) in minutes.
- ⚡ **Interactive Slash Commands**:
  - `/herald status`: Check the live/offline health status and last checked time of all configured streamers.
  - `/herald test <platform>`: Preview test notification embeds directly in your channel.
  - `/herald check`: Trigger an immediate manual polling check across all platforms.
  - `/announce send`: Broadcast an immediate announcement.
  - `/announce schedule`: Schedule an announcement for any future time with automatic role pings (e.g. `time: 30m`, `time: 2h`, `time: 2026-09-05 18:00` in PST/PDT).
  - `/announce list`: View all pending scheduled announcements with live countdowns.
  - `/announce cancel`: Cancel a scheduled announcement by ID (with autocomplete selection).

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js 18+** (Node.js 20 or 24 recommended)
- A Discord Bot Token (from [Discord Developer Portal](https://discord.com/developers/applications))
- Twitch Developer Application (from [Twitch Developer Console](https://dev.twitch.tv/console))

### 2. Installation

Clone and install dependencies:
```bash
npm install
```

### 3. Configuration

Copy `config.example.json` to `config.json` (or copy `.env.example` to `.env`):

```bash
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "discord": {
    "token": "YOUR_DISCORD_BOT_TOKEN",
    "clientId": "YOUR_DISCORD_APPLICATION_CLIENT_ID",
    "guildId": "YOUR_SERVER_ID_FOR_INSTANT_SLASH_COMMANDS"
  },
  "pollingIntervalSeconds": 60,
  "twitch": {
    "enabled": true,
    "clientId": "YOUR_TWITCH_CLIENT_ID",
    "clientSecret": "YOUR_TWITCH_CLIENT_SECRET",
    "streamers": [
      {
        "username": "shroud",
        "discordChannelId": "123456789012345678",
        "roleId": "987654321098765432",
        "customMessage": "{role} 🔴 **{streamer}** is now LIVE playing **{game}**!\n{url}"
      }
    ]
  },
  "youtube": {
    "enabled": true,
    "channels": [
      {
        "channelId": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
        "channelName": "Google Developers",
        "discordChannelId": "123456789012345678",
        "roleId": "987654321098765432",
        "customMessage": "{role} 🎬 New video from **{channel}**: **{title}**!\n{url}"
      }
    ]
  }
}
```

---

## 🔑 How to Obtain Necessary IDs & Keys

<details>
<summary><b>1. Discord Bot Token, Client ID, Channel ID, and Role ID</b></summary>

1. Visit [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Go to **Bot** -> Click **Reset Token** to copy your `token`.
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (optional)
   - **Server Members Intent** (optional)
4. Go to **OAuth2** -> **URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Embed Links`, `Mention Everyone/Roles`, `Use External Emojis`.
   - Copy and open the generated invite URL to add the bot to your Discord server.
5. In Discord, enable **Developer Mode** under *User Settings* -> *Advanced* -> *Developer Mode*:
   - Right-click your announcement text channel -> **Copy Channel ID**.
   - Right-click the subscriber role in *Server Settings* -> *Roles* -> **Copy Role ID**.
</details>

<details>
<summary><b>2. Twitch Client ID and Client Secret</b></summary>

1. Go to the [Twitch Developer Console](https://dev.twitch.tv/console).
2. Log in with your Twitch account and click **Register Your Application**.
3. Fill in:
   - **Name**: `DiscordHerald Stream Bot` (or any unique name).
   - **OAuth Redirect URLs**: `http://localhost:3000` (not used directly, but required by Twitch).
   - **Category**: `Application Integration` or `Chat Bot`.
4. Click **Create**.
5. On your application page, copy the **Client ID** and click **New Secret** to generate and copy the **Client Secret**.
</details>

<details>
<summary><b>3. YouTube Channel ID</b></summary>

1. Open any YouTube channel in your browser.
2. If the URL has `youtube.com/channel/UC...`, the `UC...` part is the `channelId`.
3. Alternatively, right-click on the channel page -> *View Page Source* -> search for `channel_id` (e.g. `UC_x5XG1OV2P6uZZ5FSM9Ttw`).
</details>

---

## 🛠️ Running the Bot

### Development Mode (with hot reload / TS execution)
```bash
npm run dev
```

### Production Build & Run
```bash
npm run build
npm start
```

### Run Mock & Offline Test Suite
To verify embed rendering, role mentions, and feed parsing without needing Discord credentials:
```bash
npm run test:mock
```

---

## 💬 Message Template Variables

You can customize `customMessage` for any streamer or YouTube channel using these placeholders:

| Variable | Description | Platform |
| :--- | :--- | :--- |
| `{role}` | Mentions the specified Discord role (`<@&ROLE_ID>`) | All |
| `{streamer}` | Display name of the streamer | Twitch |
| `{channel}` | Name of the YouTube channel | YouTube |
| `{game}` | Game/Category name (e.g. *Valorant*, *Just Chatting*) | Twitch |
| `{title}` | Title of the live stream or video | All |
| `{url}` | Direct link to the stream or video | All |

---

## 🔌 How to Add New Watchers (e.g. Kick, Twitter/X, TikTok)

Thanks to the modular `BaseWatcher` design, extending the bot for other platforms is straightforward:

1. Create `src/watchers/YourPlatformWatcher.ts`:
   ```typescript
   import { BaseWatcher } from './BaseWatcher.js';
   import { NotificationPayload, WatcherStatus } from '../types/index.js';

   export class KickWatcher extends BaseWatcher {
     public readonly name = 'Kick';
     
     public async init(): Promise<void> { /* API auth */ }
     public async check(): Promise<NotificationPayload[]> { /* Polling logic */ }
     public async generateTestPayload(): Promise<NotificationPayload | null> { /* Test mock */ }
     public getStatuses(): WatcherStatus[] { /* Health metrics */ }
     public isEnabled(): boolean { return true; }
   }
   ```
2. Register it in `src/index.ts`:
   ```typescript
   const kickWatcher = new KickWatcher(config.kick, stateStore);
   scheduler.registerWatcher(kickWatcher);
   ```
