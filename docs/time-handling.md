# Working with Time in Kiara Bot

A practical guide for developers, contributors, and maintainers explaining how to handle time properly in Kiara Bot, how monotonic and wall-clock time work, and how to use the built-in time utilities instead of hand-rolling time arithmetic.

All core time utilities are centralized in [`timeUtils.js`](../timeUtils.js) using [Luxon](https://moment.github.io/luxon/).

> [!NOTE]
> **Core Principle:** Use **monotonic time** for in-memory timers, intervals, and cooldowns. Use **UTC ISO-8601** for storing data on disk and sending network payloads. Use **streamer local time** for broadcast day cutoffs and attendance streaks.

---

## Table of Contents

1. [Quick Start Cheat Sheet](#1-quick-start-cheat-sheet)
2. [Monotonic Time vs. Wall-Clock Time](#2-monotonic-time-vs-wall-clock-time)
3. [Choosing the Right Time Representation](#3-choosing-the-right-time-representation)
4. [Common Pitfalls: Hand-Rolled Time vs. Kiara Bot Utilities](#4-common-pitfalls-hand-rolled-time-vs-kiara-bot-utilities)
5. [Practical Feature Recipes](#5-practical-feature-recipes)
   - [Recipe 1: Scheduling Recurring Chat Messages](#recipe-1-scheduling-recurring-chat-messages)
   - [Recipe 2: Adding a Command Cooldown for Chatters](#recipe-2-adding-a-command-cooldown-for-chatters)
   - [Recipe 3: Storing and Reading Timestamps in JSON Data Files](#recipe-3-storing-and-reading-timestamps-in-json-data-files)
   - [Recipe 4: Broadcast Day Sessions & 06:00 AM Cutoff](#recipe-4-broadcast-day-sessions--0600-am-cutoff)
   - [Recipe 5: Streamer Timezone & Location Privacy](#recipe-5-streamer-timezone--location-privacy)
6. [Debugging and Testing Time Logic](#6-debugging-and-testing-time-logic)
7. [Manual Reference: Functions and Constants (`timeUtils.js`)](#7-manual-reference-functions-and-constants-timeutilsjs)
   - [Constants](#constants)
   - [Quick Function Index](#quick-function-index)
   - [Parsing & Formatting](#parsing--formatting)
   - [Timers & Clocks](#timers--clocks)
   - [Timezone Management](#timezone-management)
   - [Streaks & Broadcast Sessions](#streaks--broadcast-sessions)
   - [Defensive Math](#defensive-math)

---

## 1. Quick Start Cheat Sheet

If you need to quickly look up how to perform a common time task:

| If you want to... | Use this utility | Quick Example |
|---|---|---|
| **Add a cooldown between user commands** | `getMonotonicMs()` | `if (getMonotonicMs() - lastUsed < 30000) return;` |
| **Schedule a recurring message without drift** | `scheduleCompensatedInterval()` | `const timer = scheduleCompensatedInterval(fn, 15 * 60 * 1000);` |
| **Save a timestamp into a JSON data file** | `getUtcNowIsoString()` | `const nowIso = getUtcNowIsoString();` |
| **Parse an ISO-8601 string from a file or API** | `parseIsoDateTime()` | `const dt = parseIsoDateTime(record.updatedAt);` |
| **Format current time for chat or quotes** | `formatQuoteTimestamp()` | `const str = formatQuoteTimestamp(); // "2026-10-10 16:00:00"` |
| **Display broadcaster timezone in chat** | `getStreamerUtcOffset()` | `const offset = getStreamerUtcOffset(); // "UTC-7"` |
| **Cycle through an array of announcements** | `safeRotateIndex()` | `index = safeRotateIndex(index, messages.length);` |
| **Pause execution asynchronously** | `delayMilliseconds()` | `await delayMilliseconds(1000);` |
| **Calculate the 06:00 AM daily reset cutoff** | `getDailyResetCutoffTime()` | `const cutoff = getDailyResetCutoffTime(streamStart);` |

---

## 2. Monotonic Time vs. Wall-Clock Time

Understanding the difference between **monotonic time** and **wall-clock time** is the foundation for handling time properly in any long-running Node.js application.

```
+--------------------------------------------------------------------------------+
| Wall-Clock Time (Date.now)         | Monotonic Time (getMonotonicMs)           |
|------------------------------------|-------------------------------------------|
| Measures human calendar time       | Measures elapsed time from process start  |
| Can jump forward or backward (NTP) | Strictly moves forward at a constant rate |
| Subject to DST and manual shifts   | Immune to system clock adjustments        |
| Use for: JSON records, APIs, logs  | Use for: Cooldowns, intervals, timeouts   |
+--------------------------------------------------------------------------------+
```

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

> [!TIP]
> **Rule of Thumb:** If you are asking *"How long has passed since X occurred in this process?"*, use monotonic time (`getMonotonicMs()`). If you are asking *"What day and time did X occur in the real world?"*, use UTC wall-clock time (`getUtcNowIsoString()`).

---

## 3. Choosing the Right Time Representation

Use this decision table to choose the appropriate time type for your feature:

| What your feature is doing | Time Representation | Recommended Utilities | Why this handles time properly |
|---|---|---|---|
| **Elapsed durations, cooldowns, timers, recurring intervals** | Monotonic Time | `getMonotonicMs()`, `scheduleCompensatedInterval()` | Immune to system clock adjustments, NTP steps, and daylight saving shifts. Guarantees steady forward progress. |
| **Data persistence, JSON files, API payloads, WebSockets** | UTC ISO-8601 | `getUtcNowIsoString()`, `parseIsoDateTime()` | Universal, machine-readable source of truth across systems without timezone or daylight saving ambiguity. |
| **Stream sessions, attendance streaks, daily check-in resets** | Streamer Local Time | `getDailyResetCutoffTime()`, `getStreamerTimezone()` | Matches real broadcast schedules, allowing overnight streams past midnight to count toward the same broadcast day until 06:00 AM local time. |
| **Chat outputs, quote timestamps, web overlay text** | Privacy-Safe Display | `formatQuoteTimestamp()`, `getStreamerUtcOffset()`, `getStreamerIsoString()` | Human-readable formatting that protects broadcaster privacy by displaying UTC offsets rather than physical city names. |

---

## 4. Common Pitfalls: Hand-Rolled Time vs. Kiara Bot Utilities

When writing JavaScript, it is common to reach for native `Date` arithmetic or standard `setInterval`. Below are generic comparisons showing common hand-rolled pitfalls and how to write them cleanly using `timeUtils.js`.

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

## 5. Practical Feature Recipes

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

> [!IMPORTANT]
> Always retain a reference to your interval handles and clear them inside `performGracefulExit()`.

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

> [!NOTE]
> **Location Privacy Principle:** Chat messages must never display physical city, state, or country names. Output offsets (`UTC-7`) and ISO strings instead:

```javascript
import { getStreamerUtcOffset, getStreamerIsoString } from "./timeUtils.js";

// Returns "UTC-7"
const offsetStr = getStreamerUtcOffset();

// Returns "2026-10-10T15:30:00.000-07:00"
const isoStr = getStreamerIsoString();

postMessage(botID, `Current streamer timezone offset is ${offsetStr} (${isoStr}).`);
```

---

## 6. Debugging and Testing Time Logic

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

## 7. Manual Reference: Functions and Constants (`timeUtils.js`)

This section serves as a manual page reference for every exported constant, function, and class in [`timeUtils.js`](../timeUtils.js).

### Constants

- **`FIVE_HOURS_MS`** (`number` = `18000000`): 5 hours in milliseconds. Primary window to evaluate whether a stream reconnection is a continuation.
- **`TEN_MINUTES_MS`** (`number` = `600000`): 10 minutes in milliseconds. Used for authorization state expiration and short timeouts.
- **`QUOTE_DATE_FORMAT`** (`string` = `"yyyy-MM-dd HH:mm:ss"`): 24-hour UTC ISO format string with seconds.
- **`DEFAULT_STREAMER_TIMEZONE`** (`string` = `"America/Los_Angeles"`): Primary fallback IANA timezone for broadcast day calculations.

### Quick Function Index

| Function | Category | Summary |
|---|---|---|
| [`parseIsoDateTime`](#parseisodatetimeisostring) | Parsing & Formatting | Parses ISO-8601 string into a UTC Luxon `DateTime` |
| [`getUtcNowIsoString`](#getutcnowisostringdatetime--null) | Parsing & Formatting | Serializes current or given date to UTC ISO-8601 string |
| [`formatQuoteTimestamp`](#formatquotetimestampdatetime--null) | Parsing & Formatting | Formats 24-hour UTC timestamp string with seconds |
| [`getStreamerUtcOffset`](#getstreamerutcoffsetreferencedatetime--datetimenow-zone--null) | Parsing & Formatting | Returns formatted UTC offset (e.g. `"UTC-7"`) |
| [`getStreamerIsoString`](#getstreamerisostringreferencedatetime--datetimenow-zone--null) | Parsing & Formatting | Returns ISO string with active streamer offset |
| [`getMonotonicMs`](#getmonotonicms) | Timers & Clocks | High-precision monotonic millisecond clock |
| [`scheduleCompensatedInterval`](#schedulecompensatedintervalcallback-intervalms-options--) | Timers & Clocks | Drift-compensated periodic interval timer |
| [`delayMilliseconds`](#delaymillisecondsms) | Timers & Clocks | Asynchronously delays execution (Promise sleep) |
| [`normalizeTimezone`](#normalizetimezonetimezone) | Timezone Management | Normalizes IANA names and offsets into Luxon zones |
| [`isValidTimezone`](#isvalidtimezonetimezone) | Timezone Management | Validates whether timezone string is supported |
| [`getStreamerTimezone`](#getstreamertimezone) | Timezone Management | Gets active streamer IANA timezone identifier |
| [`setStreamerTimezone`](#setstreamertimezonenewtimezone) | Timezone Management | Sets active streamer timezone at runtime |
| [`resetStreamerTimezone`](#resetstreamertimezone) | Timezone Management | Resets streamer timezone to default (`America/Los_Angeles`) |
| [`getDailyResetCutoffTime`](#getdailyresetcutofftimereferencedatetime--datetimenow-zone--null) | Streaks & Sessions | Computes 06:00 AM local reset cutoff converted to UTC |
| [`isNewStreamAttendanceSession`](#isnewstreamattendancesessionactivestreamstarttime-previousstreamstarttime-previousstreamendtime--null-dailyresetcutoff--null-zone--null) | Streaks & Sessions | Evaluates if stream is a new broadcast day session |
| [`calculateUserStreakProgression`](#calculateuserstreakprogressionuserinfo-activestreamstarttime-previousstreamstarttime-isnewsession-executiontime--datetimenow) | Streaks & Sessions | Calculates updated streak count and progression status |
| [`StreamAttendanceSessionTracker`](#streamattendancesessiontracker) | Streaks & Sessions | Session-bound cache of viewers checked in for active stream |
| [`isWithinRestartWindow`](#iswithinrestartwindowearliertime-latertime-maxdurationms) | Defensive Math | Verifies `0 <= (later - earlier) < maxDurationMs` |
| [`safeDivideDuration`](#safedividedurationnumerator-divisor-fallback--0) | Defensive Math | Safe division guarding against zero or `NaN` |
| [`safeRotateIndex`](#saferotateindexcurrentindex-collectionlength) | Defensive Math | Safe modulo index increment protecting empty arrays |
| [`findOldestTimestampKey`](#findoldesttimestampkeymapwithcreatedat) | Defensive Math | Finds oldest timestamp key in Map for cache eviction |

---

### Parsing & Formatting

#### `parseIsoDateTime(isoString)`
- **Synopsis:** `parseIsoDateTime(isoString) -> DateTime | null`
- **Description:** Parses an ISO-8601 formatted string into a UTC Luxon `DateTime` instance. Trims leading and trailing whitespace. Returns `null` if the input is not a string, empty, or unparseable.
- **Parameters:**
  - `isoString` (`string | null | undefined`): ISO formatted date string.
- **Returns:** `DateTime | null`: Valid Luxon `DateTime` in UTC, or `null`.
- **Example:**
  ```javascript
  import { parseIsoDateTime } from "./timeUtils.js";

  const dt = parseIsoDateTime("2026-10-10T16:00:00.000Z");
  if (dt) {
      console.log("UTC hour:", dt.hour); // 16
  } else {
      console.warn("Invalid ISO timestamp.");
  }
  ```

#### `getUtcNowIsoString(dateTime = null)`
- **Synopsis:** `getUtcNowIsoString(dateTime) -> string`
- **Description:** Returns a standard ISO-8601 UTC string for storage or API responses. If a valid `DateTime` instance is provided, it converts it to UTC and serializes it; otherwise, it serializes the current instant.
- **Parameters:**
  - `dateTime` (`DateTime | null | undefined`, optional): Optional Luxon `DateTime` instance. Defaults to current time.
- **Returns:** `string`: ISO-8601 UTC string (e.g. `"2026-10-10T16:00:00.000Z"`).
- **Example:**
  ```javascript
  import { getUtcNowIsoString } from "./timeUtils.js";

  const currentUtcIso = getUtcNowIsoString();
  console.log("Saved at:", currentUtcIso);
  ```

#### `formatQuoteTimestamp(dateTime = null)`
- **Synopsis:** `formatQuoteTimestamp(dateTime) -> string`
- **Description:** Formats a timestamp for quote records and chat displays using 24-hour UTC format with seconds (`"yyyy-MM-dd HH:mm:ss"`), eliminating 12-hour AM/PM rollover ambiguity.
- **Parameters:**
  - `dateTime` (`DateTime | string | null | undefined`, optional): Optional `DateTime` instance or ISO string. Defaults to now.
- **Returns:** `string`: Formatted string in `"yyyy-MM-dd HH:mm:ss"` UTC.
- **Example:**
  ```javascript
  import { formatQuoteTimestamp } from "./timeUtils.js";

  const formatted = formatQuoteTimestamp();
  console.log(formatted); // "2026-10-10 16:00:00"
  ```

#### `getStreamerUtcOffset(referenceDateTime = DateTime.now(), zone = null)`
- **Synopsis:** `getStreamerUtcOffset(referenceDateTime, zone) -> string`
- **Description:** Returns the formatted UTC offset string (e.g. `"UTC-7"`, `"UTC+9"`) for the streamer's active timezone, masking geographic location and region names to preserve broadcaster privacy.
- **Parameters:**
  - `referenceDateTime` (`DateTime`, optional): Reference time for offset evaluation. Defaults to now.
  - `zone` (`string | null`, optional): Target timezone or offset. Defaults to `getStreamerTimezone()`.
- **Returns:** `string`: Formatted UTC offset string (e.g. `"UTC-7"`).
- **Example:**
  ```javascript
  import { getStreamerUtcOffset } from "./timeUtils.js";

  const offset = getStreamerUtcOffset();
  console.log(`Current offset: ${offset}`); // "UTC-7"
  ```

#### `getStreamerIsoString(referenceDateTime = DateTime.now(), zone = null)`
- **Synopsis:** `getStreamerIsoString(referenceDateTime, zone) -> string`
- **Description:** Returns an ISO-8601 formatted date and time string localized to the streamer's active timezone offset.
- **Parameters:**
  - `referenceDateTime` (`DateTime`, optional): Reference time. Defaults to now.
  - `zone` (`string | null`, optional): Target timezone or offset. Defaults to `getStreamerTimezone()`.
- **Returns:** `string`: ISO-8601 formatted string with offset (e.g. `"2026-10-10T12:00:00.000-07:00"`).
- **Example:**
  ```javascript
  import { getStreamerIsoString } from "./timeUtils.js";

  const localIso = getStreamerIsoString();
  console.log("Local time:", localIso);
  ```

---

### Timers & Clocks

#### `getMonotonicMs()`
- **Synopsis:** `getMonotonicMs() -> number`
- **Description:** Returns the current time in monotonic milliseconds using `performance.timeOrigin + performance.now()`. Immune to system wall-clock steps, manual adjustments, and NTP corrections.
- **Parameters:** None.
- **Returns:** `number`: Monotonic time in milliseconds on the epoch scale.
- **Example:**
  ```javascript
  import { getMonotonicMs } from "./timeUtils.js";

  const start = getMonotonicMs();
  // Execute operation...
  const elapsed = getMonotonicMs() - start;
  console.log(`Operation took ${elapsed.toFixed(2)}ms`);
  ```

#### `scheduleCompensatedInterval(callback, intervalMs, options = {})`
- **Synopsis:** `scheduleCompensatedInterval(callback, intervalMs, options) -> { clear: Function, unref: Function }`
- **Description:** Schedules a recurring callback with event-loop drift compensation. Measures execution drift on each tick and self-corrects subsequent timeouts to keep cadence steady over long uptimes.
- **Parameters:**
  - `callback` (`Function`): Function to execute periodically.
  - `intervalMs` (`number`): Recurrence interval in milliseconds. Defaults to 1000 if invalid or <= 0.
  - `options` (`object`, optional): Optional configuration object.
  - `options.nowFn` (`Function`, optional): Monotonic clock provider. Defaults to `getMonotonicMs`.
- **Returns:** `{ clear: Function, unref: Function }`: Control handles to stop or unref the timer.
- **Example:**
  ```javascript
  import { scheduleCompensatedInterval } from "./timeUtils.js";

  const timer = scheduleCompensatedInterval(() => {
      console.log("Executing periodic task.");
  }, 10000);

  // Stop timer during shutdown:
  timer.clear();
  ```

#### `delayMilliseconds(ms)`
- **Synopsis:** `delayMilliseconds(ms) -> Promise<void>`
- **Description:** Asynchronously pauses execution for the specified duration using a Promise. Safe against negative or invalid millisecond values.
- **Parameters:**
  - `ms` (`number`): Milliseconds to delay.
- **Returns:** `Promise<void>`: Resolves after the specified delay.
- **Example:**
  ```javascript
  import { delayMilliseconds } from "./timeUtils.js";

  async function waitBriefly() {
      console.log("Pausing 1 second...");
      await delayMilliseconds(1000);
      console.log("Resumed execution.");
  }
  ```

---

### Timezone Management

#### `normalizeTimezone(timezone)`
- **Synopsis:** `normalizeTimezone(timezone) -> string | null`
- **Description:** Normalizes and validates a timezone identifier or UTC offset into a recognized Luxon zone. Supports IANA names (e.g. `"America/Los_Angeles"`), full offsets (e.g. `"UTC+2"`, `"+05:00"`), bare offsets (e.g. `"+5"`, `"-8"`), and GMT aliases (e.g. `"GMT+2"`).
- **Parameters:**
  - `timezone` (`string | null | undefined`): Timezone string or offset to normalize.
- **Returns:** `string | null`: Canonical timezone string recognized by Luxon, or `null` if invalid.
- **Example:**
  ```javascript
  import { normalizeTimezone } from "./timeUtils.js";

  console.log(normalizeTimezone("+5"));         // "UTC+5"
  console.log(normalizeTimezone("GMT-8"));      // "UTC-8"
  console.log(normalizeTimezone("Asia/Tokyo")); // "Asia/Tokyo"
  console.log(normalizeTimezone("invalid"));    // null
  ```

#### `isValidTimezone(timezone)`
- **Synopsis:** `isValidTimezone(timezone) -> boolean`
- **Description:** Validates whether a given timezone string or offset is recognized and supported by Luxon.
- **Parameters:**
  - `timezone` (`string | null | undefined`): Timezone string or offset to validate.
- **Returns:** `boolean`: `true` if recognized, `false` otherwise.
- **Example:**
  ```javascript
  import { isValidTimezone } from "./timeUtils.js";

  if (isValidTimezone(input)) {
      console.log("Timezone is valid.");
  }
  ```

#### `getStreamerTimezone()`
- **Synopsis:** `getStreamerTimezone() -> string`
- **Description:** Retrieves the currently active streamer timezone identifier.
- **Parameters:** None.
- **Returns:** `string`: Active IANA timezone string or normalized offset.
- **Example:**
  ```javascript
  import { getStreamerTimezone } from "./timeUtils.js";

  const zone = getStreamerTimezone();
  console.log("Active streamer zone:", zone); // e.g. "America/Los_Angeles"
  ```

#### `setStreamerTimezone(newTimezone)`
- **Synopsis:** `setStreamerTimezone(newTimezone) -> boolean`
- **Description:** Updates the active streamer timezone dynamically at runtime. Retains the previous timezone if the new input is invalid.
- **Parameters:**
  - `newTimezone` (`string`): Valid IANA timezone identifier or UTC offset.
- **Returns:** `boolean`: `true` if updated successfully, `false` if the input was invalid.
- **Example:**
  ```javascript
  import { setStreamerTimezone } from "./timeUtils.js";

  const success = setStreamerTimezone("Asia/Tokyo");
  if (success) {
      console.log("Broadcaster timezone updated.");
  }
  ```

#### `resetStreamerTimezone()`
- **Synopsis:** `resetStreamerTimezone() -> void`
- **Description:** Resets the active streamer timezone back to the configured default (`America/Los_Angeles` or `process.env.STREAMER_TIMEZONE`).
- **Parameters:** None.
- **Returns:** `void`
- **Example:**
  ```javascript
  import { resetStreamerTimezone } from "./timeUtils.js";

  resetStreamerTimezone();
  ```

---

### Streaks & Broadcast Sessions

#### `getDailyResetCutoffTime(referenceDateTime = DateTime.now(), zone = null)`
- **Synopsis:** `getDailyResetCutoffTime(referenceDateTime, zone) -> DateTime`
- **Description:** Calculates the daily streak reset cutoff point at 06:00:00 local time in the active streamer timezone for the broadcast day corresponding to `referenceDateTime`. If `referenceDateTime` is before 06:00 local time, the broadcast day began at 06:00 on the previous calendar day.
- **Parameters:**
  - `referenceDateTime` (`DateTime`, optional): Reference time. Defaults to now.
  - `zone` (`string | null`, optional): Streamer IANA timezone or offset. Defaults to `getStreamerTimezone()`.
- **Returns:** `DateTime`: Cutoff point at 06:00:00 local time converted to UTC.
- **Example:**
  ```javascript
  import { getDailyResetCutoffTime, parseIsoDateTime } from "./timeUtils.js";

  const streamStart = parseIsoDateTime("2026-10-10T02:00:00.000Z");
  const cutoff = getDailyResetCutoffTime(streamStart);
  console.log("Cutoff UTC ISO:", cutoff.toISO());
  ```

#### `isNewStreamAttendanceSession(activeStreamStartTime, previousStreamStartTime, previousStreamEndTime = null, dailyResetCutoff = null, zone = null)`
- **Synopsis:** `isNewStreamAttendanceSession(activeStart, prevStart, prevEnd, cutoff, zone) -> boolean`
- **Description:** Determines whether the active stream constitutes a new stream attendance session. If `previousStreamEndTime` is known, checks whether the gap exceeds 5 hours. Otherwise, checks whether the stream crossed the 06:00 AM daily cutoff.
- **Parameters:**
  - `activeStreamStartTime` (`DateTime`): Start time of the active broadcast.
  - `previousStreamStartTime` (`DateTime | null`): Start time of the previous broadcast.
  - `previousStreamEndTime` (`DateTime | null`, optional): End time of the previous broadcast.
  - `dailyResetCutoff` (`DateTime | null`, optional): Precomputed daily reset point.
  - `zone` (`string | null`, optional): Streamer IANA timezone.
- **Returns:** `boolean`: `true` if a new session threshold has been crossed.
- **Example:**
  ```javascript
  import { isNewStreamAttendanceSession, parseIsoDateTime } from "./timeUtils.js";

  const currentStart = parseIsoDateTime("2026-10-10T18:00:00.000Z");
  const prevStart = parseIsoDateTime("2026-10-09T18:00:00.000Z");
  const prevEnd = parseIsoDateTime("2026-10-09T22:00:00.000Z");

  const isNew = isNewStreamAttendanceSession(currentStart, prevStart, prevEnd);
  console.log("New session:", isNew); // true
  ```

#### `calculateUserStreakProgression(userInfo, activeStreamStartTime, previousStreamStartTime, isNewSession, executionTime = DateTime.now())`
- **Synopsis:** `calculateUserStreakProgression(userInfo, activeStart, prevStart, isNewSession, executionTime) -> UserStreakProgressionResult`
- **Description:** Pure evaluation function for calculating viewer attendance streak progression. Handles first-time viewers, ongoing sessions, corrupt timestamp recovery, consecutive stream increments, and missed stream resets.
- **Parameters:**
  - `userInfo` (`object | null | undefined`): Existing user record with `Streak`, `Best_Streak`, `Last_Updated`.
  - `activeStreamStartTime` (`DateTime | null | undefined`): Start time of current stream.
  - `previousStreamStartTime` (`DateTime | null | undefined`): Start time of previous stream.
  - `isNewSession` (`boolean`): Whether current stream is a new broadcast day session.
  - `executionTime` (`DateTime`, optional): Reference time for `lastUpdated`. Defaults to now.
- **Returns:** `UserStreakProgressionResult`: `{ streak: number, bestStreak: number, lastUpdated: string, status: "started"|"incremented"|"restarted"|"current" }`.
- **Example:**
  ```javascript
  import { calculateUserStreakProgression, parseIsoDateTime } from "./timeUtils.js";

  const userRecord = { Streak: 3, Best_Streak: 5, Last_Updated: "2026-10-09T19:00:00.000Z" };
  const currentStart = parseIsoDateTime("2026-10-10T18:00:00.000Z");
  const prevStart = parseIsoDateTime("2026-10-09T18:00:00.000Z");

  const result = calculateUserStreakProgression(userRecord, currentStart, prevStart, true);
  console.log(`Updated streak: ${result.streak}, status: ${result.status}`);
  ```

#### `StreamAttendanceSessionTracker`
- **Synopsis:** `class StreamAttendanceSessionTracker`
- **Description:** Session-bound in-memory cache tracking which user IDs have streaked in the active stream session. Automatically resets when a new stream start timestamp is synchronized.
- **Methods:**
  - `synchronizeSession(streamStartIso)`: Synchronizes cache against current stream start timestamp string. Clears tracked IDs if the timestamp changed.
  - `hasStreaked(userId)`: Returns `boolean` indicating whether the user already checked in for the active session.
  - `markStreaked(userId)`: Adds `userId` to the set of streaked viewers for this session.
  - `clear()`: Manually clears all tracked user IDs.
- **Example:**
  ```javascript
  import { StreamAttendanceSessionTracker } from "./timeUtils.js";

  const tracker = new StreamAttendanceSessionTracker();
  tracker.synchronizeSession("2026-10-10T18:00:00.000Z");

  if (!tracker.hasStreaked("user_123")) {
      tracker.markStreaked("user_123");
      console.log("Recorded attendance check-in.");
  }
  ```

---

### Defensive Math

#### `isWithinRestartWindow(earlierTime, laterTime, maxDurationMs)`
- **Synopsis:** `isWithinRestartWindow(earlierTime, laterTime, maxDurationMs) -> boolean`
- **Description:** Validates whether the duration between `earlierTime` and `laterTime` falls strictly within `[0, maxDurationMs)`. Rejects negative durations (clock skew or out-of-order events) and durations exceeding the allowed window.
- **Parameters:**
  - `earlierTime` (`DateTime | null | undefined`): Starting boundary.
  - `laterTime` (`DateTime | null | undefined`): Ending boundary.
  - `maxDurationMs` (`number`): Maximum allowed duration in milliseconds.
- **Returns:** `boolean`: `true` if `0 <= (laterTime - earlierTime) < maxDurationMs`.
- **Example:**
  ```javascript
  import { isWithinRestartWindow, parseIsoDateTime, FIVE_HOURS_MS } from "./timeUtils.js";

  const earlier = parseIsoDateTime("2026-10-10T12:00:00.000Z");
  const later = parseIsoDateTime("2026-10-10T14:00:00.000Z");

  if (isWithinRestartWindow(earlier, later, FIVE_HOURS_MS)) {
      console.log("Within allowable restart window.");
  }
  ```

#### `safeDivideDuration(numerator, divisor, fallback = 0)`
- **Synopsis:** `safeDivideDuration(numerator, divisor, fallback) -> number`
- **Description:** Divides a duration or count safely, protecting against zero, negative, or `NaN` divisors.
- **Parameters:**
  - `numerator` (`number`): Dividend value.
  - `divisor` (`number`): Divisor value.
  - `fallback` (`number`, optional): Safe fallback when divisor is invalid or <= 0. Defaults to 0.
- **Returns:** `number`: Calculated quotient or fallback.
- **Example:**
  ```javascript
  import { safeDivideDuration } from "./timeUtils.js";

  const progress = safeDivideDuration(elapsed, total, 0);
  console.log(`Percent: ${(progress * 100).toFixed(1)}%`);
  ```

#### `safeRotateIndex(currentIndex, collectionLength)`
- **Synopsis:** `safeRotateIndex(currentIndex, collectionLength) -> number`
- **Description:** Advances an index by 1 modulo `collectionLength` safely. Returns `0` if `collectionLength` is 0, negative, or not a number.
- **Parameters:**
  - `currentIndex` (`number`): Current integer index.
  - `collectionLength` (`number`): Length of collection to rotate through.
- **Returns:** `number`: Next 0-based index.
- **Example:**
  ```javascript
  import { safeRotateIndex } from "./timeUtils.js";

  const items = ["One", "Two", "Three"];
  let index = 0;

  index = safeRotateIndex(index, items.length);
  console.log("Next index:", index); // 1
  ```

#### `findOldestTimestampKey(mapWithCreatedAt)`
- **Synopsis:** `findOldestTimestampKey(mapWithCreatedAt) -> string | null`
- **Description:** Finds the key associated with the oldest `createdAt` timestamp in a Map. Used for LRU/FIFO eviction of active sessions.
- **Parameters:**
  - `mapWithCreatedAt` (`Map<string, { createdAt: number }>`): Map containing objects with numeric `createdAt`.
- **Returns:** `string | null`: Key of the oldest item, or `null` if empty or invalid.
- **Example:**
  ```javascript
  import { findOldestTimestampKey, getMonotonicMs } from "./timeUtils.js";

  const sessions = new Map([
      ["a", { createdAt: getMonotonicMs() - 10000 }],
      ["b", { createdAt: getMonotonicMs() - 5000 }]
  ]);

  const oldestKey = findOldestTimestampKey(sessions);
  console.log("Oldest session:", oldestKey); // "a"
  ```
