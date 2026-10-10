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
    getStreamerUtcOffset,
    getStreamerIsoString,
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
});

test("timeUtils - getUtcNowIsoString produces standard ISO-8601 UTC strings", () => {
    const nowIso = getUtcNowIsoString();
    assert.ok(nowIso.endsWith("Z"), "Must end with Z indicating UTC");
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(nowIso), "Must match standard ISO format");

    const fixed = DateTime.fromISO("2026-10-09T12:00:00Z");
    assert.equal(getUtcNowIsoString(fixed), "2026-10-09T12:00:00.000Z");
});

test("timeUtils - formatQuoteTimestamp formats in UTC ISO 24h format with seconds (yyyy-MM-dd HH:mm:ss)", () => {
    // Noon case: 12:00 PM must not roll over to AM
    const noon = DateTime.fromISO("2026-10-09T12:30:45Z");
    assert.equal(formatQuoteTimestamp(noon), "2026-10-09 12:30:45");

    // Midnight case: 00:15:30
    const midnight = DateTime.fromISO("2026-10-09T00:15:30Z");
    assert.equal(formatQuoteTimestamp(midnight), "2026-10-09 00:15:30");

    // Evening 24h case: 21:05:09
    const evening = DateTime.fromISO("2026-10-09T21:05:09Z");
    assert.equal(formatQuoteTimestamp(evening), "2026-10-09 21:05:09");

    // Accepts ISO string
    assert.equal(formatQuoteTimestamp("2026-10-09T15:20:10Z"), "2026-10-09 15:20:10");

    // Fallback on invalid inputs returns valid format
    const fallback = formatQuoteTimestamp("invalid-date");
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fallback));
});

test("timeUtils - isWithinRestartWindow validates positive range and rejects negative/inverted diffs", () => {
    const t1 = DateTime.fromISO("2026-10-09T10:00:00Z");
    const t2 = DateTime.fromISO("2026-10-09T12:00:00Z"); // 2 hours later
    const t3 = DateTime.fromISO("2026-10-09T16:00:00Z"); // 6 hours after t1

    // 2 hours is within 5-hour window
    assert.equal(isWithinRestartWindow(t1, t2, FIVE_HOURS_MS), true);

    // 6 hours exceeds 5-hour window
    assert.equal(isWithinRestartWindow(t1, t3, FIVE_HOURS_MS), false);

    // Inverted times (t2 is before t1 if reversed): negative difference must be rejected
    assert.equal(isWithinRestartWindow(t2, t1, FIVE_HOURS_MS), false, "Negative delta must reject");

    // Invalid parameters
    assert.equal(isWithinRestartWindow(null, t2, FIVE_HOURS_MS), false);
    assert.equal(isWithinRestartWindow(t1, null, FIVE_HOURS_MS), false);
    assert.equal(isWithinRestartWindow(t1, t2, 0), false);
    assert.equal(isWithinRestartWindow(t1, t2, -1000), false);
});

test("timeUtils - safeDivideDuration guards against division by zero, NaN, and negative divisors", () => {
    assert.equal(safeDivideDuration(100, 2), 50);
    assert.equal(safeDivideDuration(100, 0), 0);
    assert.equal(safeDivideDuration(100, -5), 0);
    assert.equal(safeDivideDuration(100, NaN), 0);
    assert.equal(safeDivideDuration(NaN, 5), 0);
    assert.equal(safeDivideDuration(100, 0, 99), 99);
});

test("timeUtils - safeRotateIndex prevents modulo by zero on empty collections", () => {
    assert.equal(safeRotateIndex(0, 3), 1);
    assert.equal(safeRotateIndex(1, 3), 2);
    assert.equal(safeRotateIndex(2, 3), 0);

    // Empty collection guards
    assert.equal(safeRotateIndex(0, 0), 0);
    assert.equal(safeRotateIndex(5, 0), 0);
    assert.equal(safeRotateIndex(0, -1), 0);
    assert.equal(safeRotateIndex(0, NaN), 0);
    assert.equal(safeRotateIndex(-1, 3), 0);
});

