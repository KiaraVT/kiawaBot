# Working with Time in Kiara Bot

A practical guide for developers, contributors, and maintainers explaining how to handle time properly in Kiara Bot, how monotonic and wall-clock time work, and how to use the built-in time utilities instead of hand-rolling time arithmetic.

All core time utilities are centralized in [`timeUtils.js`](../timeUtils.js) using [Luxon](https://moment.github.io/luxon/).

---

## 1. Monotonic Time vs. Wall-Clock Time

Understanding the difference between **monotonic time** and **wall-clock time** is the foundation for handling time properly in any long-running Node.js application.

### Wall-Clock Time (`Date.now()`, `new Date()`)

- **What it is:** The current calendar date and time in the physical world (e.g. `2026-10-10T16:08:00Z`). It is read from the operating system real-time clock.
- **How it behaves:** Wall-clock time can change unpredictably. It can jump forward or backward when:
  - Network Time Protocol (NTP) synchronizes the system clock with a time server.
  - A user or automated script manually adjusts the system clock.
  - Daylight Saving Time begins or ends (for local representations).
  - A leap second is applied.
- **The risk:** If you measure elapsed time by taking `Date.now() - startTime`, an NTP adjustment can produce a negative duration, zero, or an artificial multi-minute jump.
- **When to use it:** Use wall-clock time when an event needs a human calendar timestamp:
  - Saving records to disk (e.g. quote timestamps in `data/quotes.json`).
  - Communicating with external web services (e.g. Twitch or YouTube API payloads).
  - Displaying dates and times to users in chat or on overlay dashboards.

### Monotonic Time (`performance.now()`, `getMonotonicMs()`)

- **What it is:** A strictly increasing counter measuring time elapsed since a fixed point (typically process start), provided by `performance.timeOrigin + performance.now()`.
- **How it behaves:** Monotonic means "always moving in one direction." It never jumps backward, never pauses, and ticks forward at a constant rate regardless of what happens to the system clock.
- **The guarantee:** If $T_2$ is sampled after $T_1$, then $T_2 - T_1$ is guaranteed to be positive and represents the exact physical duration elapsed between the two samples.
- **When to use it:** Use monotonic time for all runtime intervals and in-memory timing:
  - Command cooldowns (e.g. 30-second delay between user commands).
  - Rate limiting and token bucket throttling.
  - In-memory cache or authentication state expiration.
  - Periodic timers and measuring execution lag.

---

## 2. Choosing the Right Time Representation

Use this quick guide to choose the appropriate time type for your feature:

| What your feature is doing | Time Representation | Recommended Utilities | Why this handles time properly |
|---|---|---|---|
| **Elapsed durations, cooldowns, timers, recurring intervals** | Monotonic Time | `getMonotonicMs()`, `scheduleCompensatedInterval()` | Immune to system clock adjustments, NTP steps, and daylight saving shifts. Guarantees steady forward progress. |
| **Data persistence, JSON files, API payloads, WebSockets** | UTC ISO-8601 | `getUtcNowIsoString()`, `parseIsoDateTime()` | Universal, machine-readable source of truth across systems without timezone or daylight saving ambiguity. |
| **Stream sessions, attendance streaks, daily check-in resets** | Streamer Local Time | `getDailyResetCutoffTime()`, `getStreamerTimezone()` | Matches real broadcast schedules, allowing overnight streams past midnight to count toward the same broadcast day until 06:00 AM local time. |
| **Chat outputs, quote timestamps, web overlay text** | Privacy-Safe Display | `formatQuoteTimestamp()`, `getStreamerUtcOffset()`, `getStreamerIsoString()` | Human-readable formatting that protects broadcaster privacy by displaying UTC offsets rather than physical city names. |

---

## 3. Hand-Rolled JavaScript vs. Kiara Bot Time Utilities

When writing JavaScript, it is common to reach for native `Date` arithmetic or standard `setInterval`. Below are generic examples comparing common hand-rolled approaches with the specialized utilities provided in `timeUtils.js`.

### Example 1: Measuring In-Memory Cooldowns and Expiration

When tracking whether an in-memory action has expired or is on cooldown:

* **Hand-Rolled JavaScript:**
  ```javascript
  // Hand-rolled wall-clock check
  const cooldowns = new Map();
  const COOLDOWN_MS = 30000;

  function canExecute(userId) {
      const lastTime = cooldowns.get(userId) || 0;
      return (Date.now() - lastTime) >= COOLDOWN_MS;
  }
  ```
  *Why hand-rolling is tricky:* If the system clock steps backward via NTP, `Date.now() - lastTime` evaluates to a negative number, locking the user out for longer than intended.
  
* **Kiara Bot Pattern:**
  ```javascript
  import { getMonotonicMs } from "./timeUtils.js";

  const cooldowns = new Map();
  const COOLDOWN_MS = 30000;

  function canExecute(userId) {
      const now = getMonotonicMs();
      const lastTime = cooldowns.get(userId) || 0;
      if (now - lastTime >= COOLDOWN_MS) {
          cooldowns.set(userId, now);
          return true;
      }
      return false;
  }
  ```
  *Why this handles time properly:* `getMonotonicMs()` ticks forward steadily and never steps backward, guaranteeing reliable cooldown expiration.

---

### Example 2: Scheduling Recurring Timers Without Drift

When scheduling a background routine to run at a recurring interval:

* **Hand-Rolled JavaScript:**
  ```javascript
  // Hand-rolled uncompensated timer
  setInterval(() => {
      broadcastPeriodicMessage();
  }, 15 * 60 * 1000);
  ```
  *Why hand-rolling is tricky:* Standard `setInterval` guarantees only a minimum delay before callback execution. In Node.js, timer callbacks wait in the event loop queue until synchronous code finishes. If the bot is processing heavy chat bursts or disk writes, the callback fires late. With standard `setInterval`, this delay is not corrected on the next tick, causing the recurring schedule to drift further and further behind over days or weeks of uptime.
  
* **Kiara Bot Pattern:**
  ```javascript
  import { scheduleCompensatedInterval } from "./timeUtils.js";

  const intervalHandle = scheduleCompensatedInterval(() => {
      broadcastPeriodicMessage();
  }, 15 * 60 * 1000);

  // During application shutdown:
  intervalHandle.clear();
  ```
  *Why this handles time properly:* `scheduleCompensatedInterval()` samples monotonic time on each tick, calculates execution lag, and adjusts the next timeout (`Math.max(0, intervalMs - drift)`) so the recurring schedule stays synchronized. Calling `intervalHandle.clear()` cleanly stops scheduling.

---

### Example 3: Safely Cycling Through Collections

When rotating through a list of announcements, quotes, or commands:

* **Hand-Rolled JavaScript:**
  ```javascript
  // Hand-rolled modulo increment
  let currentIndex = 0;

  function getNextItem(items) {
      const item = items[currentIndex];
      currentIndex = (currentIndex + 1) % items.length;
      return item;
  }
  ```
  *Why hand-rolling is tricky:* If `items` is empty (`items.length === 0`), `(currentIndex + 1) % 0` produces `NaN`. Once `currentIndex` becomes `NaN`, all future indexing operations fail.
  
* **Kiara Bot Pattern:**
  ```javascript
  import { safeRotateIndex } from "./timeUtils.js";

  let currentIndex = 0;

  function getNextItem(items) {
      if (items.length === 0) return null;
      const item = items[currentIndex];
      currentIndex = safeRotateIndex(currentIndex, items.length);
      return item;
  }
  ```
  *Why this handles time properly:* `safeRotateIndex()` guards against zero or negative lengths, safely returning `0` whenever `length <= 0`.

---

### Example 4: Verifying Elapsed Windows Between Two Timestamps

When checking whether two stored ISO timestamps fall within an acceptable window (such as checking whether a disconnected stream restarted within 5 hours):

* **Hand-Rolled JavaScript:**
  ```javascript
  // Hand-rolled difference calculation
  function isWithinWindow(startIso, endIso, maxWindowMs) {
      const diff = new Date(endIso).getTime() - new Date(startIso).getTime();
      return diff < maxWindowMs;
  }
  ```
  *Why hand-rolling is tricky:* If timestamps arrive out of sequence, `diff` is negative. Because any negative number is less than `maxWindowMs`, the condition evaluates to `true` despite the inverted order.
  
* **Kiara Bot Pattern:**
  ```javascript
  import { parseIsoDateTime, isWithinRestartWindow } from "./timeUtils.js";

  function isWithinWindow(startIso, endIso, maxWindowMs) {
      const start = parseIsoDateTime(startIso);
      const end = parseIsoDateTime(endIso);
      return start && end && isWithinRestartWindow(start, end, maxWindowMs);
  }
  ```
  *Why this handles time properly:* `isWithinRestartWindow()` verifies both bounds simultaneously: `0 <= (end - start) < maxWindowMs`.

---

### Example 5: Formatting Timestamps for Chat and Quotes

When generating a date and time string to output in chat or save in a record:

* **Hand-Rolled JavaScript:**
  ```javascript
  // Hand-rolled date string assembly
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  let hours = now.getHours();
  let ampm = "AM";
  if (hours >= 12) {
      ampm = "PM";
      if (hours > 12) hours -= 12;
  } else if (hours === 0) {
      hours = 12;
  }
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const formatted = `${year}/${month}/${day} ${hours}:${minutes} ${ampm}`;
  ```
  *Why hand-rolling is tricky:* Assembling strings manually involves zero-indexed month offsets, padding logic, and tricky 12-hour noon and midnight conversions.
  
* **Kiara Bot Pattern:**
  ```javascript
  import { formatQuoteTimestamp } from "./timeUtils.js";

  // Returns unambiguous 24-hour UTC ISO string: "2026-10-10 12:00:00"
  const formatted = formatQuoteTimestamp();
  ```
  *Why this handles time properly:* `formatQuoteTimestamp()` uses Luxon to output a consistent, unambiguous 24-hour format in UTC.

---

### Example 6: Calculating Daily Resets Across Timezones

When computing a daily reset cutoff (such as 06:00 AM local time):

* **Hand-Rolled JavaScript:**
  ```javascript
  // Hand-rolled numeric offset arithmetic
  function getDailyCutoff(date) {
      const cutoff = new Date(date);
      // Hardcoding Pacific Standard Time as UTC-8:
      cutoff.setUTCHours(6 + 8, 0, 0, 0);
      return cutoff;
  }
  ```
  *Why hand-rolling is tricky:* Fixed numeric offsets break when a region transitions between Standard Time and Daylight Saving Time (e.g. UTC-8 to UTC-7). They also fail if the broadcaster relocates to another timezone.
  
* **Kiara Bot Pattern:**
  ```javascript
  import { getDailyResetCutoffTime, getStreamerTimezone } from "./timeUtils.js";

  // Computes 06:00 AM in the active IANA timezone and converts to UTC:
  const cutoff = getDailyResetCutoffTime(currentDateTime);
  ```
  *Why this handles time properly:* `getDailyResetCutoffTime()` uses Luxon with the configured IANA timezone identifier (e.g. `"America/Los_Angeles"`), automatically accounting for Daylight Saving transitions and regional calendar rules.

---

## 4. Practical Feature Recipes

### Recipe 1: Scheduling Recurring Chat Messages

To broadcast recurring links, reminders, or social shoutouts:

```javascript
import { scheduleCompensatedInterval } from "./timeUtils.js";

const TWENTY_MINUTES_MS = 20 * 60 * 1000;

// Schedule the interval
const messageTimer = scheduleCompensatedInterval(() => {
    postMessage(botID, "Follow our social channels and join the community!");
}, TWENTY_MINUTES_MS);

// Clean up when stopping the bot
function onShutdown() {
    if (messageTimer) {
        messageTimer.clear();
    }
}
```

#### Why Background Timers Distort Time Under Processing Lag and During Shutdown:

In Node.js, timers do not execute on dedicated hardware threads; they share the single-threaded event loop. Understanding how event-loop lag affects timers explains why background cleanup is essential:

1. **Processing Lag Delays Timer Callbacks:**
   When the bot performs heavy work (such as handling high-traffic chat spikes, running disk writes, or processing OAuth flows), the event loop is occupied. A timer scheduled for a specific instant cannot run until current synchronous operations finish. If a callback is delayed by several seconds, any timestamp sampled inside that callback reflects execution lag rather than the scheduled moment.

2. **Compounding Interval Drift:**
   With standard `setInterval`, delayed execution shifts the baseline for all subsequent intervals. If each tick is delayed by even 50 milliseconds due to event-loop processing, the timer drifts significantly over days of continuous operation. `scheduleCompensatedInterval()` eliminates this by measuring the drift using monotonic time and shortening the subsequent delay to bring the timer back into sync.

3. **Distorted Calculations During Shutdown:**
   During graceful shutdown routines (such as in `performGracefulExit()`), database files are flushed, network connections close, and caches clear. If background timers remain active:
   - They continue queueing delayed callbacks during teardown.
   - A lagging callback may fire against partially torn-down state, calculating elapsed durations against closed sockets or stale timestamps.
   - Uncleared timer handles keep the Node.js event loop active, preventing the process from exiting cleanly.
   - Clearing the timer handle via `timer.clear()` immediately deregisters the callback from the event loop, ensuring no delayed ticks execute against shutting-down state.

---

### Recipe 2: Adding a Command Cooldown for Chatters

To protect minigames or commands from spam:

```javascript
import { getMonotonicMs } from "./timeUtils.js";

const commandCooldowns = new Map();
const COOLDOWN_MS = 30 * 1000; // 30 seconds

function handleChatCommand(userId, userName) {
    const now = getMonotonicMs();
    const lastUsed = commandCooldowns.get(userId) || 0;
    const elapsed = now - lastUsed;

    if (elapsed < COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        postMessage(botID, `@${userName}, please wait ${remainingSeconds}s before using this command again!`);
        return;
    }

    commandCooldowns.set(userId, now);
    postMessage(botID, `@${userName} executed the command!`);
}
```

---

### Recipe 3: Storing and Reading Timestamps in JSON Data Files

When persisting user activity, quotes, or redemptions:

```javascript
import { getUtcNowIsoString, parseIsoDateTime, isWithinRestartWindow } from "./timeUtils.js";

// Storing a new record
const record = {
    userId: "12345",
    updatedAt: getUtcNowIsoString() // "2026-10-10T20:30:00.000Z"
};

// Reading and checking elapsed time
const recordTime = parseIsoDateTime(record.updatedAt);
const currentTime = parseIsoDateTime(getUtcNowIsoString());
const ONE_HOUR_MS = 60 * 60 * 1000;

if (recordTime && currentTime && isWithinRestartWindow(recordTime, currentTime, ONE_HOUR_MS)) {
    console.log("Record was updated within the last hour.");
}
```

---

### Recipe 4: Broadcast Day Sessions & 06:00 AM Cutoff

Stream attendance streaks in Kiara Bot follow broadcast habits rather than calendar midnights:

1. **The 06:00 AM Broadcast Cutoff:**
   - Broadcasts often extend past midnight. A stream starting at 01:00 AM belongs to the preceding evening broadcast day.
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

---

## 5. Debugging and Testing Time Logic

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
   - Use `safeDivideDuration(numerator, divisor, fallback)` to safely calculate progress percentages without zero-division errors.

---

## 6. Helper Function Reference (`timeUtils.js`)

A quick reference and theoretical code examples for all utility functions exported by [`timeUtils.js`](../timeUtils.js):

### Parsing & Formatting

#### `parseIsoDateTime(isoString)`
Parses an ISO-8601 string into a UTC Luxon `DateTime` instance. Returns `null` for invalid or unparseable input.

```javascript
import { parseIsoDateTime } from "./timeUtils.js";

const dateTime = parseIsoDateTime("2026-10-10T16:00:00.000Z");
if (dateTime) {
    console.log("UTC hour:", dateTime.hour); // 16
} else {
    console.warn("Unparseable timestamp provided.");
}
```

#### `getUtcNowIsoString(dateTime = null)`
Returns a standard ISO-8601 UTC string (for example `"2026-10-10T16:00:00.000Z"`). If a `DateTime` instance is passed, it formats that instance; otherwise, it formats the current time.

```javascript
import { getUtcNowIsoString } from "./timeUtils.js";

// Generate current UTC timestamp for JSON records
const timestamp = getUtcNowIsoString();
console.log("Recorded at:", timestamp);
```

#### `formatQuoteTimestamp(dateTime = null)`
Formats timestamps in 24-hour UTC format with seconds (`"yyyy-MM-dd HH:mm:ss"`), avoiding 12-hour noon/midnight ambiguity.

```javascript
import { formatQuoteTimestamp } from "./timeUtils.js";

// Format current time or an ISO string for quotes or chat
const formatted = formatQuoteTimestamp();
console.log(formatted); // "2026-10-10 16:00:00"
```

#### `getStreamerUtcOffset(refTime = null, zone = null)`
Returns the formatted UTC offset (for example `"UTC-7"`) for the streamer's active timezone, protecting geographic privacy.

```javascript
import { getStreamerUtcOffset } from "./timeUtils.js";

const offset = getStreamerUtcOffset();
console.log(`Current broadcaster offset: ${offset}`);
```

#### `getStreamerIsoString(refTime = null, zone = null)`
Returns an ISO-8601 formatted date/time string localized to the streamer's active timezone offset.

```javascript
import { getStreamerIsoString } from "./timeUtils.js";

const localIso = getStreamerIsoString();
console.log(`Localized timestamp: ${localIso}`); // "2026-10-10T09:00:00.000-07:00"
```

---

### Timers & Clocks

#### `getMonotonicMs()`
Returns a high-precision monotonic millisecond timestamp via `performance.timeOrigin + performance.now()`. Use for in-memory cooldowns, rate limits, and elapsed duration checks.

```javascript
import { getMonotonicMs } from "./timeUtils.js";

const start = getMonotonicMs();
// Perform operation...
const elapsed = getMonotonicMs() - start;
console.log(`Execution took ${elapsed.toFixed(2)}ms`);
```

#### `scheduleCompensatedInterval(callback, intervalMs, options = {})`
Schedules a recurring task with self-correcting drift compensation. Returns `{ clear: Function, unref: Function }`.

```javascript
import { scheduleCompensatedInterval } from "./timeUtils.js";

const timer = scheduleCompensatedInterval(() => {
    console.log("Compensated tick executed.");
}, 10000);

// Stop the timer
timer.clear();
```

#### `delayMilliseconds(ms)`
Promise-based asynchronous delay helper.

```javascript
import { delayMilliseconds } from "./timeUtils.js";

async function waitAndRetry() {
    console.log("Waiting 2 seconds...");
    await delayMilliseconds(2000);
    console.log("Done waiting.");
}
```

---

### Timezone Management

#### `normalizeTimezone(zone)`
Normalizes IANA names, bare offsets (`+5`, `-8`), full offsets (`UTC+2`), and GMT aliases into valid Luxon timezone identifiers. Returns `null` if invalid.

```javascript
import { normalizeTimezone } from "./timeUtils.js";

console.log(normalizeTimezone("+5"));         // "UTC+5"
console.log(normalizeTimezone("GMT-8"));      // "UTC-8"
console.log(normalizeTimezone("Asia/Tokyo")); // "Asia/Tokyo"
console.log(normalizeTimezone("invalid"));    // null
```

#### `isValidTimezone(zone)`
Returns `true` if the timezone string or offset is recognized and supported by Luxon.

```javascript
import { isValidTimezone } from "./timeUtils.js";

if (isValidTimezone(userInput)) {
    console.log("Valid timezone.");
} else {
    console.warn("Invalid timezone specified.");
}
```

#### `getStreamerTimezone()`
Returns the active streamer timezone identifier.

```javascript
import { getStreamerTimezone } from "./timeUtils.js";

const activeZone = getStreamerTimezone();
console.log(`Active zone: ${activeZone}`); // e.g. "America/Los_Angeles"
```

#### `setStreamerTimezone(newZone)`
Updates the active streamer timezone in memory. Returns `true` if updated successfully.

```javascript
import { setStreamerTimezone } from "./timeUtils.js";

const updated = setStreamerTimezone("America/New_York");
if (updated) {
    console.log("Streamer timezone updated.");
}
```

#### `resetStreamerTimezone()`
Resets the streamer timezone back to the configured default (`America/Los_Angeles` or `process.env.STREAMER_TIMEZONE`).

```javascript
import { resetStreamerTimezone } from "./timeUtils.js";

resetStreamerTimezone();
console.log("Timezone reset to default.");
```

---

### Streaks & Broadcast Sessions

#### `getDailyResetCutoffTime(refTime = null, zone = null)`
Computes the 06:00:00 AM local reset cutoff converted to UTC for the broadcast day corresponding to `refTime`.

```javascript
import { getDailyResetCutoffTime, parseIsoDateTime } from "./timeUtils.js";

const streamStart = parseIsoDateTime("2026-10-10T02:00:00.000Z");
const cutoffUtc = getDailyResetCutoffTime(streamStart);
console.log("Cutoff in UTC:", cutoffUtc.toISO());
```

#### `isNewStreamAttendanceSession(activeStart, prevStart, prevEnd, cutoff, zone)`
Evaluates whether a stream constitutes a new broadcast day session based on the 5-hour gap and 06:00 AM boundary rules.

```javascript
import { isNewStreamAttendanceSession, parseIsoDateTime } from "./timeUtils.js";

const currentStart = parseIsoDateTime("2026-10-10T18:00:00.000Z");
const prevStart = parseIsoDateTime("2026-10-09T18:00:00.000Z");
const prevEnd = parseIsoDateTime("2026-10-09T22:00:00.000Z");

const isNew = isNewStreamAttendanceSession(currentStart, prevStart, prevEnd);
console.log("Is new session:", isNew); // true
```

#### `calculateUserStreakProgression(userInfo, activeStart, prevStart, isNewSession)`
Calculates the next streak count, updates the best streak, and handles corrupt date recovery.

```javascript
import { calculateUserStreakProgression, parseIsoDateTime } from "./timeUtils.js";

const userStreak = { Streak: 4, Best_Streak: 10, Last_Updated: "2026-10-09T19:00:00.000Z" };
const activeStart = parseIsoDateTime("2026-10-10T18:00:00.000Z");
const prevStart = parseIsoDateTime("2026-10-09T18:00:00.000Z");

const result = calculateUserStreakProgression(userStreak, activeStart, prevStart, true);
console.log(`New streak: ${result.streak}, status: ${result.status}`);
```

#### `StreamAttendanceSessionTracker`
Class managing the in-memory cache of viewers who checked in during the active stream session.

```javascript
import { StreamAttendanceSessionTracker } from "./timeUtils.js";

const tracker = new StreamAttendanceSessionTracker();

// Synchronize session against current stream start:
tracker.synchronizeSession("2026-10-10T18:00:00.000Z");

if (!tracker.hasStreaked("user_123")) {
    tracker.markStreaked("user_123");
    console.log("Viewer checked in for this stream.");
}
```

---

### Defensive Math

#### `isWithinRestartWindow(earlier, later, maxDurationMs)`
Returns `true` if `0 <= (later - earlier) < maxDurationMs`. Safely rejects negative intervals and out-of-order events.

```javascript
import { isWithinRestartWindow, parseIsoDateTime, FIVE_HOURS_MS } from "./timeUtils.js";

const prevEnd = parseIsoDateTime("2026-10-10T12:00:00.000Z");
const currentStart = parseIsoDateTime("2026-10-10T14:30:00.000Z");

if (isWithinRestartWindow(prevEnd, currentStart, FIVE_HOURS_MS)) {
    console.log("Reconnected within 5 hours.");
}
```

#### `safeDivideDuration(numerator, divisor, fallback = 0)`
Safe division guarding against division by zero, negative divisors, or `NaN`.

```javascript
import { safeDivideDuration } from "./timeUtils.js";

const elapsed = 45;
const total = 100;
const fraction = safeDivideDuration(elapsed, total, 0);
console.log(`Progress: ${(fraction * 100).toFixed(0)}%`);
```

#### `safeRotateIndex(currentIndex, length)`
Safe modulo index increment protecting against empty collections (`length <= 0`).

```javascript
import { safeRotateIndex } from "./timeUtils.js";

const messages = ["Hello", "Welcome", "Rules"];
let index = 0;

// Advances safely to next index; returns 0 if messages is empty
index = safeRotateIndex(index, messages.length);
```

#### `findOldestTimestampKey(mapWithCreatedAt)`
Finds the key associated with the oldest `createdAt` timestamp in a Map for FIFO or LRU cache eviction.

```javascript
import { findOldestTimestampKey, getMonotonicMs } from "./timeUtils.js";

const activeStates = new Map([
    ["state_1", { createdAt: getMonotonicMs() - 600000 }],
    ["state_2", { createdAt: getMonotonicMs() - 300000 }]
]);

const oldestKey = findOldestTimestampKey(activeStates);
console.log("Evicting oldest state:", oldestKey); // "state_1"
activeStates.delete(oldestKey);
```
