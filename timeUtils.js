/**
 * @file timeUtils.js
 * Centralized date, time, duration, and streak calculation utilities powered by Luxon.
 */

import { DateTime } from "luxon";
import { performance } from "node:perf_hooks";

/**
 * 5 hours in milliseconds.
 * Used as the primary window to evaluate whether a broadcast is a continuation or a new session.
 * @type {number}
 */
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

/**
 * 10 minutes in milliseconds.
 * Used for authorization state expiration and general short cleanup windows.
 * @type {number}
 */
export const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * Format string for quotes: 24-hour UTC ISO format with seconds.
 * Example output: "2026-10-09 12:30:45".
 * @type {string}
 */
export const QUOTE_DATE_FORMAT = "yyyy-MM-dd HH:mm:ss";

/**
 * Parses an ISO-8601 date string into a Luxon DateTime instance in UTC.
 * Returns null if the input is null, undefined, unparseable, or invalid.
 *
 * @param {string|null|undefined} isoString - ISO formatted date string.
 * @returns {DateTime|null} Valid Luxon DateTime in UTC, or null.
 */
export function parseIsoDateTime(isoString) {
    if (typeof isoString !== "string" || !isoString.trim()) {
        return null;
    }
    const parsed = DateTime.fromISO(isoString.trim(), { zone: "utc" });
    return parsed.isValid ? parsed : null;
}

/**
 * Returns a standard ISO-8601 UTC string for storage or API responses.
 *
 * @param {DateTime|null|undefined} [dateTime] - Optional DateTime instance. Defaults to current time.
 * @returns {string} ISO-8601 UTC string (e.g. "2026-10-09T08:00:00.000Z").
 */
export function getUtcNowIsoString(dateTime = null) {
    if (dateTime instanceof DateTime && dateTime.isValid) {
        return dateTime.toUTC().toISO();
    }
    return DateTime.now().toUTC().toISO();
}

/**
 * Formats a timestamp for quote records and chat displays using UTC 24-hour ISO format with seconds.
 * Resolves legacy 12-hour AM/PM rollover bugs (such as noon formatting as 12:00 AM).
 *
 * @param {DateTime|string|null|undefined} [dateTime] - Optional DateTime or ISO string. Defaults to now.
 * @returns {string} Formatted string in "yyyy-MM-dd HH:mm:ss" UTC.
 */
export function formatQuoteTimestamp(dateTime = null) {
    let resolvedDateTime;
    if (typeof dateTime === "string") {
        resolvedDateTime = parseIsoDateTime(dateTime);
    } else if (dateTime instanceof DateTime && dateTime.isValid) {
        resolvedDateTime = dateTime;
    }

    if (!resolvedDateTime || !resolvedDateTime.isValid) {
        resolvedDateTime = DateTime.now();
    }

    return resolvedDateTime.toUTC().toFormat(QUOTE_DATE_FORMAT);
}

/**
 * Validates whether the duration between earlierTime and laterTime falls strictly within
 * [0, maxDurationMs). Rejects negative durations (clock skew or out-of-order events)
 * and durations exceeding the allowed window.
 *
 * @param {DateTime|null|undefined} earlierTime - Starting boundary.
 * @param {DateTime|null|undefined} laterTime - Ending boundary.
 * @param {number} maxDurationMs - Maximum allowed non-negative duration in milliseconds.
 * @returns {boolean} True if 0 <= (laterTime - earlierTime) < maxDurationMs.
 */
export function isWithinRestartWindow(earlierTime, laterTime, maxDurationMs) {
    if (!earlierTime || !earlierTime.isValid || !laterTime || !laterTime.isValid) {
        return false;
    }
    if (typeof maxDurationMs !== "number" || isNaN(maxDurationMs) || maxDurationMs <= 0) {
        return false;
    }
    const elapsedMs = laterTime.diff(earlierTime).as("milliseconds");
    return elapsedMs >= 0 && elapsedMs < maxDurationMs;
}

/**
 * Divides a duration or count safely, protecting against zero, negative, or NaN divisors.
 *
 * @param {number} numerator - Dividend value.
 * @param {number} divisor - Divisor value.
 * @param {number} [fallback=0] - Safe fallback value when divisor is invalid or <= 0.
 * @returns {number} Calculated quotient or fallback.
 */
export function safeDivideDuration(numerator, divisor, fallback = 0) {
    if (typeof divisor !== "number" || isNaN(divisor) || divisor <= 0) {
        return fallback;
    }
    if (typeof numerator !== "number" || isNaN(numerator)) {
        return fallback;
    }
    return numerator / divisor;
}