test("timeUtils - getDailyResetCutoffTime computes 06:00 Pacific (America/Los_Angeles) cutoff", () => {
    // Friday afternoon: 2026-10-09 at 15:00 UTC (8:00 AM PDT)
    const afternoonUtc = DateTime.fromISO("2026-10-09T15:00:00Z");
    const cutoffAfternoon = getDailyResetCutoffTime(afternoonUtc, "America/Los_Angeles");
    // 06:00 AM PDT on Oct 9 is 13:00 UTC on Oct 9
    assert.equal(cutoffAfternoon.toISO(), "2026-10-09T13:00:00.000Z");

    // Late night / early morning: Saturday 2026-10-10 at 09:00 UTC (02:00 AM PDT on Oct 10)
    // Broadcast day began at 06:00 AM PDT on Friday Oct 9:
    const earlyMorningUtc = DateTime.fromISO("2026-10-10T09:00:00Z");
    const cutoffEarlyMorning = getDailyResetCutoffTime(earlyMorningUtc, "America/Los_Angeles");
    assert.equal(cutoffEarlyMorning.toISO(), "2026-10-09T13:00:00.000Z");
});

test("timeUtils - isNewStreamAttendanceSession evaluates stream gap and Pacific broadcast days correctly", () => {
    // Path A: Previous stream End is recorded
    const prevEnd = DateTime.fromISO("2026-10-09T04:00:00Z");
    // 6 hours later: new session
    const currentStartLongGap = DateTime.fromISO("2026-10-09T10:00:00Z");
    assert.equal(isNewStreamAttendanceSession(currentStartLongGap, null, prevEnd), true);

    // 2 hours later: continuation / restart within 5h window
    const currentStartShortGap = DateTime.fromISO("2026-10-09T06:00:00Z");
    assert.equal(isNewStreamAttendanceSession(currentStartShortGap, null, prevEnd), false);

    // Path B: Previous stream End is missing, evaluate by Pacific 6:00 AM reset
    // Stream 1: Friday 05:00 AM PDT (before 06:00 AM cutoff)
    const fridayEarlyMorning = DateTime.fromISO("2026-10-09T05:00:00", { zone: "America/Los_Angeles" }).toUTC();
    // Stream 2: Friday 07:00 PM PDT (after 06:00 AM cutoff of Friday broadcast day)
    const fridayEvening = DateTime.fromISO("2026-10-09T19:00:00", { zone: "America/Los_Angeles" }).toUTC();
    assert.equal(isNewStreamAttendanceSession(fridayEvening, fridayEarlyMorning, null), true);

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

test("timeUtils - getStreamerUtcOffset formats UTC offset cleanly and masks location", () => {
    const octTime = DateTime.fromISO("2026-10-10T12:00:00Z");
    const janTime = DateTime.fromISO("2026-01-15T12:00:00Z");

    assert.equal(getStreamerUtcOffset(octTime, "America/Los_Angeles"), "UTC-7");
    assert.equal(getStreamerUtcOffset(janTime, "America/Los_Angeles"), "UTC-8");
    assert.equal(getStreamerUtcOffset(octTime, "Asia/Tokyo"), "UTC+9");
    assert.equal(getStreamerUtcOffset(octTime, "Asia/Kolkata"), "UTC+5:30");
    assert.equal(getStreamerUtcOffset(octTime, "UTC"), "UTC+0");

    resetStreamerTimezone();
    setStreamerTimezone("+5");
    assert.equal(getStreamerUtcOffset(), "UTC+5");

    setStreamerTimezone("-4");
    assert.equal(getStreamerUtcOffset(), "UTC-4");

    resetStreamerTimezone();
});

test("timeUtils - getStreamerIsoString formats date and time in ISO format for streamer zone", () => {
    const fixedTime = DateTime.fromISO("2026-10-10T12:00:00.000Z");

    assert.equal(getStreamerIsoString(fixedTime, "America/Los_Angeles"), "2026-10-10T05:00:00.000-07:00");
    assert.equal(getStreamerIsoString(fixedTime, "Asia/Tokyo"), "2026-10-10T21:00:00.000+09:00");
    assert.equal(getStreamerIsoString(fixedTime, "UTC"), "2026-10-10T12:00:00.000Z");

    resetStreamerTimezone();
    setStreamerTimezone("+5");
    assert.equal(getStreamerIsoString(fixedTime), "2026-10-10T17:00:00.000+05:00");

    resetStreamerTimezone();
    const currentIso = getStreamerIsoString();
    assert.ok(typeof currentIso === "string" && currentIso.length > 0);
    assert.ok(DateTime.fromISO(currentIso).isValid);
});
