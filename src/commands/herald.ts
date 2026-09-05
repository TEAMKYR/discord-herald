import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { SchedulerService } from '../services/scheduler.js';
import { DiscordService } from '../services/discord.js';

export async function handleHeraldCommand(
  interaction: ChatInputCommandInteraction,
  scheduler: SchedulerService,
  discordService: DiscordService
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

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

    // Override target channel to current channel where command was executed
    testPayload.discordChannelId = interaction.channelId;

    const sent = await discordService.sendNotification(testPayload);
    if (sent) {
      await interaction.editReply({
        content: `✅ Test notification sent for **${watcher.name}** in <#${interaction.channelId}>!`,
      });
    } else {
      await interaction.editReply({
        content: `❌ Failed to send test notification. Check bot permissions (Send Messages, Embed Links).`,
      });
    }
    return;
  }
}