/**
 * Advances an index by 1 modulo collectionLength safely.
 * Returns 0 if collectionLength is 0, negative, or not a number.
 *
 * @param {number} currentIndex - Current integer index.
 * @param {number} collectionLength - Length of collection to rotate through.
 * @returns {number} Next 0-based index.
 */
export function safeRotateIndex(currentIndex, collectionLength) {
    if (typeof collectionLength !== "number" || isNaN(collectionLength) || collectionLength <= 0) {
        return 0;
    }
    if (typeof currentIndex !== "number" || isNaN(currentIndex) || currentIndex < 0) {
        return 0;
    }
    return (currentIndex + 1) % collectionLength;
}

/**
 * Primary fallback streamer IANA timezone.
 * While all storage and APIs use UTC, attendance days are anchored to US/Pacific by default.
 * @type {string}
 */
export const DEFAULT_STREAMER_TIMEZONE = "America/Los_Angeles";

let activeStreamerTimezone = DEFAULT_STREAMER_TIMEZONE;

/**
 * Normalizes and validates a timezone identifier or UTC offset into a recognized Luxon zone.
 * Supports IANA names (e.g. "America/Los_Angeles", "Asia/Tokyo"), full offsets (e.g. "UTC+2", "UTC-5", "+05:00"),
 * bare offsets (e.g. "+5", "-8"), and GMT aliases (e.g. "GMT+2", "GMT-5").
 *
 * @param {string|null|undefined} timezone - Timezone string or offset to normalize.
 * @returns {string|null} Canonical timezone string recognized by Luxon, or null if invalid.
 */
export function normalizeTimezone(timezone) {
    if (typeof timezone !== "string") {
        return null;
    }
    const trimmed = timezone.trim();
    if (!trimmed) {
        return null;
    }
    // Case 1: UTC prefix with offset (e.g. UTC+2, utc-5, UTC+05:00)
    const utcMatch = trimmed.match(/^UTC([+-].*)$/i);
    if (utcMatch) {
        const candidate = `UTC${utcMatch[1]}`;
        if (DateTime.now().setZone(candidate).isValid) {
            return candidate;
        }
    }
    // Case 2: GMT alias with offset (e.g. GMT+2, GMT-05:00)
    const gmtMatch = trimmed.match(/^GMT([+-].*)$/i);
    if (gmtMatch) {
        const candidate = `UTC${gmtMatch[1]}`;
        if (DateTime.now().setZone(candidate).isValid) {
            return candidate;
        }
    }
    // Case 3: Bare offset (e.g. +5, -8, +5:30)
    if (/^[+-]/.test(trimmed)) {
        const candidate = `UTC${trimmed}`;
        if (DateTime.now().setZone(candidate).isValid) {
            return candidate;
        }
    }
    // Case 4: Directly recognized by Luxon (IANA zones, UTC, +05:00, etc.)
    if (DateTime.now().setZone(trimmed).isValid) {
        return trimmed;
    }
    return null;
}

/**
 * Validates whether a given timezone string or offset is recognized.
 *
 * @param {string|null|undefined} timezone - Timezone string or offset to validate.
 * @returns {boolean} True if timezone or offset is valid.
 */
export function isValidTimezone(timezone) {
    return normalizeTimezone(timezone) !== null;
}

/**
 * Retrieves the currently active streamer timezone.
 *
 * @returns {string} Active IANA timezone string or normalized offset.
 */
export function getStreamerTimezone() {
    return activeStreamerTimezone;
}

/**
 * Returns the current formatted UTC offset string (e.g. "UTC-7", "UTC+9", "UTC+5:30")
 * for the active streamer timezone, masking geographic location or region names.
 *
 * @param {DateTime} [referenceDateTime] - Reference time. Defaults to now.
 * @param {string|null} [zone] - Streamer IANA timezone or offset. Defaults to getStreamerTimezone().
 * @returns {string} Formatted UTC offset string (e.g. "UTC-7").
 */
export function getStreamerUtcOffset(referenceDateTime = DateTime.now(), zone = null) {
    const validDateTime = (referenceDateTime instanceof DateTime && referenceDateTime.isValid)
        ? referenceDateTime
        : DateTime.now();
    const effectiveZone = (typeof zone === "string" && normalizeTimezone(zone))
        ? normalizeTimezone(zone)
        : getStreamerTimezone();
    const localStreamerTime = validDateTime.setZone(effectiveZone);
    const offsetStr = localStreamerTime.toFormat("Z");
    return `UTC${offsetStr}`;
}

