import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
    parseIsoDateTime,
    getUtcNowIsoString,
    formatQuoteTimestamp,
    isWithinRestartWindow,
    safeDivideDuration,
    safeRotateIndex,
    getDailyResetCutoffTime,
    isNewStreamAttendanceSession,
    calculateUserStreakProgression,
    findOldestTimestampKey,
    delayMilliseconds,
    StreamAttendanceSessionTracker,
    FIVE_HOURS_MS,
    normalizeTimezone,
    isValidTimezone,
    getStreamerTimezone,
    setStreamerTimezone,
    resetStreamerTimezone
} from "../../timeUtils.js";

test("timeUtils - parseIsoDateTime parses valid ISO-8601 strings and rejects invalid values", () => {
    const valid = parseIsoDateTime("2026-10-09T08:00:00Z");
    assert.ok(valid instanceof DateTime);
    assert.equal(valid.isValid, true);
    assert.equal(valid.year, 2026);

    assert.equal(parseIsoDateTime(null), null);
    assert.equal(parseIsoDateTime(undefined), null);
    assert.equal(parseIsoDateTime(""), null);
    assert.equal(parseIsoDateTime("not-a-date"), null);
    assert.equal(parseIsoDateTime(12345), null);
});

test("timeUtils - getUtcNowIsoString produces standard ISO-8601 UTC strings", () => {
    const dt = DateTime.fromISO("2026-10-09T14:30:00-05:00");
    const isoUtc = getUtcNowIsoString(dt);
    assert.equal(isoUtc, "2026-10-09T19:30:00.000Z");

    const nowIso = getUtcNowIsoString();
    assert.ok(nowIso.endsWith("Z"));
});

test("timeUtils - formatQuoteTimestamp formats in UTC ISO 24h format with seconds (yyyy-MM-dd HH:mm:ss)", () => {
    // Noon test (12:30:45 UTC)
    const noon = DateTime.fromObject({ year: 2026, month: 10, day: 9, hour: 12, minute: 30, second: 45 }, { zone: "utc" });
    assert.equal(formatQuoteTimestamp(noon), "2026-10-09 12:30:45");

    // Midnight test (00:05:01 UTC)
    const midnight = DateTime.fromObject({ year: 2026, month: 1, day: 5, hour: 0, minute: 5, second: 1 }, { zone: "utc" });
    assert.equal(formatQuoteTimestamp(midnight), "2026-01-05 00:05:01");

    // Morning test (09:07:00 UTC)
    const morning = DateTime.fromObject({ year: 2026, month: 3, day: 8, hour: 9, minute: 7, second: 0 }, { zone: "utc" });
    assert.equal(formatQuoteTimestamp(morning), "2026-03-08 09:07:00");

    // Evening test (21:45:59 UTC)
    const evening = DateTime.fromObject({ year: 2026, month: 11, day: 22, hour: 21, minute: 45, second: 59 }, { zone: "utc" });
    assert.equal(formatQuoteTimestamp(evening), "2026-11-22 21:45:59");

    // Ensure non-UTC input converts to UTC correctly (e.g. 14:30:00-05:00 -> 19:30:00 UTC)
    const offsetTime = DateTime.fromISO("2026-10-09T14:30:00-05:00");
    assert.equal(formatQuoteTimestamp(offsetTime), "2026-10-09 19:30:00");
});

test("timeUtils - isWithinRestartWindow validates positive range and rejects negative/inverted diffs", () => {
    const start = DateTime.fromISO("2026-10-09T10:00:00Z");
    const fourHoursLater = DateTime.fromISO("2026-10-09T14:00:00Z");
    const sixHoursLater = DateTime.fromISO("2026-10-09T16:00:00Z");
    const earlier = DateTime.fromISO("2026-10-09T08:00:00Z");

    // 4 hours is within 5-hour window
    assert.equal(isWithinRestartWindow(start, fourHoursLater, FIVE_HOURS_MS), true);

    // 6 hours is outside 5-hour window
    assert.equal(isWithinRestartWindow(start, sixHoursLater, FIVE_HOURS_MS), false);

    // Negative interval (laterTime < earlierTime) must be rejected, not treated as < 5h
    assert.equal(isWithinRestartWindow(start, earlier, FIVE_HOURS_MS), false);

    // Null/invalid parameters return false
    assert.equal(isWithinRestartWindow(null, fourHoursLater, FIVE_HOURS_MS), false);
    assert.equal(isWithinRestartWindow(start, null, FIVE_HOURS_MS), false);
});

