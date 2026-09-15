import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { XMLParser } from 'fast-xml-parser';
import { BaseWatcher } from './BaseWatcher.js';
import { YouTubeConfig, NotificationPayload, WatcherStatus, YouTubeChannelTarget } from '../types/index.js';
import { StateStore } from '../services/stateStore.js';

interface YouTubeFeedItem {
  id: string; // 'yt:video:VIDEO_ID'
  'yt:videoId'?: string;
  'yt:channelId'?: string;
  title: string;
  link?: { '@_href': string } | string;
  published: string;
  updated: string;
  author?: {
    name: string;
    uri: string;
  };
  'media:group'?: {
    'media:title': string;
    'media:description'?: string;
    'media:thumbnail'?: {
      '@_url': string;
    };
  };
}

export class YouTubeWatcher extends BaseWatcher {
  public readonly name = 'YouTube';
  private config: YouTubeConfig;
  private parser: XMLParser;
  private statuses: Map<string, WatcherStatus> = new Map();

  constructor(config: YouTubeConfig, stateStore: StateStore) {
    super(stateStore);
    this.config = config;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    // Apply any persisted role overrides
    this.applyRoleOverrides();

    for (const ch of this.config.channels) {
      this.statuses.set(ch.channelId, {
        platform: 'YouTube',
        targetId: ch.channelId,
        displayName: ch.channelName || ch.channelId,
        status: 'idle',
        lastChecked: null,
        lastEventTime: null,
      });
    }
  }

  public applyRoleOverrides(): void {
    const overrides = this.stateStore.getSection<{ youtube?: Record<string, string> }>('roleOverrides');
    if (overrides?.youtube) {
      for (const ch of this.config.channels) {
        const idKey = ch.channelId.toLowerCase();
        const nameKey = (ch.channelName || '').toLowerCase();
        if (idKey in overrides.youtube) {
          ch.roleId = overrides.youtube[idKey] || undefined;
        } else if (nameKey && nameKey in overrides.youtube) {
          ch.roleId = overrides.youtube[nameKey] || undefined;
        }
      }
    }
  }

  public getChannels(): YouTubeChannelTarget[] {
    return this.config.channels;
  }

  public setChannelRole(channelIdentifier?: string, roleId?: string): { count: number; targets: string[] } {
    const updatedTargets: string[] = [];
    const overrides = this.stateStore.getSection<{ youtube?: Record<string, string> }>('roleOverrides') || {};
    if (!overrides.youtube) overrides.youtube = {};

    for (const ch of this.config.channels) {
      const match =
        !channelIdentifier ||
        ch.channelId.toLowerCase() === channelIdentifier.toLowerCase() ||
        (ch.channelName && ch.channelName.toLowerCase() === channelIdentifier.toLowerCase());

      if (match) {
        ch.roleId = roleId || undefined;
        const key = ch.channelId.toLowerCase();
        if (roleId) {
          overrides.youtube[key] = roleId;
        } else {
          delete overrides.youtube[key];
        }
        updatedTargets.push(ch.channelName || ch.channelId);
      }
    }

    this.stateStore.setSection('roleOverrides', overrides);
    return { count: updatedTargets.length, targets: updatedTargets };
  }

  public isEnabled(): boolean {
    return Boolean(this.config.enabled && this.config.channels.length > 0);
  }

  public async init(): Promise<void> {
    if (!this.isEnabled()) {
      console.log('[YouTubeWatcher] YouTube watcher is disabled or has no channels configured.');
      return;
    }
    console.log(`[YouTubeWatcher] Initialized with ${this.config.channels.length} channel(s) monitored.`);
  }

  public async check(): Promise<NotificationPayload[]> {
    if (!this.isEnabled()) return [];

    const notifications: NotificationPayload[] = [];
    const state = this.stateStore.getSection<Record<string, { lastVideoId?: string; lastVideoPublishedAt?: string; lastVideoTitle?: string }>>('youtube');
    const now = new Date();

    for (const target of this.config.channels) {
      const statusEntry = this.statuses.get(target.channelId) || {
        platform: 'YouTube',
        targetId: target.channelId,
        displayName: target.channelName || target.channelId,
        status: 'idle',
        lastChecked: now,
        lastEventTime: null,
      };

      statusEntry.lastChecked = now;

      try {
        const latestVideo = await this.fetchLatestVideo(target.channelId);
        if (!latestVideo) {
          statusEntry.status = 'idle';
          this.statuses.set(target.channelId, statusEntry);
          continue;
        }

        const channelState = state[target.channelId] || {};
        const isFirstRun = !channelState.lastVideoId;
        const isNewVideo = channelState.lastVideoId !== latestVideo.videoId;

        if (isNewVideo) {
          // If this is the very first check after fresh setup, we store current state to avoid backlogging old videos
          if (isFirstRun) {
            console.log(`[YouTubeWatcher] Baseline set for channel ${target.channelName || target.channelId} (Latest video: ${latestVideo.videoId})`);
          } else {
            console.log(`[YouTubeWatcher] New YouTube video detected from ${latestVideo.authorName}: "${latestVideo.title}"!`);
            const payload = this.buildNotificationPayload(target, latestVideo);
            notifications.push(payload);
          }

          state[target.channelId] = {
            lastVideoId: latestVideo.videoId,
            lastVideoPublishedAt: latestVideo.publishedAt,
            lastVideoTitle: latestVideo.title,
          };

          statusEntry.lastEventTime = new Date(latestVideo.publishedAt);
          statusEntry.details = `Latest: "${latestVideo.title}"`;
          statusEntry.displayName = latestVideo.authorName || target.channelName || target.channelId;
        }

        statusEntry.status = 'idle';
      } catch (err) {
        console.error(`[YouTubeWatcher] Error checking channel ${target.channelId}:`, err);
        statusEntry.status = 'error';
        statusEntry.details = String(err);
      }

      this.statuses.set(target.channelId, statusEntry);
    }

    this.stateStore.setSection('youtube', state);
    return notifications;
  }

