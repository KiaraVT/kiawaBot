import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
    getStreamerTimezone,
    setStreamerTimezone,
    resetStreamerTimezone,
    normalizeTimezone,
    isValidTimezone,
    getDailyResetCutoffTime,
    isNewStreamAttendanceSession,
    calculateUserStreakProgression,
    StreamAttendanceSessionTracker,
    safeRotateIndex
} from "../../timeUtils.js";

test("Timezone - normalizeTimezone handles bare offsets, GMT aliases, and IANA identifiers", () => {
    assert.equal(normalizeTimezone("America/Chicago"), "America/Chicago");
    assert.equal(normalizeTimezone("Asia/Tokyo"), "Asia/Tokyo");
    assert.equal(normalizeTimezone("UTC"), "UTC");
    assert.equal(normalizeTimezone("UTC+2"), "UTC+2");
    assert.equal(normalizeTimezone("utc-5"), "UTC-5");
    assert.equal(normalizeTimezone("+5"), "UTC+5");
    assert.equal(normalizeTimezone("-8"), "UTC-8");
    assert.equal(normalizeTimezone("+05:00"), "UTC+05:00");
    assert.equal(normalizeTimezone("GMT+2"), "UTC+2");
    assert.equal(normalizeTimezone("gmt-7"), "UTC-7");
    assert.equal(normalizeTimezone("Invalid/Zone_12345"), null);
    assert.equal(normalizeTimezone(""), null);
    assert.equal(normalizeTimezone(null), null);
});

test("Timezone - isValidTimezone validates supported formats correctly", () => {
    assert.equal(isValidTimezone("America/Los_Angeles"), true);
    assert.equal(isValidTimezone("+5"), true);
    assert.equal(isValidTimezone("-8"), true);
    assert.equal(isValidTimezone("GMT+3"), true);
    assert.equal(isValidTimezone("UTC+1"), true);
    assert.equal(isValidTimezone("Mars/Base_Alpha"), false);
});

test("Timezone - dynamic timezone change adjusts daily reset cutoff time", () => {
    resetStreamerTimezone();
    assert.equal(getStreamerTimezone(), "America/Los_Angeles");

    // Reference time: 2026-10-10 12:00:00 UTC
    const refUtc = DateTime.fromISO("2026-10-10T12:00:00.000Z", { zone: "utc" });

    // In America/Los_Angeles (UTC-7 in Oct / PDT): 12:00 UTC is 05:00 PDT.
    // Since 05:00 < 06:00, the broadcast day cutoff is yesterday's 06:00 PDT -> 2026-10-09 13:00:00 UTC.
    const cutoffPacific = getDailyResetCutoffTime(refUtc, "America/Los_Angeles");
    assert.equal(cutoffPacific.toISO(), "2026-10-09T13:00:00.000Z");

    // Broadcaster travels to Tokyo (Asia/Tokyo, UTC+9)
    setStreamerTimezone("Asia/Tokyo");
    assert.equal(getStreamerTimezone(), "Asia/Tokyo");

    // In Asia/Tokyo: 12:00 UTC is 21:00 Tokyo.
    // Since 21:00 >= 06:00, broadcast day cutoff is today's 06:00 Tokyo -> 2026-10-10 06:00 Tokyo = 2026-10-09 21:00:00 UTC.
    const cutoffTokyo = getDailyResetCutoffTime(refUtc, getStreamerTimezone());
    assert.equal(cutoffTokyo.toISO(), "2026-10-09T21:00:00.000Z");

    // Broadcaster switches to bare offset +2
    setStreamerTimezone("+2");
    assert.equal(getStreamerTimezone(), "UTC+2");

    resetStreamerTimezone();
});

test("Timezone - invalid timezone input does not change current active timezone", () => {
    resetStreamerTimezone();
    const initialZone = getStreamerTimezone();

    const success = setStreamerTimezone("TotallyBogusTimezone/Unknown");
    assert.equal(success, false);
    assert.equal(getStreamerTimezone(), initialZone);
});

test("Streaks - StreamAttendanceSessionTracker isolates session and handles clears", () => {
    const tracker = new StreamAttendanceSessionTracker();

    tracker.synchronizeSession("2026-10-10T10:00:00.000Z");
    assert.equal(tracker.hasStreaked("user123"), false);

    tracker.markStreaked("user123");
    assert.equal(tracker.hasStreaked("user123"), true);
    assert.equal(tracker.hasStreaked("user456"), false);

    // Same stream start does not clear tracked users
    tracker.synchronizeSession("2026-10-10T10:00:00.000Z");
    assert.equal(tracker.hasStreaked("user123"), true);

    // New stream start clears tracked users
    tracker.synchronizeSession("2026-10-11T10:00:00.000Z");
    assert.equal(tracker.hasStreaked("user123"), false);

    // Manual clear resets tracked users
    tracker.markStreaked("user789");
    assert.equal(tracker.hasStreaked("user789"), true);
    tracker.clear();
    assert.equal(tracker.hasStreaked("user789"), false);
});