test("timeUtils - safeDivideDuration guards against division by zero, NaN, and negative divisors", () => {
    assert.equal(safeDivideDuration(10000, 2000), 5);
    assert.equal(safeDivideDuration(10000, 0, 0), 0);
    assert.equal(safeDivideDuration(10000, -100, 0), 0);
    assert.equal(safeDivideDuration(10000, NaN, -1), -1);
    assert.equal(safeDivideDuration(10000, null, 0), 0);
    assert.equal(safeDivideDuration(10000, undefined, 0), 0);
});

test("timeUtils - safeRotateIndex prevents modulo by zero on empty collections", () => {
    assert.equal(safeRotateIndex(0, 5), 1);
    assert.equal(safeRotateIndex(4, 5), 0);
    assert.equal(safeRotateIndex(0, 0), 0);
    assert.equal(safeRotateIndex(3, -1), 0);
    assert.equal(safeRotateIndex(-1, 3), 0);
});

test("timeUtils - getDailyResetCutoffTime computes 06:00 Pacific (America/Los_Angeles) cutoff", () => {
    // Summer / Daylight Saving Time (PDT, UTC-7):
    const summerEvening = DateTime.fromISO("2026-10-10T20:00:00", { zone: "America/Los_Angeles" });
    const summerCutoff = getDailyResetCutoffTime(summerEvening);
    assert.equal(summerCutoff.setZone("America/Los_Angeles").hour, 6);
    assert.equal(summerCutoff.setZone("America/Los_Angeles").minute, 0);
    assert.equal(summerCutoff.toUTC().hour, 13); // 06:00 PDT is 13:00 UTC

    // Late night stream before 06:00 Pacific (e.g. 02:00 AM) belongs to prior day's broadcast:
    const lateNightStream = DateTime.fromISO("2026-10-11T02:00:00", { zone: "America/Los_Angeles" });
    const lateNightCutoff = getDailyResetCutoffTime(lateNightStream);
    assert.equal(lateNightCutoff.setZone("America/Los_Angeles").day, 10);
    assert.equal(lateNightCutoff.setZone("America/Los_Angeles").hour, 6);

    // Winter / Standard Time (PST, UTC-8):
    const winterEvening = DateTime.fromISO("2026-01-15T20:00:00", { zone: "America/Los_Angeles" });
    const winterCutoff = getDailyResetCutoffTime(winterEvening);
    assert.equal(winterCutoff.setZone("America/Los_Angeles").hour, 6);
    assert.equal(winterCutoff.toUTC().hour, 14); // 06:00 PST is 14:00 UTC
});

test("timeUtils - isNewStreamAttendanceSession evaluates stream gap and Pacific broadcast days correctly", () => {
    const prevStart = DateTime.fromISO("2026-10-08T10:00:00Z");
    const prevEnd = DateTime.fromISO("2026-10-08T14:00:00Z");
    const currentStartNewSession = DateTime.fromISO("2026-10-08T20:00:00Z"); // 6h later > 5h
    const currentStartQuickRestart = DateTime.fromISO("2026-10-08T16:00:00Z"); // 2h later < 5h

    // Path A: With valid end time:
    assert.equal(isNewStreamAttendanceSession(currentStartNewSession, prevStart, prevEnd), true);
    assert.equal(isNewStreamAttendanceSession(currentStartQuickRestart, prevStart, prevEnd), false);

    // Inverted times (currentStart < prevEnd):
    const invertedCurrent = DateTime.fromISO("2026-10-08T12:00:00Z");
    assert.equal(isNewStreamAttendanceSession(invertedCurrent, prevStart, prevEnd), false);

    // Path B: Missing end time -> evaluates America/Los_Angeles 06:00 AM broadcast days:
    // Streams on consecutive Pacific broadcast days (Thursday 20:00 PDT vs Friday 18:00 PDT):
    const thursdayEvening = DateTime.fromISO("2026-10-08T20:00:00", { zone: "America/Los_Angeles" }).toUTC();
    const fridayEvening = DateTime.fromISO("2026-10-09T18:00:00", { zone: "America/Los_Angeles" }).toUTC();
    assert.equal(isNewStreamAttendanceSession(fridayEvening, thursdayEvening, null), true);

    // Two streams on the same Pacific broadcast day (Friday 14:00 PDT vs Friday 21:00 PDT):
    const fridayAfternoon = DateTime.fromISO("2026-10-09T14:00:00", { zone: "America/Los_Angeles" }).toUTC();
    assert.equal(isNewStreamAttendanceSession(fridayEvening, fridayAfternoon, null), false);

    // Late night broadcast (Saturday 02:00 AM PDT) still belongs to Friday's broadcast day:
    const saturdayEarlyMorning = DateTime.fromISO("2026-10-10T02:00:00", { zone: "America/Los_Angeles" }).toUTC();
    assert.equal(isNewStreamAttendanceSession(saturdayEarlyMorning, fridayEvening, null), false);
});