/**
 * Returns the current ISO 8601 formatted date and time string
 * for the active streamer timezone.
 *
 * @param {DateTime} [referenceDateTime] - Reference time. Defaults to now.
 * @param {string|null} [zone] - Streamer IANA timezone or offset. Defaults to getStreamerTimezone().
 * @returns {string} ISO 8601 formatted string with timezone offset (e.g. "2026-10-10T12:00:00.000-07:00").
 */
export function getStreamerIsoString(referenceDateTime = DateTime.now(), zone = null) {
    const validDateTime = (referenceDateTime instanceof DateTime && referenceDateTime.isValid)
        ? referenceDateTime
        : DateTime.now();
    const effectiveZone = (typeof zone === "string" && normalizeTimezone(zone))
        ? normalizeTimezone(zone)
        : getStreamerTimezone();
    const localStreamerTime = validDateTime.setZone(effectiveZone);
    return localStreamerTime.toISO();
}

/**
 * Updates the active streamer timezone dynamically at runtime (for example, if the broadcaster
 * travels to a different region or changes location mid-stream / after stream start).
 *
 * @param {string} newTimezone - Valid IANA timezone identifier or UTC offset (e.g. "+5", "UTC+2", "America/New_York").
 * @returns {boolean} True if updated successfully, false if the timezone string was invalid.
 */
export function setStreamerTimezone(newTimezone) {
    const normalizedZone = normalizeTimezone(newTimezone);
    if (!normalizedZone) {
        console.warn(`[Time] Attempted to set invalid timezone "${newTimezone}". Retaining current timezone "${activeStreamerTimezone}".`);
        return false;
    }
    activeStreamerTimezone = normalizedZone;
    console.info(`[Time] Streamer timezone updated to "${activeStreamerTimezone}".`);
    return true;
}

/**
 * Resets the active streamer timezone back to default or process.env.STREAMER_TIMEZONE.
 */
export function resetStreamerTimezone() {
    const configuredZone = process.env.STREAMER_TIMEZONE;
    const normalizedZone = configuredZone ? normalizeTimezone(configuredZone) : null;
    activeStreamerTimezone = normalizedZone || DEFAULT_STREAMER_TIMEZONE;
}

/**
 * Calculates the daily streak reset cutoff point at 06:00:00 local time in the active
 * streamer timezone for the broadcast day corresponding to referenceDateTime.
 * If referenceDateTime is before 06:00 local time, the active broadcast day began at 06:00
 * on the previous calendar day.
 *
 * @param {DateTime} [referenceDateTime] - Reference time. Defaults to now.
 * @param {string|null} [zone] - Streamer IANA timezone or offset. Defaults to getStreamerTimezone().
 * @returns {DateTime} Cutoff point at 06:00:00 local time converted to UTC.
 */
export function getDailyResetCutoffTime(referenceDateTime = DateTime.now(), zone = null) {
    const validDateTime = (referenceDateTime instanceof DateTime && referenceDateTime.isValid)
        ? referenceDateTime
        : DateTime.now();
    const effectiveZone = (typeof zone === "string" && normalizeTimezone(zone))
        ? normalizeTimezone(zone)
        : getStreamerTimezone();
    const localStreamerTime = validDateTime.setZone(effectiveZone);
    const broadcastDayDate = localStreamerTime.hour < 6
        ? localStreamerTime.minus({ days: 1 })
        : localStreamerTime;
    return broadcastDayDate
        .set({ hour: 6, minute: 0, second: 0, millisecond: 0 })
        .toUTC();
}

/**
 * Determines whether the active stream constitutes a new stream attendance session.
 *
 * @param {DateTime} activeStreamStartTime - Start time of the active broadcast.
 * @param {DateTime|null} previousStreamStartTime - Start time of the previous broadcast.
 * @param {DateTime|null} [previousStreamEndTime] - End time of the previous broadcast (if recorded).
 * @param {DateTime|null} [dailyResetCutoff] - Daily reset point if previous stream end is missing.
 * @param {string|null} [zone] - Streamer IANA timezone or offset. Defaults to getStreamerTimezone().
 * @returns {boolean} True if a new session threshold has been crossed.
 */
