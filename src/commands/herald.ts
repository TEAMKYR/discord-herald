import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { SchedulerService } from '../services/scheduler.js';
import { DiscordService } from '../services/discord.js';
import { TwitchWatcher } from '../watchers/TwitchWatcher.js';
import { YouTubeWatcher } from '../watchers/YouTubeWatcher.js';
import { StateStore } from '../services/stateStore.js';
import { BotConfig } from '../types/index.js';
import { formatRoleMention, normalizeRoleId } from '../utils/roleFormatter.js';

export async function handleHeraldCommand(
  interaction: ChatInputCommandInteraction,
  scheduler: SchedulerService,
  discordService: DiscordService,
  stateStore?: StateStore,
  config?: BotConfig
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  // Find watchers from scheduler
  const twitchWatcher = scheduler
    .getWatchers()
    .find((w) => w instanceof TwitchWatcher) as TwitchWatcher | undefined;
  const youtubeWatcher = scheduler
    .getWatchers()
    .find((w) => w instanceof YouTubeWatcher) as YouTubeWatcher | undefined;

  if (subcommand === 'status') {
    const watchers = scheduler.getWatchers();
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📊 DiscordHerald Monitoring Status')
      .setDescription('Current health and status of all configured stream & content watchers:')
      .setTimestamp();

    for (const watcher of watchers) {
      if (!watcher.isEnabled()) {
        embed.addFields({
          name: `⚪ ${watcher.name}`,
          value: '*Disabled or missing API credentials*',
          inline: false,
        });
        continue;
      }

      const statuses = watcher.getStatuses();
      if (statuses.length === 0) {
        embed.addFields({
          name: `🟢 ${watcher.name}`,
          value: '*No targets configured.*',
          inline: false,
        });
        continue;
      }

      const lines = statuses.map((s) => {
        const icon = s.status === 'online' ? '🟢' : s.status === 'error' ? '🔴' : '⚪';
        const lastChecked = s.lastChecked ? `<t:${Math.floor(s.lastChecked.getTime() / 1000)}:R>` : 'Never';
        const details = s.details ? ` (${s.details})` : '';
        return `${icon} **${s.displayName}**: ${s.status.toUpperCase()}${details} — *Checked: ${lastChecked}*`;
      });

      embed.addFields({
        name: `📡 ${watcher.name} (${statuses.length} monitored)`,
        value: lines.join('\n'),
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === 'check') {
    await interaction.deferReply({ ephemeral: true });
    const count = await scheduler.runCycle();
    await interaction.editReply({
      content: `✅ Check cycle complete! Dispatched **${count}** new notification(s).`,
    });
    return;
  }

  if (subcommand === 'test') {
    const platform = interaction.options.getString('platform', true);
    await interaction.deferReply({ ephemeral: true });

    const watcher = scheduler
      .getWatchers()
      .find((w) => w.name.toLowerCase() === platform.toLowerCase());

    if (!watcher) {
      await interaction.editReply({
        content: `❌ Could not find a watcher registered for platform: \`${platform}\``,
      });
      return;
    }

    const testPayload = await watcher.generateTestPayload();
    if (!testPayload) {
      await interaction.editReply({
        content: `❌ Could not generate test payload for \`${platform}\`. Ensure at least one streamer or channel is configured in config.json.`,
      });
      return;
    }

    await interaction.editReply({
      content: testPayload.content,
      embeds: [testPayload.embed],
      components: testPayload.components || [],
    });
    return;
  }

  if (subcommand === 'setrole') {
    const platform = interaction.options.getString('platform', true);
    const role = interaction.options.getRole('role', true);
    const target = interaction.options.getString('target') || undefined;

    const normalizedRoleId = normalizeRoleId(role, interaction.guildId);
    const mentionDisplay = formatRoleMention(normalizedRoleId, interaction.guildId);
    const roleLabel = role.name === '@everyone' ? '@everyone' : role.name;

    if (platform === 'twitch') {
      if (!twitchWatcher) {
        await interaction.reply({
          content: '❌ Twitch watcher is not available.',
          ephemeral: true,
        });
        return;
      }

      const result = twitchWatcher.setStreamerRole(target, normalizedRoleId);
      if (result.count === 0) {
        await interaction.reply({
          content: target
            ? `❌ Could not find configured Twitch streamer matching \`${target}\`.`
            : '❌ No Twitch streamers configured in config.json.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle('🟣 Twitch Notification Role Updated')
        .setDescription(`Successfully set notification role to ${mentionDisplay}!`)
        .addFields(
          { name: '👥 Target Role', value: `${mentionDisplay} (\`${roleLabel}\`)`, inline: true },
          { name: '🎯 Streamer(s) Affected', value: result.targets.map((t) => `• **${t}**`).join('\n') || 'All', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (platform === 'youtube') {
      if (!youtubeWatcher) {
        await interaction.reply({
          content: '❌ YouTube watcher is not available.',
          ephemeral: true,
        });
        return;
      }

      const result = youtubeWatcher.setChannelRole(target, normalizedRoleId);
      if (result.count === 0) {
        await interaction.reply({
          content: target
            ? `❌ Could not find configured YouTube channel matching \`${target}\`.`
            : '❌ No YouTube channels configured in config.json.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔴 YouTube Notification Role Updated')
        .setDescription(`Successfully set notification role to ${mentionDisplay}!`)
        .addFields(
          { name: '👥 Target Role', value: `${mentionDisplay} (\`${roleLabel}\`)`, inline: true },
          { name: '🎯 Channel(s) Affected', value: result.targets.map((t) => `• **${t}**`).join('\n') || 'All', inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (platform === 'announcements') {
      if (config) {
        config.discord.announcementRoleId = normalizedRoleId;
      }
      if (stateStore) {
        const overrides = stateStore.getSection<{ announcements?: string }>('roleOverrides') || {};
        overrides.announcements = normalizedRoleId;
        stateStore.setSection('roleOverrides', overrides);
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📢 Announcements Role Updated')
        .setDescription(`Successfully updated default announcement role to ${mentionDisplay}!`)
        .addFields(
          { name: '👥 Target Role', value: `${mentionDisplay} (\`${roleLabel}\`)`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  }

  if (subcommand === 'clearrole') {
    const platform = interaction.options.getString('platform', true);
    const target = interaction.options.getString('target') || undefined;

    if (platform === 'twitch') {
      if (!twitchWatcher) {
        await interaction.reply({ content: '❌ Twitch watcher is not available.', ephemeral: true });
        return;
      }

      const result = twitchWatcher.setStreamerRole(target, undefined);
      if (result.count === 0) {
        await interaction.reply({
          content: target
            ? `❌ Could not find configured Twitch streamer matching \`${target}\`.`
            : '❌ No Twitch streamers configured in config.json.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle('🟣 Twitch Notification Role Cleared')
        .setDescription(`Notification role ping removed (notifications will be posted without role ping).`)
        .addFields(
          { name: '🎯 Streamer(s) Affected', value: result.targets.map((t) => `• **${t}**`).join('\n'), inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (platform === 'youtube') {
      if (!youtubeWatcher) {
        await interaction.reply({ content: '❌ YouTube watcher is not available.', ephemeral: true });
        return;
      }

      const result = youtubeWatcher.setChannelRole(target, undefined);
      if (result.count === 0) {
        await interaction.reply({
          content: target
            ? `❌ Could not find configured YouTube channel matching \`${target}\`.`
            : '❌ No YouTube channels configured in config.json.',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🔴 YouTube Notification Role Cleared')
        .setDescription(`Notification role ping removed (notifications will be posted without role ping).`)
        .addFields(
          { name: '🎯 Channel(s) Affected', value: result.targets.map((t) => `• **${t}**`).join('\n'), inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (platform === 'announcements') {
      if (config) {
        config.discord.announcementRoleId = undefined;
      }
      if (stateStore) {
        const overrides = stateStore.getSection<{ announcements?: string }>('roleOverrides') || {};
        delete overrides.announcements;
        stateStore.setSection('roleOverrides', overrides);
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📢 Announcements Role Cleared')
        .setDescription('Default announcement role ping removed.')
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  }

  if (subcommand === 'roles') {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('👥 DiscordHerald Notification Roles Overview')
      .setDescription('Current role mention configuration across all platforms and targets:')
      .setTimestamp();

    // 1. Twitch Streamers
    if (twitchWatcher) {
      const streamers = twitchWatcher.getStreamers();
      if (streamers.length > 0) {
        const twitchLines = streamers.map((s) => {
          const roleStr = s.roleId ? formatRoleMention(s.roleId, interaction.guildId) : '*None (No Ping)*';
          const chanStr = s.discordChannelId ? `<#${s.discordChannelId}>` : '*Not Set*';
          return `• **${s.username}**: ${roleStr} ➜ Channel: ${chanStr}`;
        });
        embed.addFields({
          name: '🟣 Twitch Stream Alerts',
          value: twitchLines.join('\n'),
          inline: false,
        });
      } else {
        embed.addFields({
          name: '🟣 Twitch Stream Alerts',
          value: '*No streamers configured.*',
          inline: false,
        });
      }
    }

    // 2. YouTube Channels
    if (youtubeWatcher) {
      const channels = youtubeWatcher.getChannels();
      if (channels.length > 0) {
        const ytLines = channels.map((c) => {
          const roleStr = c.roleId ? formatRoleMention(c.roleId, interaction.guildId) : '*None (No Ping)*';
          const chanStr = c.discordChannelId ? `<#${c.discordChannelId}>` : '*Not Set*';
          const name = c.channelName || c.channelId;
          return `• **${name}**: ${roleStr} ➜ Channel: ${chanStr}`;
        });
        embed.addFields({
          name: '🔴 YouTube Video Alerts',
          value: ytLines.join('\n'),
          inline: false,
        });
      } else {
        embed.addFields({
          name: '🔴 YouTube Video Alerts',
          value: '*No channels configured.*',
          inline: false,
        });
      }
    }

    // 3. Announcements / Other
    const annRole = config?.discord.announcementRoleId;
    const annChan = config?.discord.announcementChannelId;
    const annRoleStr = annRole ? formatRoleMention(annRole, interaction.guildId) : '*None (No Ping)*';
    const annChanStr = annChan ? `<#${annChan}>` : '*None (Uses command channel)*';

    embed.addFields({
      name: '📢 Server Announcements (/announce)',
      value: `• **Default Role**: ${annRoleStr}\n• **Default Channel**: ${annChanStr}`,
      inline: false,
    });

    embed.setFooter({
      text: 'Use /herald setrole or /herald clearrole to modify notification roles.',
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
}
