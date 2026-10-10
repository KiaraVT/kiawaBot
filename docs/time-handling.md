# Working with Time in Kiara Bot

A practical guide for developers, contributors, and maintainers explaining how to handle time properly in Kiara Bot and how to use the built-in time utilities when adding features or debugging.

All core time utilities are centralized in [`timeUtils.js`](../timeUtils.js) using [Luxon](https://moment.github.io/luxon/).

---

## 1. How to Handle Time Properly: Choosing the Right Time Representation

When building a new feature or debugging an existing one, choosing the right way to represent time prevents common bugs like timer drift, timezone confusion, clock skew, or accidental location leaks. Use this guide to pick the right approach for your task:

| What your feature is doing | Time Representation | Recommended Utilities | Why this handles time properly |
|---|---|---|---|
| **Elapsed durations, cooldowns, timers, recurring intervals** | Monotonic Time | `getMonotonicMs()`, `scheduleCompensatedInterval()` | Immune to system clock adjustments, NTP time steps, and daylight saving shifts. Guarantees steady forward progress. |
| **Data persistence, JSON files, API payloads, WebSockets** | UTC ISO-8601 | `getUtcNowIsoString()`, `parseIsoDateTime()` | Universal, machine-readable source of truth across systems without timezone or daylight saving ambiguity. |
| **Stream sessions, attendance streaks, daily check-in resets** | Streamer Local Time | `getDailyResetCutoffTime()`, `getStreamerTimezone()` | Matches real broadcast schedules, allowing overnight streams past midnight to count toward the same broadcast day until 06:00 AM local time. |
| **Chat outputs, quote timestamps, web overlay text** | Privacy-Safe Display | `formatQuoteTimestamp()`, `getStreamerUtcOffset()`, `getStreamerIsoString()` | Human-readable formatting that protects broadcaster privacy by displaying UTC offsets rather than physical city names. |

---

## 2. Practical Feature Recipes

### Recipe 1: Changing the Frequency of Automated Chat Messages

Automated chat messages (such as periodic links, rules reminders, or social shoutouts) run on a timer loop in [`Kiara_bot.js`](../Kiara_bot.js).

Standard JavaScript `setInterval` can drift over weeks of continuous bot uptime due to event-loop delays. Kiara Bot uses `scheduleCompensatedInterval()`, which measures execution lag on each tick and self-corrects the next delay.

#### How it is currently configured:
In [`Kiara_bot.js`](../Kiara_bot.js):
```javascript
import { scheduleCompensatedInterval, safeRotateIndex } from "./timeUtils.js";

const DURATION_20_MINUTES_MS = 20 * 60 * 1000;

let timedCommandsInterval = null;
if (isMainModule) {
    timedCommandsInterval = scheduleCompensatedInterval(
        handleTimedCommandsInterval,
        DURATION_20_MINUTES_MS
    );
}
```

#### How to change the interval:
To change the broadcast cadence (for example, to every 15 minutes or 10 minutes), adjust the duration constant:
```javascript
// Change cadence to 15 minutes:
const DURATION_TIMED_COMMANDS_MS = 15 * 60 * 1000;

timedCommandsInterval = scheduleCompensatedInterval(
    handleTimedCommandsInterval,
    DURATION_TIMED_COMMANDS_MS
);
```

#### Adding a new recurring announcement:
If you want to add an independent recurring message (for example, a hydration reminder every 45 minutes):
```javascript
const HYDRATION_INTERVAL_MS = 45 * 60 * 1000;

let hydrationTimer = null;
if (isMainModule) {
    hydrationTimer = scheduleCompensatedInterval(() => {
        postMessage(botID, "kiawaHydrate Time for water! Stay hydrated chat!");
    }, HYDRATION_INTERVAL_MS);
}
```

Clear your timer handle during shutdown in `performGracefulExit()` so background timers stop cleanly:
```javascript
if (hydrationTimer) {
    hydrationTimer.clear();
    hydrationTimer = null;
}
```

---

### Recipe 2: Adding a Command Cooldown for Chatters

When adding a chat command or minigame (such as `!duel`, `!heist`, or `!trivia`), use a per-user cooldown to prevent spam.

Use monotonic time (`getMonotonicMs()`). Never use wall-clock `Date.now()` for cooldowns, because system clock adjustments can make cooldowns jump backward or expire prematurely.

```javascript
import { getMonotonicMs } from "./timeUtils.js";

// Map storing userId -> monotonic timestamp in milliseconds
const duelCooldowns = new Map();
const DUEL_COOLDOWN_MS = 30 * 1000; // 30 seconds

function handleDuelCommand(userId, userName) {
    const now = getMonotonicMs();
    const lastUsed = duelCooldowns.get(userId) || 0;
    const elapsed = now - lastUsed;

    if (elapsed < DUEL_COOLDOWN_MS) {
        const secondsRemaining = Math.ceil((DUEL_COOLDOWN_MS - elapsed) / 1000);
        postMessage(botID, `@${userName}, please wait ${secondsRemaining}s before dueling again!`);
        return;
    }

    // Update cooldown timestamp
    duelCooldowns.set(userId, now);

    // Proceed with the duel logic...
    postMessage(botID, `@${userName} steps into the arena!`);
}
```

---

### Recipe 3: Storing and Reading Timestamps in JSON Data Files

When persisting events (such as quotes, user rewards, or channel point redemptions) into `data/*.json` files:

1. **Always write in UTC ISO-8601:**
   ```javascript
   import { getUtcNowIsoString } from "./timeUtils.js";

   const newRecord = {
       userId: "12345",
       redeemedAt: getUtcNowIsoString() // "2026-10-10T20:30:00.000Z"
   };
   ```

2. **Always parse with `parseIsoDateTime()`:**
   ```javascript
   import { parseIsoDateTime } from "./timeUtils.js";

   const redeemedTime = parseIsoDateTime(userRecord.redeemedAt);
   if (!redeemedTime) {
       // Graceful fallback if the file had null, empty, or unparseable text
       console.warn("Invalid timestamp encountered; resetting record.");
   }
   ```

3. **Checking elapsed time safely:**
   Use `isWithinRestartWindow()` to guard against negative durations if timestamps arrive out of sequence:
   ```javascript
   import { isWithinRestartWindow, parseIsoDateTime } from "./timeUtils.js";

   const previousTime = parseIsoDateTime(record.lastActionAt);
   const currentTime = parseIsoDateTime(getUtcNowIsoString());
   const ONE_HOUR_MS = 60 * 60 * 1000;

   // Returns true only if 0 <= (currentTime - previousTime) < ONE_HOUR_MS
   if (previousTime && isWithinRestartWindow(previousTime, currentTime, ONE_HOUR_MS)) {
       console.log("Action occurred within the last hour.");
   }
   ```

---

### Recipe 4: Working with Stream Sessions & Streaks

Stream attendance streaks in Kiara Bot accommodate real broadcast schedules rather than calendar midnights:

1. **The 06:00 AM Broadcast Cutoff:**
   - Broadcasts often extend past midnight. A stream starting at 01:00 AM belongs to the preceding evening broadcast day, not the next calendar day.
   - The daily cutoff occurs at **06:00:00 local time** in the streamer active timezone (`America/Los_Angeles` by default).
   - Use `getDailyResetCutoffTime(streamStartDateTime)` to compute the 06:00 AM boundary.

2. **Short Disconnects and Stream Restarts:**
   - If OBS restarts or a network drop causes the stream to reconnect within 5 hours, the bot treats it as a continuation of the same broadcast session.
   - Attendance streaks do not require re-checking in, and counts do not double-increment.

3. **Session-Bound Attendance Cache:**
   - The bot uses `StreamAttendanceSessionTracker` to track who checked in during the current stream.
   - When a new stream session begins, `streamAttendanceTracker.synchronizeSession(currentStreamStart)` resets the cache so viewers can streak again on the new broadcast day.

---

### Recipe 5: Streamer Timezone & Location Privacy

The broadcaster can inspect or update the active timezone via chat commands:
- `!timezone`: Displays current UTC offset and ISO timestamp without revealing geographic city or region names.
- `!settimezone <zone>`: Updates the streamer timezone immediately. Accepts IANA names (such as `America/Chicago`, `Asia/Tokyo`), full offsets (`UTC+2`, `+05:00`), bare offsets (`+5`, `-8`), or GMT aliases (`GMT+3`).

#### Location Privacy Principle:
To protect broadcaster privacy, chat messages should not display geographic city or country names. Output offsets and ISO strings instead:
```javascript
import { getStreamerUtcOffset, getStreamerIsoString } from "./timeUtils.js";

// Returns "UTC-7"
const offsetStr = getStreamerUtcOffset();

// Returns "2026-10-10T15:30:00.000-07:00"
const isoStr = getStreamerIsoString();

postMessage(botID, `Current streamer timezone offset is ${offsetStr} (${isoStr}).`);
```

#### Midstream Timezone Relocation Policy:
If the broadcaster updates their timezone during an ongoing stream (for example, while traveling across the International Date Line):
1. **Active Stream Safety:** The current stream session remains anchored to its UTC start time (`Current_Stream.Start`). Viewers who already checked in retain their streaks without double-counting.
2. **Next Stream Governing Zone:** The updated timezone takes effect for the 06:00 AM reset cutoff of future streams starting after the active broadcast ends.

---

## 3. Comparing Standard JavaScript and Kiara Bot Patterns

Here is how common time operations differ between plain JavaScript and the specialized utilities in `timeUtils.js`:

### Pattern 1: Formatting Timestamps for Chat or Quotes

* **Standard JavaScript Approach:**
  ```javascript
  // Manual string formatting with Date
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  let hour = now.getHours();
  let ampm = "AM";
  if (hour > 12) {
      hour -= 12;
      ampm = "PM";
  }
  if (hour === 0) {
      hour = 12;
  }
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const formatted = `${year}/${month}/${date} ${hour}:${minutes} ${ampm}`;
  ```
  *Why use the helper:* Manual 12-hour formatting requires special cases around noon and midnight. `formatQuoteTimestamp()` directly produces unambiguous 24-hour UTC timestamps (`"yyyy-MM-dd HH:mm:ss"`).

* **Kiara Bot Pattern:**
  ```javascript
  import { formatQuoteTimestamp } from "./timeUtils.js";

  // Formats in clean 24-hour UTC ISO format with seconds: "2026-10-10 12:00:00"
  const formatted = formatQuoteTimestamp();
  ```

---

### Pattern 2: Measuring Elapsed Windows Between Events

* **Standard JavaScript Approach:**
  ```javascript
  // Raw millisecond subtraction
  const currentStart = new Date(startedAtStr).getTime();
  const lastStart = new Date(streakList.Current_Stream.Start).getTime();

  if (!isNaN(lastStart) && (currentStart - lastStart) < 5 * 60 * 60 * 1000) {
      // If currentStart precedes lastStart due to out-of-order events,
      // the negative difference satisfies the < 5 hours condition unexpectedly.
  }
  ```
  *Why use the helper:* `isWithinRestartWindow()` strictly verifies both lower and upper bounds: `0 <= (currentStart - lastStart) < maxWindowMs`.

* **Kiara Bot Pattern:**
  ```javascript
  import { parseIsoDateTime, isWithinRestartWindow, FIVE_HOURS_MS } from "./timeUtils.js";

  const currentStart = parseIsoDateTime(startedAtStr);
  const lastStart = parseIsoDateTime(streakList.Current_Stream.Start);

  // Verifies that 0 <= (currentStart - lastStart) < FIVE_HOURS_MS
  if (lastStart && currentStart && isWithinRestartWindow(lastStart, currentStart, FIVE_HOURS_MS)) {
      // Reconnected within 5-hour window
  }
  ```

---

### Pattern 3: Periodic Timers and Message Lists

* **Standard JavaScript Approach:**
  ```javascript
  // Uncompensated timer with plain modulo
  setInterval(() => {
      if (activityDetection) {
          postCommand(timedCommands[commandIndex]);
          commandIndex = (commandIndex + 1) % timedCommands.length;
          activityDetection = false;
      }
  }, 1000 * 60 * 20);
  ```
  *Why use the helper:* If `timedCommands` is empty, `% 0` yields `NaN`. Additionally, `setInterval` drifts over extended uptime. `scheduleCompensatedInterval()` self-corrects drift on every tick, and `safeRotateIndex()` protects against empty arrays.

* **Kiara Bot Pattern:**
  ```javascript
  import { scheduleCompensatedInterval, safeRotateIndex } from "./timeUtils.js";

  const DURATION_20_MINUTES_MS = 20 * 60 * 1000;

  const timerHandle = scheduleCompensatedInterval(() => {
      if (activityDetection) {
          if (timedCommands.length > 0) {
              postCommand(timedCommands[commandIndex]);
              // Safe against empty arrays: safeRotateIndex returns 0 if length <= 0
              commandIndex = safeRotateIndex(commandIndex, timedCommands.length);
          }
          activityDetection = false;
      }
  }, DURATION_20_MINUTES_MS);

  // When shutting down or tearing down tests:
  timerHandle.clear();
  ```

---

### Pattern 4: Handling Daily Resets Across Timezones

* **Standard JavaScript Approach:**
  ```javascript
  // Hardcoded offset calculation
  const now = new Date();
  const resetHour = 6;
  // Hardcoding a fixed offset like -7 or -8 breaks across Daylight Saving transitions
  // and does not adjust if the broadcaster streams from a different timezone.
  ```
  *Why use the helper:* `getDailyResetCutoffTime()` uses Luxon with the configured IANA timezone, automatically accounting for daylight saving shifts and regional rules.

* **Kiara Bot Pattern:**
  ```javascript
  import { getDailyResetCutoffTime, getStreamerTimezone } from "./timeUtils.js";

  // Automatically respects active IANA timezone and daylight saving shifts:
  const cutoffDateTime = getDailyResetCutoffTime(streamStartDateTime);
  ```

---

### Pattern 5: In-Memory Cooldowns and Session Expiry

* **Standard JavaScript Approach:**
  ```javascript
  // Wall-clock Date.now() for in-memory timers
  const session = { createdAt: Date.now() };

  // Later...
  if (Date.now() - session.createdAt > 10 * 60 * 1000) {
      // System clock adjustments or NTP sync can cause Date.now() to step backward,
      // leaving elapsed time negative.
  }
  ```
  *Why use the helper:* Monotonic time strictly increases regardless of wall-clock or NTP adjustments.

* **Kiara Bot Pattern:**
  ```javascript
  import { getMonotonicMs, TEN_MINUTES_MS } from "./timeUtils.js";

  const session = { createdAt: getMonotonicMs() };

  // Monotonic time never steps backward:
  if (getMonotonicMs() - session.createdAt > TEN_MINUTES_MS) {
      // Expired reliably
  }
  ```

---

## 4. Debugging and Testing Time Logic

When developing time-based features, you can test edge cases easily without waiting for real time to elapse:

1. **Injecting Clock Functions:**
   Both `TwitchAuthPipeline` and `scheduleCompensatedInterval()` accept an optional `nowFn` clock provider. Pass a synthetic clock in tests to simulate the passage of time:
   ```javascript
   let syntheticTime = 1000;
   const pipeline = new TwitchAuthPipeline({
       nowFn: () => syntheticTime
   });

   // Fast-forward 11 minutes instantly:
   syntheticTime += 11 * 60 * 1000;
   pipeline.cleanupExpiredAuthStates();
   ```

2. **Testing Timezone Changes:**
   Use `setStreamerTimezone(zone)` and `resetStreamerTimezone()` in tests to verify how your feature behaves under different offsets:
   ```javascript
   import { setStreamerTimezone, resetStreamerTimezone } from "./timeUtils.js";

   try {
       setStreamerTimezone("Asia/Tokyo");
       // run your feature test...
   } finally {
       resetStreamerTimezone(); // restores America/Los_Angeles
   }
   ```

3. **Defensive Divisors and Rotation:**
   When looping through arrays of chat messages or dividing elapsed durations:
   - Use `safeRotateIndex(currentIndex, array.length)` to prevent `NaN` or division-by-zero crashes on empty arrays.
   - Use `safeDivideDuration(elapsed, total, fallback)` to safely calculate progress percentages without zero-division errors.

---

## 5. Helper Function Reference (`timeUtils.js`)

A quick reference of the utility functions available for import:

### Parsing & Formatting
- **`parseIsoDateTime(isoString)`**
  Parses an ISO-8601 string into a UTC Luxon `DateTime`. Returns `null` for invalid or unparseable input.
- **`getUtcNowIsoString(dateTime = null)`**
  Returns a standard ISO-8601 UTC string (for example `"2026-10-10T12:00:00.000Z"`).
- **`formatQuoteTimestamp(dateTime = null)`**
  Formats quotes in 24-hour UTC format with seconds (`"yyyy-MM-dd HH:mm:ss"`), avoiding 12-hour noon/midnight ambiguity.
- **`getStreamerUtcOffset(refTime = null, zone = null)`**
  Returns formatted UTC offset (for example `"UTC-7"`) masking geographic location.
- **`getStreamerIsoString(refTime = null, zone = null)`**
  Returns ISO-8601 date/time string formatted in the streamer local offset.

### Timers & Clocks
- **`getMonotonicMs()`**
  High-precision monotonic millisecond clock via `performance.timeOrigin + performance.now()`. Use for in-memory elapsed times and cooldowns.
- **`scheduleCompensatedInterval(callback, intervalMs, options = {})`**
  Drift-compensated periodic timer. Returns `{ clear: Function, unref: Function }`.
- **`delayMilliseconds(ms)`**
  Promise-based asynchronous delay helper.

### Timezone Management
- **`normalizeTimezone(zone)`**
  Normalizes IANA names, bare offsets (`+5`, `-8`), full offsets (`UTC+2`), and GMT aliases into valid Luxon timezone identifiers.
- **`isValidTimezone(zone)`**
  Returns `true` if the timezone string is valid and supported by Luxon.
- **`getStreamerTimezone()`**
  Returns the active streamer timezone identifier.
- **`setStreamerTimezone(newZone)`**
  Updates the active streamer timezone in memory.
- **`resetStreamerTimezone()`**
  Resets streamer timezone to default (`America/Los_Angeles`).

### Streaks & Broadcast Sessions
- **`getDailyResetCutoffTime(refTime = null, zone = null)`**
  Computes the 06:00:00 AM local reset cutoff converted to UTC.
- **`isNewStreamAttendanceSession(activeStart, prevStart, prevEnd, cutoff, zone)`**
  Evaluates whether a stream constitutes a new broadcast day session based on 5-hour gap and 06:00 AM boundary rules.
- **`calculateUserStreakProgression(userInfo, activeStart, prevStart, isNewSession)`**
  Calculates next streak count and handles corrupt date recovery.
- **`StreamAttendanceSessionTracker`**
  Class managing in-memory set of users who checked in during the active stream session.

### Defensive Math
- **`isWithinRestartWindow(earlier, later, maxDurationMs)`**
  Returns `true` if `0 <= (later - earlier) < maxDurationMs`. Rejects negative intervals and out-of-order events.
- **`safeDivideDuration(numerator, divisor, fallback = 0)`**
  Safe division guarding against division by zero, negative divisors, or `NaN`.
- **`safeRotateIndex(currentIndex, length)`**
  Safe modulo index increment protecting against empty arrays (`length <= 0`).
- **`findOldestTimestampKey(mapWithCreatedAt)`**
  Finds the oldest key in a Map of objects with numeric `createdAt` properties for LRU/FIFO eviction.
