# Time Handling with Luxon and timeUtils.js

Welcome! This guide explains how date and time operations work in KiaraBot,
and how to use the helper functions in `timeUtils.js` across the codebase.

## Overview

Time handling in KiaraBot is powered by [Luxon](https://moment.github.io/luxon/)
and centralized in [`timeUtils.js`](file:///C:/Users/jtaya/.gemini/antigravity/worktrees/kiawaBot/replace_time_handling_luxon/timeUtils.js).
This setup gives us a few big benefits:

- **Immutable instances**: Luxon date objects do not mutate when modified.
  Calling `.plus()` or `.minus()` returns a new instance, avoiding surprise side effects.
- **Consistent UTC handling**: Backend timestamps and streak cutoffs stay in UTC,
  so code behaves identically regardless of the host machine or container timezone.
- **Focused helpers**: Common chores like formatting quotes, calculating stream
  attendance streaks, and rotating timed commands have dedicated, well-tested functions.

---

## Quick Import

Whenever you need to work with time, import the relevant helpers from `timeUtils.js`:

```javascript
import {
    parseIsoDateTime,
    getUtcNowIsoString,
    formatQuoteTimestamp,
    isWithinRestartWindow,
    safeDivideDuration,
    safeRotateIndex,
    delayMilliseconds,
    FIVE_HOURS_MS,
    StreamAttendanceSessionTracker,
    getStreamerTimezone,
    setStreamerTimezone,
    normalizeTimezone,
    isValidTimezone
} from "./timeUtils.js";
```

---

## How-To Guides for Common Tasks

### 1. Generating UTC Timestamps for Storage and APIs

When saving timestamps to JSON files (like `streaks.json` or `auth-data.json`)
or returning timestamps in API responses, use `getUtcNowIsoString()`:

```javascript
// Generates standard UTC ISO-8601 string, e.g. "2026-10-09T08:00:00.000Z"
const timestamp = getUtcNowIsoString();

// You can also pass an existing Luxon DateTime instance:
const specificIso = getUtcNowIsoString(myDateTime);
```

### 2. Formatting Quotes for Chat

Quotes stored in `quotes.json` and printed to Twitch chat use a standardized UTC
ISO 24-hour display with seconds (`yyyy-MM-dd HH:mm:ss`):

```javascript
// Formats current time in UTC, e.g. "2026-10-09 12:30:45"
const quoteTimestamp = formatQuoteTimestamp();

// Or format a specific date in UTC:
const historical = formatQuoteTimestamp(someDateTime);
```

This ensures quote timestamps are consistent, sortable, and explicitly in UTC
across all platforms.

### 3. Parsing and Validating Incoming Timestamps

When receiving timestamps from external sources (like Twitch EventSub webhooks),
parse them safely with `parseIsoDateTime()`:

```javascript
const streamStart = parseIsoDateTime(event.started_at);

if (!streamStart) {
    console.warn("Invalid or missing started_at timestamp received.");
    return;
}

console.log(`Stream started in year: ${streamStart.year}`);
```

If the string is invalid, null, or empty, `parseIsoDateTime()` returns `null`
instead of throwing or returning `NaN`.

### 4. Checking Stream Restarts and Duration Windows

To check whether a stream started shortly after a previous one (for example,
within a 5-hour restart window), use `isWithinRestartWindow()`:

```javascript
// Checks whether streamB started between 0 and 5 hours after streamA
const restartedQuickly = isWithinRestartWindow(streamA, streamB, FIVE_HOURS_MS);

if (restartedQuickly) {
    console.info("Stream resumed within the 5-hour restart window.");
}
```

This function verifies that the time difference is non-negative, preventing
clock skew or out-of-order events from being misclassified as a quick restart.

### 5. Managing Viewer Attendance Streaks

Viewer attendance tracking involves three coordinated utilities:

- **`isNewStreamAttendanceSession(currentStart, prevStart, prevEnd)`**:
  Evaluates whether the current stream is a separate broadcast requiring
  attendance progression (either passing the 5-hour gap or crossing the 13:00 UTC daily cutoff).
- **`calculateUserStreakProgression(...)`**:
  Calculates a user's updated streak count, maximum streak, and status:
  - New viewers start at streak 1.
  - Viewers who attended the prior stream increment their streak.
  - Viewers who missed the prior stream reset to streak 1.
  - Viewers already recorded in the active stream remain at their current streak.
- **`StreamAttendanceSessionTracker`**:
  An in-memory tracker that remembers which viewers have already streaked during
  the active stream. It synchronizes against the current stream start timestamp
  and resets automatically when a new stream begins.

```javascript
const tracker = new StreamAttendanceSessionTracker();

// Sync tracker with active stream start timestamp:
tracker.synchronizeSession(currentStreamStartIso);

if (!tracker.hasStreaked(userId)) {
    // Process user streak and mark them:
    tracker.markStreaked(userId);
}
```

### 6. Broadcaster Timezones and Daily Cutoffs

While internal storage and APIs consistently use UTC, attendance streak days
are anchored to the broadcaster local time. By default, the bot uses US/Pacific
(`America/Los_Angeles`).

The broadcast day cutoff is anchored at 06:00:00 local time:
- A stream that begins after 06:00 AM local time belongs to that calendar day.
- A late night stream running into the early morning (for example, Saturday at 02:00 AM)
  belongs to the previous day (Friday) broadcast day session.
- Transitions between PST and PDT are resolved automatically by Luxon.

#### Dynamic Broadcaster Timezone Changes

If the broadcaster travels or streams from another region, the timezone can be
updated at runtime (even after stream start) without restarting the bot.

In Twitch chat, the broadcaster can use these broadcaster-only commands:

- `!timezone`: Displays the active broadcaster timezone or offset.
- `!settimezone <zone or offset>`: Sets a new timezone or offset.

The command supports:
- IANA timezone identifiers: `America/Los_Angeles`, `America/Chicago`, `Asia/Tokyo`, `Europe/London`.
- UTC offsets: `UTC+2`, `UTC-5`, `+05:00`, `-08:00`.
- Bare offsets: `+5`, `-8`, `+5:30`.
- GMT aliases: `GMT+2`, `GMT-5`.

When updated, the change applies immediately to attendance calculations and
persists to `streaks.json` (`Timezone` field) so it survives restarts.

### 7. Rotating Timed Commands Safely

For cyclical rotations like chat timed commands, `safeRotateIndex()` provides
a safe alternative to raw modulo arithmetic:

```javascript
// Safely advances to the next index, wrapping around to 0 at the end.
// If the collection is empty, returns 0 rather than producing NaN.
commandIndex = safeRotateIndex(commandIndex, timedCommands.length);
```

### 8. Performing Safe Division

When calculating duration rates or progress percentages where the divisor comes
from user input or runtime calculation, use `safeDivideDuration()`:

```javascript
// Safely divides numerator by divisor, returning fallback (default 0) if divisor is <= 0
const rate = safeDivideDuration(elapsedMs, targetWindowMs, 0);
```

### 9. Pausing Execution Asynchronously

When waiting between retry attempts or polling checks, use `delayMilliseconds()`:

```javascript
await delayMilliseconds(2000); // Clean 2-second async pause
```

---

## Helpful Tips for Working with Time

- **Use descriptive variable names with units**: Naming variables like
  `elapsedMillisecondsSinceStart` or `dailyResetCutoffTime` makes the code
  easier to follow than single-letter names.
- **Rely on hoisted constants**: Durations like `FIVE_HOURS_MS` and format
  patterns are defined once at the top of `timeUtils.js` for efficiency.
- **Keep time logic pure**: Keeping date math inside `timeUtils.js` makes it
  straightforward to test in isolation without needing network or file mocks.
