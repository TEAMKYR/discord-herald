import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { BotConfig } from './types/index.js';

dotenv.config();

export function loadConfig(): BotConfig {
  const configPath = path.resolve(process.cwd(), 'config.json');
  let fileConfig: Partial<BotConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw);
    } catch (err) {
      console.error('[Config] Failed to parse config.json:', err);
    }
  }

  const config: BotConfig = {
    discord: {
      token: process.env.DISCORD_BOT_TOKEN || fileConfig.discord?.token || '',
      clientId: process.env.DISCORD_CLIENT_ID || fileConfig.discord?.clientId || '',
      guildId: process.env.DISCORD_GUILD_ID || fileConfig.discord?.guildId,
      announcementChannelId: process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID || fileConfig.discord?.announcementChannelId,
      announcementRoleId: process.env.DISCORD_ANNOUNCEMENT_ROLE_ID || fileConfig.discord?.announcementRoleId,
    },
    timezone: process.env.TZ || fileConfig.timezone || 'America/Los_Angeles',
    pollingIntervalSeconds: Number(process.env.POLLING_INTERVAL_SECONDS) || fileConfig.pollingIntervalSeconds || 60,
    twitch: {
      enabled: process.env.TWITCH_ENABLED !== 'false' && (fileConfig.twitch?.enabled ?? true),
      clientId: process.env.TWITCH_CLIENT_ID || fileConfig.twitch?.clientId || '',
      clientSecret: process.env.TWITCH_CLIENT_SECRET || fileConfig.twitch?.clientSecret || '',
      streamers: fileConfig.twitch?.streamers || [],
    },
    youtube: {
      enabled: process.env.YOUTUBE_ENABLED !== 'false' && (fileConfig.youtube?.enabled ?? true),
      apiKey: process.env.YOUTUBE_API_KEY || fileConfig.youtube?.apiKey || '',
      channels: fileConfig.youtube?.channels || [],
    },
  };

  return config;
}