test("Streaks - isNewStreamAttendanceSession correctly handles stream gaps and daily reset cutoffs", () => {
    const start1 = DateTime.fromISO("2026-10-09T18:00:00.000Z", { zone: "utc" });
    const end1 = DateTime.fromISO("2026-10-09T22:00:00.000Z", { zone: "utc" });

    // Stream restarted 1 hour after end: within 5h window -> not a new session
    const restartWithinWindow = DateTime.fromISO("2026-10-09T23:00:00.000Z", { zone: "utc" });
    assert.equal(isNewStreamAttendanceSession(restartWithinWindow, start1, end1), false);

    // Stream started 6 hours after end: exceeds 5h window -> new session
    const nextSession = DateTime.fromISO("2026-10-10T05:00:00.000Z", { zone: "utc" });
    assert.equal(isNewStreamAttendanceSession(nextSession, start1, end1), true);

    // Missing end time falls back to daily reset cutoff
    // Stream 1: 2026-10-09 10:00 UTC (03:00 PDT, so broadcast day of Oct 8)
    // Stream 2: 2026-10-09 20:00 UTC (13:00 PDT, crossing the 06:00 PDT cutoff)
    const streamBeforeCutoff = DateTime.fromISO("2026-10-09T10:00:00.000Z", { zone: "utc" });
    const streamAfterCutoff = DateTime.fromISO("2026-10-09T20:00:00.000Z", { zone: "utc" });
    assert.equal(isNewStreamAttendanceSession(streamAfterCutoff, streamBeforeCutoff, null, null, "America/Los_Angeles"), true);
});

test("Streaks - calculateUserStreakProgression correctly increments, preserves, and recovers streaks", () => {
    const stream1 = DateTime.fromISO("2026-10-08T18:00:00.000Z", { zone: "utc" });
    const stream2 = DateTime.fromISO("2026-10-09T18:00:00.000Z", { zone: "utc" });

    // First-time user
    const firstResult = calculateUserStreakProgression(null, stream1, null, true);
    assert.equal(firstResult.streak, 1);
    assert.equal(firstResult.bestStreak, 1);
    assert.equal(firstResult.status, "started");

    // Returning user who watched stream 1, now watching stream 2 (new session)
    const existingUser = {
        Streak: 5,
        Best_Streak: 10,
        Last_Updated: "2026-10-08T19:00:00.000Z"
    };
    const incrementResult = calculateUserStreakProgression(existingUser, stream2, stream1, true);
    assert.equal(incrementResult.streak, 6);
    assert.equal(incrementResult.bestStreak, 10);
    assert.equal(incrementResult.status, "incremented");

    // User missed stream 1 (last watched long ago) -> streak restarts at 1
    const missedUser = {
        Streak: 12,
        Best_Streak: 15,
        Last_Updated: "2026-10-01T19:00:00.000Z"
    };
    const restartResult = calculateUserStreakProgression(missedUser, stream2, stream1, true);
    assert.equal(restartResult.streak, 1);
    assert.equal(restartResult.bestStreak, 15);
    assert.equal(restartResult.status, "restarted");

    // Same stream session (re-check) -> streak unchanged
    const sameSessionResult = calculateUserStreakProgression(existingUser, stream2, stream1, false);
    assert.equal(sameSessionResult.streak, 5);
    assert.equal(sameSessionResult.status, "current");

    // Corrupt date recovers safely
    const corruptUser = {
        Streak: 8,
        Best_Streak: 8,
        Last_Updated: "NOT_A_DATE"
    };
    const corruptRecovery = calculateUserStreakProgression(corruptUser, stream2, stream1, true);
    assert.equal(corruptRecovery.streak, 1);
    assert.equal(corruptRecovery.bestStreak, 8);
    assert.equal(corruptRecovery.status, "restarted");
});

test("Rotation - safeRotateIndex protects against empty collections and wraps properly", () => {
    assert.equal(safeRotateIndex(0, 3), 1);
    assert.equal(safeRotateIndex(1, 3), 2);
    assert.equal(safeRotateIndex(2, 3), 0);
    assert.equal(safeRotateIndex(0, 0), 0);
    assert.equal(safeRotateIndex(5, -1), 0);
    assert.equal(safeRotateIndex(0, NaN), 0);
});

test("Kiara_bot - exports streamAttendanceTracker, updateStreaks, handleTimedCommandsInterval, messageHandler", async () => {
    const kiaraBot = await import("../../Kiara_bot.js");
    assert.ok(kiaraBot.streamAttendanceTracker);
    assert.equal(typeof kiaraBot.updateStreaks, "function");
    assert.equal(typeof kiaraBot.handleTimedCommandsInterval, "function");
    assert.equal(typeof kiaraBot.messageHandler, "function");
});
