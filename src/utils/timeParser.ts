export interface ParsedTimeResult {
  success: boolean;
  date?: Date;
  error?: string;
  formattedLocal?: string;
}

const TIMEZONE_OFFSETS: Record<string, number> = {
  // US Timezones
  PST: -8,
  PDT: -7,
  MST: -7,
  MDT: -6,
  CST: -6,
  CDT: -5,
  EST: -5,
  EDT: -4,
  UTC: 0,
  GMT: 0,
};

/**
 * Returns current UTC offset in hours for America/Los_Angeles (handling standard/daylight savings)
 */
function getPacificOffsetHours(targetDate: Date): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(targetDate);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (tzName === 'PDT') return -7;
    return -8; // PST
  } catch {
    return -7; // default PDT
  }
}

/**
 * Parses user input strings into a future Date object.
 * Supports:
 * - Relative: "30m", "45min", "2h", "1d", "2h30m", "in 15 minutes"
 * - Absolute: "2026-09-05 18:00", "2026-09-05 18:00 EST", "2026-09-05T18:00:00Z"
 * - Tomorrow shortcuts: "tomorrow 17:00", "tomorrow 5pm"
 */
export function parseScheduleTime(
  input: string,
  defaultTimezone = 'America/Los_Angeles'
): ParsedTimeResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { success: false, error: 'Time input cannot be empty.' };
  }

  const now = new Date();

  // 1. Check relative duration pattern (e.g. "30m", "2h", "1d4h", "in 45 mins")
  const relativeCleaned = trimmed.replace(/^in\s+/i, '').trim();
  const durationRegex = /^(\d+\s*(?:d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\s*)+$/i;

  if (durationRegex.test(relativeCleaned)) {
    let totalMs = 0;
    const tokenRegex = /(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/gi;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(relativeCleaned)) !== null) {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();

      if (unit.startsWith('d')) {
        totalMs += value * 24 * 60 * 60 * 1000;
      } else if (unit.startsWith('h')) {
        totalMs += value * 60 * 60 * 1000;
      } else if (unit.startsWith('m')) {
        totalMs += value * 60 * 1000;
      } else if (unit.startsWith('s')) {
        totalMs += value * 1000;
      }
    }

    if (totalMs <= 0) {
      return { success: false, error: 'Relative duration must be greater than 0.' };
    }

    const targetDate = new Date(now.getTime() + totalMs);
    return {
      success: true,
      date: targetDate,
      formattedLocal: targetDate.toLocaleString('en-US', { timeZone: defaultTimezone }),
    };
  }

  // 2. Tomorrow syntax (e.g. "tomorrow 17:00", "tomorrow 5:30pm")
  const tomorrowMatch = trimmed.match(/^tomorrow(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+([a-z]{3}))?$/i);
  if (tomorrowMatch) {
    let hours = parseInt(tomorrowMatch[1], 10);
    const minutes = tomorrowMatch[2] ? parseInt(tomorrowMatch[2], 10) : 0;
    const ampm = tomorrowMatch[3]?.toLowerCase();
    const tzCode = tomorrowMatch[4]?.toUpperCase();

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    const target = new Date(now);
    target.setDate(target.getDate() + 1);
    target.setHours(hours, minutes, 0, 0);

    return {
      success: true,
      date: target,
      formattedLocal: target.toLocaleString('en-US', { timeZone: defaultTimezone }),
    };
  }

  // 3. Absolute Date string: "YYYY-MM-DD HH:mm [TZ]"
  const absMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s*([a-zA-Z]{3,4}|Z))?$/);
  if (absMatch) {
    const year = parseInt(absMatch[1], 10);
    const month = parseInt(absMatch[2], 10) - 1;
    const day = parseInt(absMatch[3], 10);
    const hour = absMatch[4] ? parseInt(absMatch[4], 10) : 12;
    const minute = absMatch[5] ? parseInt(absMatch[5], 10) : 0;
    const second = absMatch[6] ? parseInt(absMatch[6], 10) : 0;
    const tzToken = absMatch[7]?.toUpperCase();

    let offsetHours = getPacificOffsetHours(new Date(year, month, day)); // Default PST/PDT

    if (tzToken) {
      if (tzToken === 'Z' || tzToken === 'UTC' || tzToken === 'GMT') {
        offsetHours = 0;
      } else if (TIMEZONE_OFFSETS[tzToken] !== undefined) {
        offsetHours = TIMEZONE_OFFSETS[tzToken];
      }
    }

    // Construct UTC timestamp by offsetting
    const utcMillis = Date.UTC(year, month, day, hour - offsetHours, minute, second);
    const targetDate = new Date(utcMillis);

    if (isNaN(targetDate.getTime())) {
      return { success: false, error: 'Invalid date/time provided.' };
    }

    if (targetDate.getTime() <= now.getTime()) {
      return {
        success: false,
        error: `Scheduled time is in the past! (Calculated: ${targetDate.toLocaleString('en-US', { timeZone: defaultTimezone })} PT). Please specify a future time.`,
      };
    }

    return {
      success: true,
      date: targetDate,
      formattedLocal: targetDate.toLocaleString('en-US', { timeZone: defaultTimezone }),
    };
  }

  // 4. Fallback ISO / native parse attempt
  const directParsed = new Date(trimmed);
  if (!isNaN(directParsed.getTime())) {
    if (directParsed.getTime() <= now.getTime()) {
      return { success: false, error: 'Scheduled time must be in the future.' };
    }
    return {
      success: true,
      date: directParsed,
      formattedLocal: directParsed.toLocaleString('en-US', { timeZone: defaultTimezone }),
    };
  }

  return {
    success: false,
    error: 'Unrecognized time format. Examples:\n• Relative: `30m`, `2h`, `1d`, `4h30m`\n• Date: `2026-09-05 18:00` (defaults to Pacific Time)\n• Date + TZ: `2026-09-05 18:00 EST`\n• Shortcuts: `tomorrow 5pm`',
  };
}
