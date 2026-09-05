import { StateStore } from '../services/stateStore.js';
import { TwitchWatcher } from '../watchers/TwitchWatcher.js';
import { YouTubeWatcher } from '../watchers/YouTubeWatcher.js';
import { parseScheduleTime } from '../utils/timeParser.js';
import { AnnouncementSchedulerService } from '../services/announcementScheduler.js';
import path from 'path';
import fs from 'fs';

async function runMockTests() {
  console.log('🧪 Starting DiscordHerald Test Suite...\n');

  // Test 1: State Store
  const testStatePath = path.resolve(process.cwd(), 'data', 'test_state.json');
  if (fs.existsSync(testStatePath)) {
    fs.unlinkSync(testStatePath);
  }

  console.log('1️⃣ Testing StateStore persistence...');
  const store = new StateStore(testStatePath);
  store.setSection('twitch', { testuser: { isLive: true, lastStreamId: '12345' } });
  store.save();

  const reloadedStore = new StateStore(testStatePath);
  const loadedSection = reloadedStore.getSection<{ testuser: { isLive: boolean; lastStreamId: string } }>('twitch');

  if (loadedSection.testuser?.isLive && loadedSection.testuser?.lastStreamId === '12345') {
    console.log('   ✅ StateStore read/write/reload passed.');
  } else {
    throw new Error('StateStore test failed to persist state accurately.');
  }

  // Test 2: Time Parser with PST/PDT Default Timezone
  console.log('\n2️⃣ Testing Time Parser (Relative & Absolute with PST/PDT default)...');
  const res30m = parseScheduleTime('30m');
  if (!res30m.success || !res30m.date || res30m.date.getTime() <= Date.now()) {
    throw new Error('Failed to parse 30m relative duration.');
  }
  console.log('   ✅ Parsed "30m":', res30m.date.toISOString());

  const res2h30m = parseScheduleTime('2h30m');
  if (!res2h30m.success || !res2h30m.date) {
    throw new Error('Failed to parse 2h30m relative duration.');
  }
  console.log('   ✅ Parsed "2h30m":', res2h30m.date.toISOString());

  const futureYear = new Date().getFullYear() + 1;
  const resAbs = parseScheduleTime(`${futureYear}-06-15 18:00`);
  if (!resAbs.success || !resAbs.date) {
    throw new Error(`Failed to parse absolute date ${futureYear}-06-15 18:00.`);
  }
  console.log(`   ✅ Parsed "${futureYear}-06-15 18:00" (PST/PDT default):`, resAbs.date.toISOString(), '| Local:', resAbs.formattedLocal);

  const resInvalid = parseScheduleTime('invalid-time-string');
  if (resInvalid.success) {
    throw new Error('Failed to reject invalid time string.');
  }
  console.log('   ✅ Rejected invalid time string gracefully.');

  // Test 3: Announcement Scheduler (Schedule, List, Cancel)
  console.log('\n3️⃣ Testing Announcement Scheduler Management...');
  // Mock client
  const mockClient: any = { channels: { fetch: async () => null } };
  const annScheduler = new AnnouncementSchedulerService(mockClient, store);

  const mockAnn = {
    id: 'ann-test-123',
    scheduledFor: new Date(Date.now() + 60000).toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: { id: 'user1', username: 'TestUser' },
    channelId: 'channel_123',
    message: 'Community Game Night announcement test!',
    asEmbed: true,
    pinMessage: false,
  };

  annScheduler.scheduleAnnouncement(mockAnn);
  const list = annScheduler.getScheduledList();
  if (list.length !== 1 || list[0].id !== 'ann-test-123') {
    throw new Error('Scheduled announcement was not found in schedule list.');
  }
  console.log('   ✅ Announcement scheduled and listed successfully.');

  const cancelSuccess = annScheduler.cancelAnnouncement('ann-test-123');
  if (!cancelSuccess || annScheduler.getScheduledList().length !== 0) {
    throw new Error('Failed to cancel scheduled announcement.');
  }
  console.log('   ✅ Announcement cancelled successfully.');

  // Clean up test state file
  if (fs.existsSync(testStatePath)) {
    fs.unlinkSync(testStatePath);
  }

  // Test 4: TwitchWatcher Payload Formatting & Role Mentions
  console.log('\n4️⃣ Testing TwitchWatcher Notification Formatting...');
  const twitchWatcher = new TwitchWatcher(
    {
      enabled: true,
      clientId: 'mock_client_id',
      clientSecret: 'mock_client_secret',
      streamers: [
        {
          username: 'shroud',
          discordChannelId: '999888777666555444',
          roleId: '111222333444555666',
          customMessage: '{role} 🚨 **{streamer}** is LIVE on Twitch playing **{game}**!',
        },
      ],
    },
    store
  );

  const twitchPayload = await twitchWatcher.generateTestPayload('shroud');
  if (!twitchPayload) {
    throw new Error('Twitch test payload generation failed.');
  }

  if (
    twitchPayload.content.includes('<@&111222333444555666>') &&
    twitchPayload.discordChannelId === '999888777666555444' &&
    twitchPayload.embed.data.color === 0x9146ff
  ) {
    console.log('   ✅ Twitch notification payload & role mention verified.');
  } else {
    throw new Error('Twitch payload structure validation failed.');
  }

  // Test 5: YouTubeWatcher Payload Formatting & Role Mentions
  console.log('\n5️⃣ Testing YouTubeWatcher Notification Formatting...');
  const youtubeWatcher = new YouTubeWatcher(
    {
      enabled: true,
      channels: [
        {
          channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
          channelName: 'Google Developers',
          discordChannelId: '999888777666555444',
          roleId: '777888999000111222',
        },
      ],
    },
    store
  );

  const ytPayload = await youtubeWatcher.generateTestPayload('UC_x5XG1OV2P6uZZ5FSM9Ttw');
  if (!ytPayload) {
    throw new Error('YouTube test payload generation failed.');
  }

  if (
    ytPayload.content.includes('<@&777888999000111222>') &&
    ytPayload.embed.data.color === 0xff0000
  ) {
    console.log('   ✅ YouTube notification payload & role mention verified.');
  } else {
    throw new Error('YouTube payload structure validation failed.');
  }

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runMockTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