export function isNewStreamAttendanceSession(
    activeStreamStartTime,
    previousStreamStartTime,
    previousStreamEndTime = null,
    dailyResetCutoff = null,
    zone = null
) {
    if (!activeStreamStartTime || !activeStreamStartTime.isValid) {
        return false;
    }

    const effectiveZone = (typeof zone === "string" && normalizeTimezone(zone))
        ? normalizeTimezone(zone)
        : getStreamerTimezone();

    // Path A: Previous stream end is known
    // Elapsed time (streamGapMs) is calculated in UTC and is immune to timezone changes.
    if (previousStreamEndTime && previousStreamEndTime.isValid) {
        const streamGapMs = activeStreamStartTime.diff(previousStreamEndTime).as("milliseconds");
        return streamGapMs >= 0 && streamGapMs > FIVE_HOURS_MS;
    }

    // Path B: Fallback to Pacific/custom 6:00 AM daily reset cutoff
    if (previousStreamStartTime && previousStreamStartTime.isValid) {
        const effectiveResetCutoff = (dailyResetCutoff instanceof DateTime && dailyResetCutoff.isValid)
            ? dailyResetCutoff
            : getDailyResetCutoffTime(activeStreamStartTime, effectiveZone);
        return previousStreamStartTime < effectiveResetCutoff && activeStreamStartTime >= effectiveResetCutoff;
    }

    return false;
}

/**
 * Progression result for a viewer streak check.
 * @typedef {Object} UserStreakProgressionResult
 * @property {number} streak - Updated streak count.
 * @property {number} bestStreak - Updated maximum streak count achieved.
 * @property {string} lastUpdated - UTC ISO timestamp string of progression check.
 * @property {"started"|"incremented"|"restarted"|"current"} status - Progression status.
 */

/**
 * Pure evaluation function for calculating viewer attendance streak progression.
 *
 * @param {Object|null|undefined} userInfo - Existing user record in streaks database.
 * @param {DateTime|null|undefined} activeStreamStartTime - Start time of current stream.
 * @param {DateTime|null|undefined} previousStreamStartTime - Start time of previous stream.
 * @param {boolean} isNewSession - Whether the current stream is a new session.
 * @param {DateTime} [executionTime] - Optional reference time for lastUpdated. Defaults to now.
 * @returns {UserStreakProgressionResult} Evaluated progression result.
 */
export function calculateUserStreakProgression(
    userInfo,
    activeStreamStartTime,
    previousStreamStartTime,
    isNewSession,
    executionTime = DateTime.now()
) {
    const validExecutionTime = (executionTime instanceof DateTime && executionTime.isValid)
        ? executionTime
        : DateTime.now();
    const nowIso = getUtcNowIsoString(validExecutionTime);

    // Case 1: First-time viewer
    if (!userInfo) {
        return {
            streak: 1,
            bestStreak: 1,
            lastUpdated: nowIso,
            status: "started"
        };
    }

    const currentStreak = typeof userInfo.Streak === "number" && userInfo.Streak > 0 ? userInfo.Streak : 1;
    const currentBest = typeof userInfo.Best_Streak === "number" && userInfo.Best_Streak >= currentStreak
        ? userInfo.Best_Streak
        : currentStreak;

    // Case 2: Stream is not a new attendance session (same session or restart)
    if (!isNewSession) {
        return {
            streak: currentStreak,
            bestStreak: currentBest,
            lastUpdated: userInfo.Last_Updated || nowIso,
            status: "current"
        };
    }

    const lastUpdatedDateTime = parseIsoDateTime(userInfo.Last_Updated);

    // Case 3: Corrupt or missing Last_Updated timestamp recovers cleanly
    if (!lastUpdatedDateTime) {
        return {
            streak: 1,
            bestStreak: currentBest,
            lastUpdated: nowIso,
            status: "restarted"
        };
    }

    // Case 4: Already streaked in current stream session
    if (activeStreamStartTime && activeStreamStartTime.isValid && lastUpdatedDateTime >= activeStreamStartTime) {
        return {
            streak: currentStreak,
            bestStreak: currentBest,
            lastUpdated: userInfo.Last_Updated,
            status: "current"
        };
    }

    // Case 5: Viewer watched previous stream: streak continues
    if (
        previousStreamStartTime &&
        previousStreamStartTime.isValid &&
        activeStreamStartTime &&
        activeStreamStartTime.isValid &&
        lastUpdatedDateTime > previousStreamStartTime &&
        lastUpdatedDateTime < activeStreamStartTime
    ) {
        const nextStreak = currentStreak + 1;
        const nextBest = Math.max(currentBest, nextStreak);
        return {
            streak: nextStreak,
            bestStreak: nextBest,
            lastUpdated: nowIso,
            status: "incremented"
        };
    }

    // Case 6: Viewer missed previous stream: streak resets
    return {
        streak: 1,
        bestStreak: currentBest,
        lastUpdated: nowIso,
        status: "restarted"
    };
}

