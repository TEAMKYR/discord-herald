import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  TextChannel,
  NewsChannel,
  ChannelType,
} from 'discord.js';
import { BotConfig, ScheduledAnnouncement } from '../types/index.js';
import { AnnouncementSchedulerService } from '../services/announcementScheduler.js';
import { parseScheduleTime } from '../utils/timeParser.js';
import { formatRoleMention, normalizeRoleId } from '../utils/roleFormatter.js';

export async function handleAnnounceCommand(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  announcementScheduler: AnnouncementSchedulerService
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'send') {
    await handleSendSubcommand(interaction, config);
    return;
  }

  if (subcommand === 'schedule') {
    await handleScheduleSubcommand(interaction, config, announcementScheduler);
    return;
  }

  if (subcommand === 'list') {
    await handleListSubcommand(interaction, announcementScheduler);
    return;
  }

  if (subcommand === 'cancel') {
    await handleCancelSubcommand(interaction, announcementScheduler);
    return;
  }
}

export async function handleAnnounceAutocomplete(
  interaction: AutocompleteInteraction,
  announcementScheduler: AnnouncementSchedulerService
): Promise<void> {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const list = announcementScheduler.getScheduledList();

  const filtered = list
    .filter((ann) => {
      const label = `${ann.title || ann.message} (${ann.id})`.toLowerCase();
      return label.includes(focusedValue) || ann.id.toLowerCase().includes(focusedValue);
    })
    .slice(0, 25);

  await interaction.respond(
    filtered.map((ann) => {
      const timeStr = new Date(ann.scheduledFor).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const preview = (ann.title || ann.message).substring(0, 50);
      return {
        name: `[${timeStr}] ${preview} (${ann.id})`.substring(0, 100),
        value: ann.id,
      };
    })
  );
}

/**
 * Resolves the target destination channel using priority:
 * 1. User specified in command option
 * 2. Hardcoded default announcementChannelId in config/env
 * 3. First configured Twitch streamer channel
 * 4. Current interaction channel
 */
async function resolveTargetChannel(
  interaction: ChatInputCommandInteraction,
  config: BotConfig
): Promise<TextChannel | NewsChannel | null> {
  const targetChannelOption = interaction.options.getChannel('channel');

  if (
    targetChannelOption &&
    (targetChannelOption.type === ChannelType.GuildText || targetChannelOption.type === ChannelType.GuildAnnouncement)
  ) {
    return targetChannelOption as TextChannel | NewsChannel;
  }

  if (config.discord.announcementChannelId) {
    try {
      const fetched = await interaction.client.channels.fetch(config.discord.announcementChannelId);
      if (fetched && (fetched.type === ChannelType.GuildText || fetched.type === ChannelType.GuildAnnouncement)) {
        return fetched as TextChannel | NewsChannel;
      }
    } catch (err) {
      console.warn(`[Announce] Could not fetch hardcoded announcementChannelId:`, err);
    }
  }

  if (config.twitch?.streamers?.[0]?.discordChannelId) {
    try {
      const fetched = await interaction.client.channels.fetch(config.twitch.streamers[0].discordChannelId);
      if (fetched && (fetched.type === ChannelType.GuildText || fetched.type === ChannelType.GuildAnnouncement)) {
        return fetched as TextChannel | NewsChannel;
      }
    } catch (err) {
      console.warn(`[Announce] Could not fetch streamer discordChannelId:`, err);
    }
  }

  if (
    interaction.channel &&
    (interaction.channel.type === ChannelType.GuildText || interaction.channel.type === ChannelType.GuildAnnouncement)
  ) {
    return interaction.channel as TextChannel | NewsChannel;
  }

  return null;
}

/**
 * Resolves role mention string:
 * 1. User selected in command option
 * 2. Hardcoded default announcementRoleId in config/env
 */
function resolveRoleMention(interaction: ChatInputCommandInteraction, config: BotConfig): string {
  const targetRole = interaction.options.getRole('role');
  if (targetRole) {
    const normalized = normalizeRoleId(targetRole, interaction.guildId);
    return formatRoleMention(normalized, interaction.guildId);
  }
  if (config.discord.announcementRoleId) {
    return formatRoleMention(config.discord.announcementRoleId, interaction.guildId);
  }
  return '';
}

/**
 * Handles `/announce send` (Immediate announcement)
 */