test("timeUtils - calculateUserStreakProgression updates streak, resets on gap, and recovers corrupt dates", () => {
    const prevStart = DateTime.fromISO("2026-10-08T10:00:00Z");
    const currentStart = DateTime.fromISO("2026-10-09T18:00:00Z");
    const executionTime = DateTime.fromISO("2026-10-09T18:30:00Z");

    // Case 1: Uninitialized user
    const newUser = calculateUserStreakProgression(null, currentStart, prevStart, true, executionTime);
    assert.equal(newUser.streak, 1);
    assert.equal(newUser.bestStreak, 1);
    assert.equal(newUser.status, "started");
    assert.equal(newUser.lastUpdated, "2026-10-09T18:30:00.000Z");

    // Case 2: User attended previous stream (streak increment)
    const activeViewer = {
        Streak: 3,
        Best_Streak: 5,
        Last_Updated: "2026-10-08T12:00:00Z" // Between prevStart and currentStart
    };
    const incremented = calculateUserStreakProgression(activeViewer, currentStart, prevStart, true, executionTime);
    assert.equal(incremented.streak, 4);
    assert.equal(incremented.bestStreak, 5);
    assert.equal(incremented.status, "incremented");

    // Case 3: User attended previous stream and achieves new best streak
    const recordBreaker = {
        Streak: 5,
        Best_Streak: 5,
        Last_Updated: "2026-10-08T12:00:00Z"
    };
    const newRecord = calculateUserStreakProgression(recordBreaker, currentStart, prevStart, true, executionTime);
    assert.equal(newRecord.streak, 6);
    assert.equal(newRecord.bestStreak, 6);
    assert.equal(newRecord.status, "incremented");

    // Case 4: User missed previous stream (streak reset to 1)
    const missedViewer = {
        Streak: 10,
        Best_Streak: 12,
        Last_Updated: "2026-10-05T10:00:00Z" // Before prevStart
    };
    const reset = calculateUserStreakProgression(missedViewer, currentStart, prevStart, true, executionTime);
    assert.equal(reset.streak, 1);
    assert.equal(reset.bestStreak, 12);
    assert.equal(reset.status, "restarted");

    // Case 5: Corrupt / empty Last_Updated date recovers and resets streak to 1 without freezing
    const corruptViewer = {
        Streak: 4,
        Best_Streak: 4,
        Last_Updated: "" // Corrupt empty string
    };
    const recovered = calculateUserStreakProgression(corruptViewer, currentStart, prevStart, true, executionTime);
    assert.equal(recovered.streak, 1);
    assert.equal(recovered.status, "restarted");
    assert.equal(recovered.lastUpdated, "2026-10-09T18:30:00.000Z");

    // Case 6: Already streaked in current stream
    const alreadyStreaked = {
        Streak: 4,
        Best_Streak: 4,
        Last_Updated: "2026-10-09T18:15:00Z" // After currentStart
    };
    const unchanged = calculateUserStreakProgression(alreadyStreaked, currentStart, prevStart, true, executionTime);
    assert.equal(unchanged.streak, 4);
    assert.equal(unchanged.status, "current");

    // Case 7: Not a new session
    const sameSession = calculateUserStreakProgression(activeViewer, currentStart, prevStart, false, executionTime);
    assert.equal(sameSession.streak, 3);
    assert.equal(sameSession.status, "current");
});

