import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { BaseWatcher } from './BaseWatcher.js';
import { TwitchConfig, NotificationPayload, WatcherStatus, StreamerTarget } from '../types/index.js';
import { StateStore } from '../services/stateStore.js';

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface TwitchStreamData {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string; // 'live'
  title: string;
  viewer_count: number;
  started_at: string;
  thumbnail_url: string;
}

interface TwitchUserData {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
  description: string;
}

export class TwitchWatcher extends BaseWatcher {
  public readonly name = 'Twitch';
  private config: TwitchConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private userCache: Map<string, TwitchUserData> = new Map();
  private statuses: Map<string, WatcherStatus> = new Map();

  constructor(config: TwitchConfig, stateStore: StateStore) {
    super(stateStore);
    this.config = config;

    // Initialize in-memory status tracking for each configured streamer
    for (const streamer of this.config.streamers) {
      const key = streamer.username.toLowerCase();
      this.statuses.set(key, {
        platform: 'Twitch',
        targetId: key,
        displayName: streamer.username,
        status: 'offline',
        lastChecked: null,
        lastEventTime: null,
      });
    }
  }

  public isEnabled(): boolean {
    return Boolean(
      this.config.enabled &&
      this.config.clientId &&
      this.config.clientSecret &&
      this.config.streamers.length > 0
    );
  }

  public async init(): Promise<void> {
    if (!this.isEnabled()) {
      console.log('[TwitchWatcher] Twitch watcher is disabled or missing credentials/streamers.');
      return;
    }
    await this.refreshAccessToken();
    await this.populateUserCache();
  }