  private async fetchLatestVideo(channelId: string): Promise<{
    videoId: string;
    title: string;
    description: string;
    authorName: string;
    publishedAt: string;
    videoUrl: string;
    thumbnailUrl: string;
  } | null> {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

    const res = await fetch(feedUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch YouTube XML feed: ${res.status} ${res.statusText}`);
    }

    const xmlText = await res.text();
    const parsed = this.parser.parse(xmlText);

    const feed = parsed.feed;
    if (!feed || !feed.entry) {
      return null;
    }

    // `entry` can be an array of entries or a single object
    const entry: YouTubeFeedItem = Array.isArray(feed.entry) ? feed.entry[0] : feed.entry;
    if (!entry) return null;

    const videoId = entry['yt:videoId'] || entry.id?.replace('yt:video:', '');
    const title = entry.title;
    const authorName = entry.author?.name || feed.title || 'YouTube Channel';
    const publishedAt = entry.published;
    const description = entry['media:group']?.['media:description'] || '';
    const thumbnailUrl =
      entry['media:group']?.['media:thumbnail']?.['@_url'] ||
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    return {
      videoId,
      title,
      description,
      authorName,
      publishedAt,
      videoUrl,
      thumbnailUrl,
    };
  }

  public buildNotificationPayload(
    target: YouTubeChannelTarget,
    video: {
      videoId: string;
      title: string;
      description: string;
      authorName: string;
      publishedAt: string;
      videoUrl: string;
      thumbnailUrl: string;
    }
  ): NotificationPayload {
    const roleMention = target.roleId ? `<@&${target.roleId}>` : '';
    const channelName = video.authorName || target.channelName || 'YouTube Creator';

    let content = target.customMessage || '{role} 🎬 New video from **{channel}**!';
    content = content
      .replace('{role}', roleMention)
      .replace('{channel}', channelName)
      .replace('{title}', video.title)
      .replace('{url}', video.videoUrl)
      .trim();

    const shortDesc = video.description.length > 250
      ? `${video.description.substring(0, 247)}...`
      : video.description;

    const embed = new EmbedBuilder()
      .setColor(0xff0000) // Official YouTube Red
      .setTitle(`🎬 ${video.title}`)
      .setURL(video.videoUrl)
      .setAuthor({
        name: `${channelName} published a new video!`,
        iconURL: 'https://www.youtube.com/s/desktop/f172cfd8/img/favicon_144x144.png',
        url: video.videoUrl,
      })
      .setDescription(shortDesc || 'Click the button below to watch the new video on YouTube!')
      .setImage(video.thumbnailUrl)
      .addFields(
        { name: '📺 Channel', value: channelName, inline: true },
        { name: '🔗 Video Link', value: `[Watch on YouTube](${video.videoUrl})`, inline: true }
      )
      .setTimestamp(new Date(video.publishedAt))
      .setFooter({
        text: 'YouTube Video Alert • DiscordHerald',
        iconURL: 'https://www.youtube.com/s/desktop/f172cfd8/img/favicon_144x144.png',
      });

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Watch on YouTube')
        .setStyle(ButtonStyle.Link)
        .setURL(video.videoUrl)
        .setEmoji('▶️')
    );

    return {
      platform: 'youtube',
      targetId: target.channelId,
      displayName: channelName,
      discordChannelId: target.discordChannelId,
      roleId: target.roleId,
      content,
      embed,
      components: [actionRow],
    };
  }

  public async generateTestPayload(targetId?: string): Promise<NotificationPayload | null> {
    const target = targetId
      ? this.config.channels.find((c) => c.channelId === targetId)
      : this.config.channels[0];

    if (!target) {
      return null;
    }

    const mockVideo = {
      videoId: 'dQw4w9WgXcQ',
      title: '🎬 [TEST VIDEO] My Biggest Project Yet! (Announcement & Roadmap)',
      description: 'Check out the latest upload! Make sure to like, comment, and subscribe for more content.',
      authorName: target.channelName || 'YouTube Creator',
      publishedAt: new Date().toISOString(),
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    };

    return this.buildNotificationPayload(target, mockVideo);
  }

  public getStatuses(): WatcherStatus[] {
    return Array.from(this.statuses.values());
  }
}