test("timeUtils - findOldestTimestampKey identifies oldest record and returns null when empty", () => {
    const sessions = new Map();
    sessions.set("session-mid", { createdAt: 2000 });
    sessions.set("session-oldest", { createdAt: 1000 });
    sessions.set("session-newest", { createdAt: 3000 });

    assert.equal(findOldestTimestampKey(sessions), "session-oldest");
    assert.equal(findOldestTimestampKey(new Map()), null);
    assert.equal(findOldestTimestampKey(null), null);
});

test("timeUtils - delayMilliseconds resolves after sleep", async () => {
    const before = Date.now();
    await delayMilliseconds(15);
    const elapsed = Date.now() - before;
    assert.ok(elapsed >= 10, "Must delay execution");
});

test("timeUtils - StreamAttendanceSessionTracker synchronizes sessions and prevents memory leaks", () => {
    const tracker = new StreamAttendanceSessionTracker();

    tracker.synchronizeSession("2026-10-09T10:00:00Z");
    assert.equal(tracker.hasStreaked("user-1"), false);

    tracker.markStreaked("user-1");
    assert.equal(tracker.hasStreaked("user-1"), true);
    assert.equal(tracker.hasStreaked("user-2"), false);

    // New stream starts: cache automatically invalidates
    tracker.synchronizeSession("2026-10-10T10:00:00Z");
    assert.equal(tracker.hasStreaked("user-1"), false, "Cache must clear when stream session changes");
});

test("timeUtils - dynamic streamer timezone setting and validation", () => {
    // Validation:
    assert.equal(isValidTimezone("America/Los_Angeles"), true);
    assert.equal(isValidTimezone("Europe/London"), true);
    assert.equal(isValidTimezone("Asia/Tokyo"), true);
    assert.equal(isValidTimezone("Invalid/Timezone_Name"), false);
    assert.equal(isValidTimezone(""), false);
    assert.equal(isValidTimezone(null), false);

    // Dynamic update:
    const initialZone = getStreamerTimezone();
    const updated = setStreamerTimezone("Europe/Berlin");
    assert.equal(updated, true);
    assert.equal(getStreamerTimezone(), "Europe/Berlin");

    // Rejection of invalid timezone retains active timezone:
    const failedUpdate = setStreamerTimezone("Fake/Nowhere");
    assert.equal(failedUpdate, false);
    assert.equal(getStreamerTimezone(), "Europe/Berlin");

    // Reset:
    resetStreamerTimezone();
    assert.equal(getStreamerTimezone(), initialZone);
});

test("timeUtils - normalizeTimezone supports bare offsets, full offsets, and GMT aliases", () => {
    // Normalization of bare offsets (+5, -8, +5:30)
    assert.equal(normalizeTimezone("+5"), "UTC+5");
    assert.equal(normalizeTimezone("-8"), "UTC-8");
    assert.equal(normalizeTimezone("+5:30"), "UTC+5:30");
    assert.equal(normalizeTimezone("+05:00"), "UTC+05:00");
    assert.equal(normalizeTimezone("-08:00"), "UTC-08:00");

    // Normalization of UTC and GMT prefixes
    assert.equal(normalizeTimezone("UTC+2"), "UTC+2");
    assert.equal(normalizeTimezone("utc-5"), "UTC-5");
    assert.equal(normalizeTimezone("GMT+2"), "UTC+2");
    assert.equal(normalizeTimezone("gmt-7"), "UTC-7");

    // Standard IANA zones
    assert.equal(normalizeTimezone("America/Chicago"), "America/Chicago");
    assert.equal(normalizeTimezone("Asia/Tokyo"), "Asia/Tokyo");

    // Invalid inputs
    assert.equal(normalizeTimezone("not-a-zone"), null);
    assert.equal(normalizeTimezone(""), null);
    assert.equal(normalizeTimezone(null), null);
    assert.equal(normalizeTimezone(undefined), null);

    // Setting timezone with bare offset and GMT alias
    const initialZone = getStreamerTimezone();
    assert.equal(setStreamerTimezone("+5"), true);
    assert.equal(getStreamerTimezone(), "UTC+5");

    assert.equal(setStreamerTimezone("GMT+3"), true);
    assert.equal(getStreamerTimezone(), "UTC+3");

    // Reset back
    resetStreamerTimezone();
    assert.equal(getStreamerTimezone(), initialZone);
});

