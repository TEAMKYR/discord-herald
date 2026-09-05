import fs from 'fs';
import path from 'path';
import { AppState } from '../types/index.js';

export class StateStore {
  private filePath: string;
  private state: AppState;

  constructor(filePath?: string) {
    this.filePath = filePath || path.resolve(process.cwd(), 'data', 'state.json');
    this.state = {
      twitch: {},
      youtube: {},
    };
    this.init();
  }

  private init(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.state = { ...this.state, ...JSON.parse(raw) };
      } catch (err) {
        console.warn(`[StateStore] Warning: Could not parse state file (${err}). Initializing fresh state.`);
      }
    } else {
      this.save();
    }
  }

  public get(): AppState {
    return this.state;
  }

  public getSection<T = any>(sectionName: string): T {
    if (!this.state[sectionName]) {
      this.state[sectionName] = {};
    }
    return this.state[sectionName] as T;
  }

  public setSection(sectionName: string, data: any): void {
    this.state[sectionName] = data;
    this.save();
  }

  public updateSection<T = any>(sectionName: string, updater: (current: T) => T): void {
    const current = this.getSection<T>(sectionName);
    this.state[sectionName] = updater(current);
    this.save();
  }

  public save(): void {
    try {
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error(`[StateStore] Error saving state:`, err);
    }
  }
}
