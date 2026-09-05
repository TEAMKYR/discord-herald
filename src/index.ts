import { loadConfig } from './config.js';
import { StateStore } from './services/stateStore.js';
import { DiscordService } from './services/discord.js';
import { SchedulerService } from './services/scheduler.js';
import { AnnouncementSchedulerService } from './services/announcementScheduler.js';
import { TwitchWatcher } from './watchers/TwitchWatcher.js';
import { YouTubeWatcher } from './watchers/YouTubeWatcher.js';
import { handleHeraldCommand } from './commands/herald.js';
import { handleAnnounceCommand, handleAnnounceAutocomplete } from './commands/announce.js';

async function bootstrap() {
  console.log('🚀 Starting DiscordHerald Notification Bot...');

  // 1. Load configuration
  const config = loadConfig();

  // 2. Initialize Persistent State Store
  const stateStore = new StateStore();

  // 3. Initialize Discord Service
  const discordService = new DiscordService(config);
  const client = discordService.getClient();

  // 4. Initialize Announcement Scheduler
  const announcementScheduler = new AnnouncementSchedulerService(client, stateStore);

  // 5. Initialize Watchers
  const twitchWatcher = new TwitchWatcher(
    config.twitch || { enabled: false, clientId: '', clientSecret: '', streamers: [] },
    stateStore
  );
  const youtubeWatcher = new YouTubeWatcher(
    config.youtube || { enabled: false, channels: [] },
    stateStore
  );

  // 6. Initialize Polling Scheduler & Register Watchers
  const scheduler = new SchedulerService(discordService, config.pollingIntervalSeconds);
  scheduler.registerWatcher(twitchWatcher);
  scheduler.registerWatcher(youtubeWatcher);

  // 7. Hook Discord Interactions for Slash Commands & Autocomplete
  client.on('interactionCreate', async (interaction) => {
    // Handle autocomplete (e.g. for /announce cancel)
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === 'announce') {
        try {
          await handleAnnounceAutocomplete(interaction, announcementScheduler);
        } catch (err) {
          console.error('[App] Error in autocomplete handler:', err);
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === 'herald') {
        await handleHeraldCommand(interaction, scheduler, discordService);
      } else if (interaction.commandName === 'announce') {
        await handleAnnounceCommand(interaction, config, announcementScheduler);
      }
    } catch (err) {
      console.error('[App] Error handling command:', err);
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: 'An unexpected error occurred executing this command.' });
      } else {
        await interaction.reply({ content: 'An unexpected error occurred executing this command.', ephemeral: true });
      }
    }
  });

  // 8. Initialize watchers and connect to Discord
  try {
    if (twitchWatcher.isEnabled()) {
      await twitchWatcher.init();
    }
    if (youtubeWatcher.isEnabled()) {
      await youtubeWatcher.init();
    }

    if (!config.discord.token) {
      console.warn('⚠️ No DISCORD_BOT_TOKEN provided in .env or config.json. Bot will run in offline mode.');
      return;
    }

    await discordService.start();
    await scheduler.start();
    await announcementScheduler.start();

    console.log('✨ DiscordHerald is fully online and monitoring streams/channels!');
  } catch (err) {
    console.error('❌ Failed to start DiscordHerald:', err);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Shutting down DiscordHerald...');
    scheduler.stop();
    announcementScheduler.stop();
    await discordService.stop();
    stateStore.save();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
