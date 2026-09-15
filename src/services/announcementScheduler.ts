import {
  Client,
  EmbedBuilder,
  TextChannel,
  NewsChannel,
  ChannelType,
} from 'discord.js';
import { ScheduledAnnouncement } from '../types/index.js';
import { StateStore } from './stateStore.js';
import { formatRoleMention } from '../utils/roleFormatter.js';

export class AnnouncementSchedulerService {
  private client: Client;
  private stateStore: StateStore;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(client: Client, stateStore: StateStore) {
    this.client = client;
    this.stateStore = stateStore;
  }

  public async start(): Promise<void> {
    console.log('[AnnouncementScheduler] Starting announcement scheduler service...');
    // Process any announcements immediately (including overdue ones from downtime)
    await this.processDueAnnouncements();

    // Check for due announcements every 10 seconds
    this.timer = setInterval(() => {
      this.processDueAnnouncements().catch((err) => {
        console.error('[AnnouncementScheduler] Error processing due announcements:', err);
      });
    }, 10000);
  }

  public getScheduledList(): ScheduledAnnouncement[] {
    const list = this.stateStore.getSection<ScheduledAnnouncement[]>('scheduledAnnouncements') || [];
    return Array.isArray(list) ? list : [];
  }

  public scheduleAnnouncement(announcement: ScheduledAnnouncement): void {
    const current = this.getScheduledList();
    current.push(announcement);
    // Sort by scheduled time ascending
    current.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
    this.stateStore.setSection('scheduledAnnouncements', current);
    console.log(`[AnnouncementScheduler] Scheduled announcement ${announcement.id} for ${announcement.scheduledFor}`);
  }

  public cancelAnnouncement(id: string): boolean {
    const current = this.getScheduledList();
    const index = current.findIndex((a) => a.id === id);
    if (index === -1) return false;

    current.splice(index, 1);
    this.stateStore.setSection('scheduledAnnouncements', current);
    console.log(`[AnnouncementScheduler] Cancelled scheduled announcement ${id}`);
    return true;
  }

  public async processDueAnnouncements(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const all = this.getScheduledList();
      if (all.length === 0) return;

      const now = Date.now();
      const due: ScheduledAnnouncement[] = [];
      const remaining: ScheduledAnnouncement[] = [];

      for (const ann of all) {
        const scheduledTime = new Date(ann.scheduledFor).getTime();
        if (scheduledTime <= now) {
          due.push(ann);
        } else {
          remaining.push(ann);
        }
      }

      if (due.length === 0) return;

      // Update state store with remaining before dispatching to prevent duplicate triggers
      this.stateStore.setSection('scheduledAnnouncements', remaining);

      for (const ann of due) {
        await this.dispatchAnnouncement(ann);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatchAnnouncement(ann: ScheduledAnnouncement): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(ann.channelId);
      if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
        console.error(`[AnnouncementScheduler] Channel ID ${ann.channelId} is invalid or not a text channel.`);
        return;
      }

      const textChannel = channel as TextChannel | NewsChannel;
      const roleMention = formatRoleMention(ann.roleId);

      let sentMessage;

      if (ann.asEmbed) {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(ann.title ? `📢 ${ann.title}` : '📢 Server Announcement')
          .setDescription(ann.message)
          .setTimestamp(new Date(ann.scheduledFor))
          .setFooter({
            text: `Scheduled by ${ann.createdBy.username} • DiscordHerald`,
          });

        sentMessage = await textChannel.send({
          content: roleMention || undefined,
          embeds: [embed],
          allowedMentions: { parse: ['roles', 'users', 'everyone'] },
        });
      } else {
        const fullText = roleMention ? `${roleMention}\n${ann.message}` : ann.message;
        sentMessage = await textChannel.send({
          content: fullText,
          allowedMentions: { parse: ['roles', 'users', 'everyone'] },
        });
      }

      if (ann.pinMessage && sentMessage.pinnable) {
        await sentMessage.pin().catch((err) => {
          console.warn(`[AnnouncementScheduler] Could not pin message: ${err}`);
        });
      }

      console.log(`[AnnouncementScheduler] Successfully dispatched scheduled announcement ${ann.id} to #${textChannel.name}`);
    } catch (err) {
      console.error(`[AnnouncementScheduler] Failed to dispatch announcement ${ann.id}:`, err);
    }
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