/**
 * Finds the key associated with the oldest createdAt timestamp in a Map.
 * Used for LRU/FIFO eviction of active auth sessions.
 *
 * @param {Map<string, {createdAt: number}>} mapWithCreatedAt - Map of items containing numeric createdAt.
 * @returns {string|null} Key of oldest item, or null if map is empty/invalid.
 */
export function findOldestTimestampKey(mapWithCreatedAt) {
    if (!mapWithCreatedAt || typeof mapWithCreatedAt.entries !== "function") {
        return null;
    }
    let oldestKey = null;
    let oldestTimestamp = Infinity;
    for (const [key, item] of mapWithCreatedAt.entries()) {
        if (item && typeof item.createdAt === "number" && item.createdAt < oldestTimestamp) {
            oldestTimestamp = item.createdAt;
            oldestKey = key;
        }
    }
    return oldestKey;
}

/**
 * Asynchronously pauses execution for the specified duration.
 *
 * @param {number} ms - Milliseconds to delay.
 * @returns {Promise<void>} Resolves after delay.
 */
export function delayMilliseconds(ms) {
    const validMs = (typeof ms === "number" && !isNaN(ms) && ms > 0) ? ms : 0;
    return new Promise(resolve => setTimeout(resolve, validMs));
}

/**
 * Session-bound cache for tracking which user IDs have streaked in the active stream session.
 * Prevents memory leaks and eliminates reliance on unmanaged global state.
 */
export class StreamAttendanceSessionTracker {
    constructor() {
        this.activeSessionStartIso = null;
        this.streakedUserIds = new Set();
    }

    /**
     * Synchronizes cache against current stream start timestamp.
     * Clears tracked IDs if the stream start has changed.
     *
     * @param {string|null} streamStartIso - Start timestamp of current stream.
     */
    synchronizeSession(streamStartIso) {
        const normalizedStart = typeof streamStartIso === "string" ? streamStartIso.trim() : null;
        if (this.activeSessionStartIso !== normalizedStart) {
            this.activeSessionStartIso = normalizedStart;
            this.streakedUserIds.clear();
        }
    }

    /**
     * Checks whether the user has already streaked in the active stream session.
     *
     * @param {string} userId - Twitch user ID.
     * @returns {boolean} True if user has streaked in active session.
     */
    hasStreaked(userId) {
        return this.streakedUserIds.has(String(userId));
    }

    /**
     * Marks the user as having streaked in the active stream session.
     *
     * @param {string} userId - Twitch user ID.
     */
    markStreaked(userId) {
        this.streakedUserIds.add(String(userId));
    }

    /**
     * Manually resets all tracked users.
     */
    clear() {
        this.streakedUserIds.clear();
    }
}

/**
 * Returns the current time in monotonic milliseconds using performance.timeOrigin + performance.now().
 * Provides high-precision time that is monotonically non-decreasing and immune to system wall-clock steps.
 *
 * @returns {number} Monotonic time in milliseconds on the epoch scale.
 */
export function getMonotonicMs() {
    return performance.timeOrigin + performance.now();
}

/**
 * Schedules a recurring task with event-loop drift compensation.
 *
 * @param {Function} callback - Function to execute periodically.
 * @param {number} intervalMs - Recurrence interval in milliseconds.
 * @param {Object} [options={}] - Scheduling options.
 * @param {Function} [options.nowFn=getMonotonicMs] - Monotonic clock function.
 * @returns {{ clear: Function, unref: Function }} Handle to clear or unref the timer.
 */
export function scheduleCompensatedInterval(callback, intervalMs, options = {}) {
    const validInterval = (typeof intervalMs === "number" && !isNaN(intervalMs) && intervalMs > 0)
        ? intervalMs
        : 1000;
    const nowFn = options.nowFn || getMonotonicMs;
    let expected = nowFn() + validInterval;
    let timer = null;
    let cleared = false;

    function step() {
        if (cleared) return;
        const drift = nowFn() - expected;
        try {
            callback();
        } catch (err) {
            console.error("[Timer] Error in compensated interval callback:", err);
        }
        expected += validInterval;
        const nextDelay = Math.max(0, validInterval - drift);
        timer = setTimeout(step, nextDelay);
    }

    timer = setTimeout(step, validInterval);

    return {
        clear: () => {
            cleared = true;
            if (timer) clearTimeout(timer);
        },
        unref: () => {
            if (timer && typeof timer.unref === "function") timer.unref();
        }
    };
}
