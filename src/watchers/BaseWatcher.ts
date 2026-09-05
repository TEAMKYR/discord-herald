import { NotificationPayload, WatcherStatus } from '../types/index.js';
import { StateStore } from '../services/stateStore.js';

export abstract class BaseWatcher {
  public abstract readonly name: string;
  protected stateStore: StateStore;

  constructor(stateStore: StateStore) {
    this.stateStore = stateStore;
  }

  /**
   * Initialize any API clients, authorization tokens, or persistent connections.
   */
  public abstract init(): Promise<void>;

  /**
   * Check for updates (e.g. going live, new video). Returns array of notifications to broadcast.
   */
  public abstract check(): Promise<NotificationPayload[]>;

  /**
   * Generates a test notification payload for testing Discord formatting without waiting for a live event.
   */
  public abstract generateTestPayload(targetId?: string): Promise<NotificationPayload | null>;

  /**
   * Returns current health & monitoring status of all monitored entities in this watcher.
   */
  public abstract getStatuses(): WatcherStatus[];

  /**
   * Whether this watcher is configured and active.
   */
  public abstract isEnabled(): boolean;
}
