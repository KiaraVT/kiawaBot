/**
 * @file timeUtils.js
 * Centralized date, time, duration, and streak calculation utilities powered by Luxon.
 */

import { DateTime, Duration } from "luxon";

/**
 * Standard duration window (5 hours) for considering stream restarts or gaps.
 * @type {number}
 */
export const FIVE_HOURS_MS = Duration.fromObject({ hours: 5 }).as("milliseconds");

/**
 * Standard token expiration check window (10 minutes).
 * @type {number}
 */
export const TEN_MINUTES_MS = Duration.fromObject({ minutes: 10 }).as("milliseconds");

/**
 * Display format for quote creation timestamps using ISO 24-hour display with seconds.
 * @type {string}
 */
export const QUOTE_TIMESTAMP_FORMAT = "yyyy-MM-dd HH:mm:ss";

/**
 * Safely parses an ISO-8601 string into a Luxon DateTime instance.
 *
 * @param {string|null|undefined} isoString - ISO formatted date string.
 * @returns {DateTime|null} Valid DateTime instance, or null if invalid or missing.
 */
export function parseIsoDateTime(isoString) {
    if (typeof isoString !== "string" || !isoString.trim()) {
        return null;
    }
    try {
        const parsedDateTime = DateTime.fromISO(isoString);
        return parsedDateTime.isValid ? parsedDateTime : null;
    } catch (parseError) {
        console.error(`[Time] Failed to parse ISO timestamp "${isoString}":`, parseError?.message || parseError);
        return null;
    }
}

/**
 * Formats a DateTime instance (or current time) as a standardized UTC ISO-8601 string.
 *
 * @param {DateTime} [targetDateTime] - Target DateTime instance. Defaults to current execution time.
 * @returns {string} ISO-8601 UTC string.
 */
export function getUtcNowIsoString(targetDateTime = DateTime.now()) {
    const validDateTime = (targetDateTime instanceof DateTime && targetDateTime.isValid)
        ? targetDateTime
        : DateTime.now();
    return validDateTime.toUTC().toISO();
}

/**
 * Formats a DateTime instance into the standard quote timestamp ISO 24-hour format with seconds (yyyy-MM-dd HH:mm:ss).
 *
 * @param {DateTime} [targetDateTime] - Target DateTime instance. Defaults to current execution time.
 * @returns {string} Formatted quote timestamp string.
 */
export function formatQuoteTimestamp(targetDateTime = DateTime.now()) {
    const validDateTime = (targetDateTime instanceof DateTime && targetDateTime.isValid)
        ? targetDateTime
        : DateTime.now();
    return validDateTime.toUTC().toFormat(QUOTE_TIMESTAMP_FORMAT);
}

/**
 * Checks whether the elapsed time between earlierTime and laterTime falls strictly
 * within the non-negative duration window [0, windowDurationMs).
 * Rejects negative intervals (clock skew or out-of-order timestamps).
 *
 * @param {DateTime|null} earlierTime - Starting reference time.
 * @param {DateTime|null} laterTime - Subsequent reference time.
 * @param {number} windowDurationMs - Positive window duration in milliseconds.
 * @returns {boolean} True if laterTime occurred between earlierTime and earlierTime + windowDurationMs.
 */
export function isWithinRestartWindow(earlierTime, laterTime, windowDurationMs) {
    if (!earlierTime || !laterTime || !(earlierTime instanceof DateTime) || !(laterTime instanceof DateTime)) {
        return false;
    }
    if (!earlierTime.isValid || !laterTime.isValid) {
        return false;
    }
    const elapsedMilliseconds = laterTime.diff(earlierTime).as("milliseconds");
    return elapsedMilliseconds >= 0 && elapsedMilliseconds < windowDurationMs;
}

/**
 * Divides numeratorMs by divisorMs safely, ensuring the divisor is positive and non-zero.
 * Prevents division-by-zero crashes, NaN, and Infinity.
 *
 * @param {number} numeratorMs - Value to divide.
 * @param {number} divisorMs - Divisor value.
 * @param {number} [fallbackValue=0] - Return value if divisor is invalid.
 * @returns {number} Result of division, or fallbackValue if divisor is invalid.
 */
export function safeDivideDuration(numeratorMs, divisorMs, fallbackValue = 0) {
    if (typeof divisorMs !== "number" || isNaN(divisorMs) || divisorMs <= 0) {
        return fallbackValue;
    }
    if (typeof numeratorMs !== "number" || isNaN(numeratorMs)) {
        return fallbackValue;
    }
    return numeratorMs / divisorMs;
}

