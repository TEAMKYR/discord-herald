import { BaseWatcher } from '../watchers/BaseWatcher.js';
import { DiscordService } from './discord.js';

export class SchedulerService {
  private watchers: BaseWatcher[] = [];
  private discordService: DiscordService;
  private intervalSeconds: number;
  private timer: NodeJS.Timeout | null = null;
  private isChecking = false;

  constructor(discordService: DiscordService, intervalSeconds = 60) {
    this.discordService = discordService;
    this.intervalSeconds = Math.max(15, intervalSeconds);
  }

  public registerWatcher(watcher: BaseWatcher): void {
    this.watchers.push(watcher);
  }

  public getWatchers(): BaseWatcher[] {
    return this.watchers;
  }

  public async start(): Promise<void> {
    console.log(`[Scheduler] Starting scheduler. Polling every ${this.intervalSeconds} seconds.`);
    // Run initial check immediately
    await this.runCycle();

    this.timer = setInterval(() => {
      this.runCycle().catch((err) => {
        console.error('[Scheduler] Unhandled error during cycle execution:', err);
      });
    }, this.intervalSeconds * 1000);
  }

  public async runCycle(): Promise<number> {
    if (this.isChecking) {
      console.log('[Scheduler] Previous cycle is still running. Skipping iteration.');
      return 0;
    }

    this.isChecking = true;
    let totalNotificationsSent = 0;

    try {
      for (const watcher of this.watchers) {
        if (!watcher.isEnabled()) continue;

        try {
          const notifications = await watcher.check();
          for (const notification of notifications) {
            const sent = await this.discordService.sendNotification(notification);
            if (sent) totalNotificationsSent++;
          }
        } catch (err) {
          console.error(`[Scheduler] Error while running watcher "${watcher.name}":`, err);
        }
      }
    } finally {
      this.isChecking = false;
    }

    return totalNotificationsSent;
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
