import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

export interface BotConfig {
  discord: {
    token: string;
    clientId: string;
    guildId?: string; // Optional: for instant guild slash command registration
    announcementChannelId?: string; // Hardcoded default channel ID for /announce
    announcementRoleId?: string; // Hardcoded default role ID to @ mention for /announce
  };
  timezone?: string; // Default timezone for scheduling, e.g. "America/Los_Angeles"
  pollingIntervalSeconds: number; // e.g. 60 seconds
  twitch?: TwitchConfig;
  youtube?: YouTubeConfig;
}

export interface ScheduledAnnouncement {
  id: string; // e.g., "ann-1725450000-a1b2"
  scheduledFor: string; // ISO timestamp
  createdAt: string;
  createdBy: { id: string; username: string };
  channelId: string;
  roleId?: string;
  message: string;
  title?: string;
  asEmbed: boolean;
  pinMessage: boolean;
}

export interface StreamerTarget {
  username: string; // Twitch login name, e.g. "shroud"
  discordChannelId: string;
  roleId?: string; // Target Discord Role ID to ping (e.g. "123456789012345678")
  customMessage?: string; // Optional template override, e.g. "{role} {streamer} is now LIVE playing {game}!"
}

export interface TwitchConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  streamers: StreamerTarget[];
}

export interface YouTubeChannelTarget {
  channelId: string; // YouTube Channel ID (e.g. "UC...")
  channelName?: string;
  discordChannelId: string;
  roleId?: string;
  customMessage?: string; // Optional template override, e.g. "{role} New video from {channel}: **{title}**!"
}

export interface YouTubeConfig {
  enabled: boolean;
  apiKey?: string; // Optional: uses YouTube Data API if provided, falls back to RSS feed
  channels: YouTubeChannelTarget[];
}

export interface NotificationPayload {
  platform: 'twitch' | 'youtube' | string;
  targetId: string; // username or channelId
  displayName: string;
  discordChannelId: string;
  roleId?: string;
  content: string; // Text message containing role ping
  embed: EmbedBuilder;
  components?: ActionRowBuilder<ButtonBuilder>[];
}

export interface WatcherStatus {
  platform: string;
  targetId: string;
  displayName: string;
  status: 'online' | 'offline' | 'idle' | 'error';
  lastChecked: Date | null;
  lastEventTime: Date | null;
  details?: string;
}

export interface AppState {
  twitch: Record<string, {
    isLive: boolean;
    lastStreamId?: string;
    lastLiveAt?: string;
    lastTitle?: string;
  }>;
  youtube: Record<string, {
    lastVideoId?: string;
    lastVideoPublishedAt?: string;
    lastVideoTitle?: string;
  }>;
  scheduledAnnouncements?: ScheduledAnnouncement[];
  [key: string]: any; // Allows custom expansion watchers to store arbitrary state
}