  private async refreshAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return;
    }

    try {
      const params = new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'client_credentials',
      });

      const res = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
        method: 'POST',
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch Twitch token: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as TwitchTokenResponse;
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
      console.log('[TwitchWatcher] Successfully obtained Twitch App Access Token.');
    } catch (err) {
      console.error('[TwitchWatcher] Error obtaining Twitch App Access Token:', err);
      throw err;
    }
  }

  private async makeHelixRequest<T>(endpoint: string, queryParams: Record<string, string | string[]>): Promise<T | null> {
    await this.refreshAccessToken();

    const url = new URL(`https://api.twitch.tv/helix/${endpoint}`);
    for (const [key, value] of Object.entries(queryParams)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          url.searchParams.append(key, v);
        }
      } else {
        url.searchParams.set(key, value);
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        'Client-ID': this.config.clientId,
        'Authorization': `Bearer ${this.accessToken}`,
      },
    });

    if (res.status === 401) {
      // Force refresh token once on 401
      this.accessToken = null;
      await this.refreshAccessToken();
      const retryRes = await fetch(url.toString(), {
        headers: {
          'Client-ID': this.config.clientId,
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });
      if (!retryRes.ok) return null;
      return (await retryRes.json()) as T;
    }

    if (!res.ok) {
      console.error(`[TwitchWatcher] Helix API error on ${endpoint}: ${res.status} ${res.statusText}`);
      return null;
    }

    return (await res.json()) as T;
  }

  private async populateUserCache(): Promise<void> {
    const logins = this.config.streamers.map((s) => s.username.toLowerCase());
    if (logins.length === 0) return;

    const data = await this.makeHelixRequest<{ data: TwitchUserData[] }>('users', {
      login: logins,
    });

    if (data?.data) {
      for (const user of data.data) {
        this.userCache.set(user.login.toLowerCase(), user);
      }
    }
  }

  public async check(): Promise<NotificationPayload[]> {
    if (!this.isEnabled()) return [];

    const notifications: NotificationPayload[] = [];
    const state = this.stateStore.getSection<Record<string, { isLive: boolean; lastStreamId?: string; lastLiveAt?: string; lastTitle?: string }>>('twitch');

    const usernames = this.config.streamers.map((s) => s.username.toLowerCase());
    const streamResponse = await this.makeHelixRequest<{ data: TwitchStreamData[] }>('streams', {
      user_login: usernames,
    });

    const now = new Date();
    const liveStreamsMap = new Map<string, TwitchStreamData>();

    if (streamResponse?.data) {
      for (const stream of streamResponse.data) {
        liveStreamsMap.set(stream.user_login.toLowerCase(), stream);
      }
    }

    for (const streamer of this.config.streamers) {
      const key = streamer.username.toLowerCase();
      const liveStream = liveStreamsMap.get(key);
      const isCurrentlyLive = Boolean(liveStream && liveStream.type === 'live');
      const savedState = state[key] || { isLive: false };

      const statusEntry = this.statuses.get(key) || {
        platform: 'Twitch',
        targetId: key,
        displayName: streamer.username,
        status: 'offline',
        lastChecked: now,
        lastEventTime: null,
      };

      statusEntry.lastChecked = now;

      if (isCurrentlyLive && liveStream) {
        statusEntry.status = 'online';
        statusEntry.displayName = liveStream.user_name || streamer.username;
        statusEntry.details = `Playing ${liveStream.game_name || 'Just Chatting'} - ${liveStream.viewer_count} viewers`;

        // Check if stream transitioned to live or if it is a completely new stream ID
        const isNewStream = !savedState.isLive || (savedState.lastStreamId && savedState.lastStreamId !== liveStream.id);

        if (isNewStream) {
          console.log(`[TwitchWatcher] Streamer ${liveStream.user_name} went LIVE! Generating announcement.`);
          statusEntry.lastEventTime = new Date(liveStream.started_at);

          const payload = this.buildNotificationPayload(streamer, liveStream);
          notifications.push(payload);

          // Update saved state
          state[key] = {
            isLive: true,
            lastStreamId: liveStream.id,
            lastLiveAt: liveStream.started_at,
            lastTitle: liveStream.title,
          };
        }
      } else {
        statusEntry.status = 'offline';
        statusEntry.details = 'Stream is currently offline';

        // Update state to offline
        if (savedState.isLive) {
          state[key] = {
            ...savedState,
            isLive: false,
          };
        }
      }

      this.statuses.set(key, statusEntry);
    }

    this.stateStore.setSection('twitch', state);
    return notifications;
  }

  public buildNotificationPayload(streamer: StreamerTarget, stream: TwitchStreamData): NotificationPayload {
    const key = streamer.username.toLowerCase();
    const user = this.userCache.get(key);
    const streamUrl = `https://twitch.tv/${stream.user_login}`;
    const displayName = stream.user_name || user?.display_name || streamer.username;
    const gameName = stream.game_name || 'Just Chatting';
    const title = stream.title || 'Live Stream';

    // Role ping text formatting: e.g. <@&ROLE_ID>
    const roleMention = streamer.roleId ? `<@&${streamer.roleId}>` : '';

    let content = streamer.customMessage || '{role} 🔴 **{streamer}** is now **LIVE** on Twitch! \n**{title}**';
    content = content
      .replace('{role}', roleMention)
      .replace('{streamer}', displayName)
      .replace('{game}', gameName)
      .replace('{title}', title)
      .replace('{url}', streamUrl)
      .trim();

    // Twitch stream thumbnail URL with timestamp cache buster
    const thumbnailUrl = stream.thumbnail_url
      ? stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}`
      : `https://static-cdn.jtvnw.net/previews-ttv/live_user_${stream.user_login}-1280x720.jpg?t=${Date.now()}`;

    const embed = new EmbedBuilder()
      .setColor(0x9146ff) // Official Twitch purple
      .setTitle(`${title}`)
      .setURL(streamUrl)
      .setAuthor({
        name: `${displayName} is now streaming!`,
        iconURL: user?.profile_image_url || 'https://static-cdn.jtvnw.net/jtv_user_pictures/twitch-logo.png',
        url: streamUrl,
      })
      .addFields(
        { name: '🎮 Game / Category', value: gameName, inline: true },
        { name: '👥 Viewers', value: `${stream.viewer_count.toLocaleString()}`, inline: true },
        //{ name: '🔗 Stream Link', value: `[Watch Stream](${streamUrl})`, inline: true }
      )
      .setImage(thumbnailUrl)
      .setTimestamp(new Date(stream.started_at || Date.now()))
      .setFooter({
        text: 'Twitch Live Notification • DiscordHerald',
        //iconURL: 'https://static-cdn.jtvnw.net/jtv_user_pictures/twitch-logo.png',
      });

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Watch on Twitch')
        .setStyle(ButtonStyle.Link)
        .setURL(streamUrl)
        .setEmoji('📺')
    );

    return {
      platform: 'twitch',
      targetId: streamer.username,
      displayName,
      discordChannelId: streamer.discordChannelId,
      roleId: streamer.roleId,
      content,
      embed,
      components: [actionRow],
    };
  }

  public async generateTestPayload(targetId?: string): Promise<NotificationPayload | null> {
    const streamer = targetId
      ? this.config.streamers.find((s) => s.username.toLowerCase() === targetId.toLowerCase())
      : this.config.streamers[0];

    if (!streamer) {
      return null;
    }

    const mockStream: TwitchStreamData = {
      id: `test_stream_${Date.now()}`,
      user_id: '123456',
      user_login: streamer.username.toLowerCase(),
      user_name: streamer.username,
      game_id: '509658',
      game_name: 'Just Chatting',
      type: 'live',
      title: '🔴 [TEST STREAM] Chilling & Hanging Out with the Community! 🎉',
      viewer_count: 1337,
      started_at: new Date().toISOString(),
      thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_{user}-1280x720.jpg',
    };

    return this.buildNotificationPayload(streamer, mockStream);
  }

  public getStatuses(): WatcherStatus[] {
    return Array.from(this.statuses.values());
  }
}