async function handleSendSubcommand(
  interaction: ChatInputCommandInteraction,
  config: BotConfig
): Promise<void> {
  const messageText = interaction.options.getString('message', true);
  const title = interaction.options.getString('title');
  const asEmbed = interaction.options.getBoolean('embed') ?? true;
  const pinMessage = interaction.options.getBoolean('pin') ?? false;

  const targetChannel = await resolveTargetChannel(interaction, config);
  if (!targetChannel) {
    await interaction.reply({
      content: '❌ Could not find a valid text channel to send the announcement to.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const roleMention = resolveRoleMention(interaction, config);
    let sentMessage;

    if (asEmbed) {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(title ? `📢 ${title}` : '📢 Server Announcement')
        .setDescription(messageText)
        .setTimestamp()
        .setFooter({
          text: `Announced by ${interaction.user.username}`,
          iconURL: interaction.user.displayAvatarURL(),
        });

      sentMessage = await targetChannel.send({
        content: roleMention || undefined,
        embeds: [embed],
        allowedMentions: { parse: ['roles', 'users', 'everyone'] },
      });
    } else {
      const fullText = roleMention ? `${roleMention}\n${messageText}` : messageText;
      sentMessage = await targetChannel.send({
        content: fullText,
        allowedMentions: { parse: ['roles', 'users', 'everyone'] },
      });
    }

    if (pinMessage && sentMessage.pinnable) {
      await sentMessage.pin().catch((err) => {
        console.warn(`[Announce] Could not pin message: ${err}`);
      });
    }

    await interaction.editReply({
      content: `✅ Announcement successfully posted in <#${targetChannel.id}>!${pinMessage ? ' (Pinned 📌)' : ''}`,
    });
  } catch (err) {
    console.error('[Announce] Failed to post announcement:', err);
    await interaction.editReply({
      content: `❌ Failed to send announcement in <#${targetChannel.id}>. Make sure the bot has permissions.`,
    });
  }
}

/**
 * Handles `/announce schedule`
 */
async function handleScheduleSubcommand(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  announcementScheduler: AnnouncementSchedulerService
): Promise<void> {
  const timeInput = interaction.options.getString('time', true);
  const messageText = interaction.options.getString('message', true);
  const title = interaction.options.getString('title') || undefined;
  const asEmbed = interaction.options.getBoolean('embed') ?? true;
  const pinMessage = interaction.options.getBoolean('pin') ?? false;
  const targetRole = interaction.options.getRole('role');

  const targetChannel = await resolveTargetChannel(interaction, config);
  if (!targetChannel) {
    await interaction.reply({
      content: '❌ Could not find a valid text channel for the scheduled announcement.',
      ephemeral: true,
    });
    return;
  }

  // Parse schedule time with default timezone
  const parsed = parseScheduleTime(timeInput, config.timezone || 'America/Los_Angeles');
  if (!parsed.success || !parsed.date) {
    await interaction.reply({
      content: `❌ **Invalid Schedule Time**:\n${parsed.error}`,
      ephemeral: true,
    });
    return;
  }

  const roleId = targetRole
    ? normalizeRoleId(targetRole, interaction.guildId)
    : config.discord.announcementRoleId
    ? normalizeRoleId(config.discord.announcementRoleId, interaction.guildId)
    : undefined;
  const timestampUnix = Math.floor(parsed.date.getTime() / 1000);
  const announcementId = `ann-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  const scheduledItem: ScheduledAnnouncement = {
    id: announcementId,
    scheduledFor: parsed.date.toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: {
      id: interaction.user.id,
      username: interaction.user.username,
    },
    channelId: targetChannel.id,
    roleId,
    message: messageText,
    title,
    asEmbed,
    pinMessage,
  };

  announcementScheduler.scheduleAnnouncement(scheduledItem);

  const confirmEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('⏰ Announcement Scheduled')
    .setDescription(
      `Your announcement has been scheduled to send in <#${targetChannel.id}> <t:${timestampUnix}:R> (<t:${timestampUnix}:F>).`
    )
    .addFields(
      { name: '🆔 Announcement ID', value: `\`${announcementId}\``, inline: true },
      { name: '📢 Channel', value: `<#${targetChannel.id}>`, inline: true },
      { name: '👥 Target Role', value: roleId ? formatRoleMention(roleId, interaction.guildId) : '*None*', inline: true },
      { name: '📝 Message Preview', value: messageText.length > 200 ? `${messageText.substring(0, 197)}...` : messageText }
    )
    .setFooter({ text: `Use /announce cancel id:${announcementId} to cancel` });

  await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });
}

/**
 * Handles `/announce list`
 */
async function handleListSubcommand(
  interaction: ChatInputCommandInteraction,
  announcementScheduler: AnnouncementSchedulerService
): Promise<void> {
  const list = announcementScheduler.getScheduledList();

  if (list.length === 0) {
    await interaction.reply({
      content: '📅 There are currently no pending scheduled announcements.',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📅 Scheduled Announcements (${list.length})`)
    .setDescription('Upcoming announcements waiting to be broadcast:')
    .setTimestamp();

  for (const ann of list.slice(0, 10)) {
    const unix = Math.floor(new Date(ann.scheduledFor).getTime() / 1000);
    const title = ann.title ? `**${ann.title}**\n` : '';
    const preview = ann.message.length > 100 ? `${ann.message.substring(0, 97)}...` : ann.message;
    const role = ann.roleId ? ` | Role: ${formatRoleMention(ann.roleId, interaction.guildId)}` : '';

    embed.addFields({
      name: `⏰ <t:${unix}:R> (<t:${unix}:f>)`,
      value: `🆔 \`${ann.id}\` | In <#${ann.channelId}>${role}\n${title}> ${preview}`,
      inline: false,
    });
  }

  if (list.length > 10) {
    embed.setFooter({ text: `Showing 10 of ${list.length} scheduled announcements.` });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handles `/announce cancel`
 */
async function handleCancelSubcommand(
  interaction: ChatInputCommandInteraction,
  announcementScheduler: AnnouncementSchedulerService
): Promise<void> {
  const id = interaction.options.getString('id', true);
  const success = announcementScheduler.cancelAnnouncement(id);

  if (success) {
    await interaction.reply({
      content: `✅ Successfully cancelled scheduled announcement \`${id}\`.`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: `❌ Could not find a pending announcement with ID \`${id}\`. Check \`/announce list\` for valid IDs.`,
      ephemeral: true,
    });
  }
}
