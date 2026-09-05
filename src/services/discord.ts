import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  NewsChannel,
  PermissionFlagsBits,
  Events,
} from 'discord.js';
import { BotConfig, NotificationPayload } from '../types/index.js';

export class DiscordService {
  private client: Client;
  private config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });
  }

  public getClient(): Client {
    return this.client;
  }

  public async start(): Promise<void> {
    if (!this.config.discord.token) {
      throw new Error('Discord bot token is not configured in .env or config.json');
    }

    return new Promise((resolve, reject) => {
      this.client.once(Events.ClientReady, async () => {
        console.log(`[DiscordService] Logged in as ${this.client.user?.tag} (ID: ${this.client.user?.id})`);
        try {
          await this.registerSlashCommands();
          resolve();
        } catch (err) {
          console.error('[DiscordService] Error registering slash commands:', err);
          resolve();
        }
      });

      this.client.login(this.config.discord.token).catch(reject);
    });
  }

  public async registerSlashCommands(): Promise<void> {
    if (!this.config.discord.clientId || !this.config.discord.token) {
      console.warn('[DiscordService] Cannot register slash commands without discord.clientId & discord.token');
      return;
    }

    const rest = new REST({ version: '10' }).setToken(this.config.discord.token);

    const commands = [
      new SlashCommandBuilder()
        .setName('herald')
        .setDescription('DiscordHerald bot controls and status')
        .addSubcommand((sub) =>
          sub
            .setName('status')
            .setDescription('View active stream and video monitoring status')
        )
        .addSubcommand((sub) =>
          sub
            .setName('check')
            .setDescription('Trigger an immediate polling check across all platforms')
        )
        .addSubcommand((sub) =>
          sub
            .setName('test')
            .setDescription('Send a test notification embed in the current channel')
            .addStringOption((opt) =>
              opt
                .setName('platform')
                .setDescription('Platform to test')
                .setRequired(true)
                .addChoices(
                  { name: 'Twitch Stream Alert', value: 'twitch' },
                  { name: 'YouTube Video Alert', value: 'youtube' }
                )
            )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

      new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Create and manage server announcements')
        .addSubcommand((sub) =>
          sub
            .setName('send')
            .setDescription('Broadcast an immediate announcement')
            .addStringOption((opt) =>
              opt
                .setName('message')
                .setDescription('The announcement message text')
                .setRequired(true)
            )
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to send the announcement in (defaults to default announcement channel)')
                .setRequired(false)
            )
            .addRoleOption((opt) =>
              opt
                .setName('role')
                .setDescription('Role to ping with the announcement (defaults to default announcement role)')
                .setRequired(false)
            )
            .addStringOption((opt) =>
              opt
                .setName('title')
                .setDescription('Optional custom title for the announcement embed')
                .setRequired(false)
            )
            .addBooleanOption((opt) =>
              opt
                .setName('embed')
                .setDescription('Whether to format as a rich embed (default: true)')
                .setRequired(false)
            )
            .addBooleanOption((opt) =>
              opt
                .setName('pin')
                .setDescription('Whether to pin the announcement message (default: false)')
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('schedule')
            .setDescription('Schedule an announcement for a future date/time')
            .addStringOption((opt) =>
              opt
                .setName('time')
                .setDescription('When to send: e.g. "30m", "2h", "1d", "2026-09-05 18:00" (defaults to PST/PDT)')
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('message')
                .setDescription('The announcement message text')
                .setRequired(true)
            )
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to send in (defaults to default announcement channel)')
                .setRequired(false)
            )
            .addRoleOption((opt) =>
              opt
                .setName('role')
                .setDescription('Role to ping with the announcement (defaults to default announcement role)')
                .setRequired(false)
            )
            .addStringOption((opt) =>
              opt
                .setName('title')
                .setDescription('Optional custom title for the announcement embed')
                .setRequired(false)
            )
            .addBooleanOption((opt) =>
              opt
                .setName('embed')
                .setDescription('Whether to format as a rich embed (default: true)')
                .setRequired(false)
            )
            .addBooleanOption((opt) =>
              opt
                .setName('pin')
                .setDescription('Whether to pin the message when sent (default: false)')
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('View all pending scheduled announcements')
        )
        .addSubcommand((sub) =>
          sub
            .setName('cancel')
            .setDescription('Cancel a pending scheduled announcement by ID')
            .addStringOption((opt) =>
              opt
                .setName('id')
                .setDescription('ID of the scheduled announcement to cancel')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    ].map((cmd) => cmd.toJSON());

    try {
      console.log('[DiscordService] Registering application (/) commands...');
      if (this.config.discord.guildId) {
        // Register instantly for specific guild
        await rest.put(
          Routes.applicationGuildCommands(this.config.discord.clientId, this.config.discord.guildId),
          { body: commands }
        );
        console.log(`[DiscordService] Successfully registered slash commands for guild ${this.config.discord.guildId}`);
      } else {
        // Register globally
        await rest.put(
          Routes.applicationCommands(this.config.discord.clientId),
          { body: commands }
        );
        console.log('[DiscordService] Successfully registered global slash commands.');
      }
    } catch (err) {
      console.error('[DiscordService] Failed to register slash commands:', err);
    }
  }

  public async sendNotification(payload: NotificationPayload): Promise<boolean> {
    try {
      const channel = await this.client.channels.fetch(payload.discordChannelId);
      if (!channel || (!channel.isTextBased() && !(channel instanceof NewsChannel))) {
        console.error(`[DiscordService] Channel ID ${payload.discordChannelId} is not a valid text channel.`);
        return false;
      }

      const textChannel = channel as TextChannel;

      await textChannel.send({
        content: payload.content,
        embeds: [payload.embed],
        components: payload.components || [],
      });

      console.log(`[DiscordService] Sent ${payload.platform} announcement for ${payload.displayName} to #${textChannel.name} (${textChannel.id})`);
      return true;
    } catch (err) {
      console.error(`[DiscordService] Failed to send notification to channel ${payload.discordChannelId}:`, err);
      return false;
    }
  }

  public async stop(): Promise<void> {
    this.client.destroy();
  }
}