/**
 * Computes the next index in a cyclic array rotation safely.
 * Prevents modulo-by-zero or NaN when the collection is empty.
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

let activeStreamerTimezone = (process.env.STREAMER_TIMEZONE && normalizeTimezone(process.env.STREAMER_TIMEZONE))
    || DEFAULT_STREAMER_TIMEZONE;

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
 * @param {string|null} [zone] - Streamer IANA timezone. Defaults to getStreamerTimezone().
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
 * @param {string|null} [zone] - Streamer IANA timezone. Defaults to getStreamerTimezone().
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
 * @typedef {object} UserStreakProgressionResult
 * @property {number} streak - Updated streak count.
 * @property {number} bestStreak - Updated maximum streak count.
 * @property {string} lastUpdated - ISO-8601 UTC timestamp of update.
 * @property {"started"|"incremented"|"restarted"|"current"} status - Progression status.
 */

/**
 * Computes updated attendance streak metrics for a viewer.
 *
 * @param {object|null|undefined} currentUserRecord - Existing user entry from streaks.json.
 * @param {DateTime} activeStreamStartTime - Start time of current broadcast.
 * @param {DateTime|null} previousStreamStartTime - Start time of previous broadcast.
 * @param {boolean} isNewStreamSession - Whether a new session has started.
 * @param {DateTime} [currentExecutionTime] - Current execution timestamp.
 * @returns {UserStreakProgressionResult} Progression metrics.
 */
export function calculateUserStreakProgression(
    currentUserRecord,
    activeStreamStartTime,
    previousStreamStartTime,
    isNewStreamSession,
    currentExecutionTime = DateTime.now()
) {
    const executionIso = getUtcNowIsoString(currentExecutionTime);

    // Initializer for first-time viewers
    if (!currentUserRecord || typeof currentUserRecord !== "object") {
        return {
            streak: 1,
            bestStreak: 1,
            lastUpdated: executionIso,
            status: "started"
        };
    }

    const currentStreak = Number(currentUserRecord.Streak) || 1;
    const currentBest = Number(currentUserRecord.Best_Streak) || currentStreak;

    if (!isNewStreamSession) {
        return {
            streak: currentStreak,
            bestStreak: currentBest,
            lastUpdated: currentUserRecord.Last_Updated || executionIso,
            status: "current"
        };
    }

    const lastRecordedTime = parseIsoDateTime(currentUserRecord.Last_Updated);

    // Alive streak: user attended previous stream
    if (
        lastRecordedTime &&
        previousStreamStartTime &&
        previousStreamStartTime.isValid &&
        lastRecordedTime > previousStreamStartTime &&
        lastRecordedTime < activeStreamStartTime
    ) {
        const nextStreak = currentStreak + 1;
        const nextBest = Math.max(currentBest, nextStreak);
        return {
            streak: nextStreak,
            bestStreak: nextBest,
            lastUpdated: executionIso,
            status: "incremented"
        };
    }

    // Dead streak or uninitialized/corrupt date: reset to 1
    if (!lastRecordedTime || (previousStreamStartTime && lastRecordedTime < previousStreamStartTime)) {
        return {
            streak: 1,
            bestStreak: currentBest,
            lastUpdated: executionIso,
            status: "restarted"
        };
    }

    // Already streaked during current stream session
    return {
        streak: currentStreak,
        bestStreak: currentBest,
        lastUpdated: currentUserRecord.Last_Updated,
        status: "current"
    };
}

/**
 * Finds the key associated with the oldest createdAt timestamp in a Map.
 *
 * @param {Map<string, { createdAt: number }>|null|undefined} entriesMap
 * @returns {string|null} Key of oldest entry, or null if map is empty.
 */
export function findOldestTimestampKey(entriesMap) {
    if (!entriesMap || typeof entriesMap.entries !== "function") {
        return null;
    }
    let oldestKey = null;
    let oldestTimestamp = Infinity;
    for (const [key, value] of entriesMap.entries()) {
        const entryCreatedAt = value?.createdAt;
        if (typeof entryCreatedAt === "number" && entryCreatedAt < oldestTimestamp) {
            oldestTimestamp = entryCreatedAt;
            oldestKey = key;
        }
    }
    return oldestKey;
}

/**
 * Asynchronously pauses execution for a specified number of milliseconds.
 *
 * @param {number} delayMillisecondsCount - Milliseconds to delay.
 * @returns {Promise<void>}
 */
export function delayMilliseconds(delayMillisecondsCount) {
    const safeDelay = Math.max(0, Number(delayMillisecondsCount) || 0);
    return new Promise(resolve => setTimeout(resolve, safeDelay));
}

/**
 * Session-bound cache of viewer IDs who have already recorded attendance for the active stream.
 * Automatically invalidates and resets when a new stream start timestamp is observed.
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
