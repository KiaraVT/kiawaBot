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

test("Security - messageHandler cleanly separates !timezone (display only) and !settimezone (update)", async () => {
    const { messageHandler } = await import("../../Kiara_bot.js");
    resetStreamerTimezone();
    assert.equal(getStreamerTimezone(), "America/Los_Angeles");

    // Non-broadcaster chatter with moderator or VIP badge attempting !settimezone
    await messageHandler({
        chatter_user_id: "12345",
        chatter_user_name: "synthetic_test_chatter",
        chatter_user_login: "synthetic_test_chatter",
        message: { text: "!settimezone Asia/Tokyo" },
        badges: [{ set_id: "moderator", id: "1" }]
    });
    assert.equal(getStreamerTimezone(), "America/Los_Angeles", "Moderator must not be able to change timezone");

    // Non-broadcaster chatter attempting !timezone
    await messageHandler({
        chatter_user_id: "12345",
        chatter_user_name: "synthetic_test_chatter",
        chatter_user_login: "synthetic_test_chatter",
        message: { text: "!timezone" },
        badges: [{ set_id: "vip", id: "1" }]
    });
    assert.equal(getStreamerTimezone(), "America/Los_Angeles", "VIP must not be able to trigger timezone command");

    // Legitimate broadcaster with broadcaster badge calling !timezone (must NOT change timezone)
    await messageHandler({
        chatter_user_id: "99999",
        chatter_user_name: "Kiara",
        chatter_user_login: "kiaravt",
        message: { text: "!timezone Europe/London" },
        badges: [{ set_id: "broadcaster", id: "1" }]
    });
    assert.equal(getStreamerTimezone(), "America/Los_Angeles", "!timezone must be display-only and never modify timezone");

    // Legitimate broadcaster with broadcaster badge calling !settimezone (DOES change timezone)
    await messageHandler({
        chatter_user_id: "99999",
        chatter_user_name: "Kiara",
        chatter_user_login: "kiaravt",
        message: { text: "!settimezone Asia/Tokyo" },
        badges: [{ set_id: "broadcaster", id: "1" }]
    });
    assert.equal(getStreamerTimezone(), "Asia/Tokyo", "Broadcaster calling !settimezone must update timezone");

    resetStreamerTimezone();
});

test("Streaks - midstream timezone shift advancing date preserves active and next streaks", () => {
    resetStreamerTimezone();
    setStreamerTimezone("America/Los_Angeles");

    // Stream 1 starts Friday 22:00 PDT = Saturday 05:00 UTC
    const s1Start = DateTime.fromISO("2026-10-10T05:00:00.000Z");
    const prevStart = s1Start.minus({ days: 1 });
    const prevEnd = prevStart.plus({ hours: 4 });

    let alice = {
        User_Name: "synthetic_viewer_alice",
        Streak: 5,
        Best_Streak: 5,
        Last_Updated: prevStart.plus({ hours: 1 }).toISO()
    };

    const tracker = new StreamAttendanceSessionTracker();
    tracker.synchronizeSession(s1Start.toISO());

    // Stream 1 check-in before timezone change
    const isNew1 = isNewStreamAttendanceSession(s1Start, prevStart, prevEnd);
    assert.equal(isNew1, true);

    const checkin1 = calculateUserStreakProgression(alice, s1Start, prevStart, isNew1, s1Start.plus({ minutes: 30 }));
    assert.equal(checkin1.streak, 6);
    assert.equal(checkin1.status, "incremented");

    alice.Streak = checkin1.streak;
    alice.Best_Streak = checkin1.bestStreak;
    alice.Last_Updated = checkin1.lastUpdated;
    tracker.markStreaked("synthetic_viewer_alice");

    // Midstream: Broadcaster changes timezone to Tokyo (UTC+9), advancing local date to Saturday afternoon
    setStreamerTimezone("Asia/Tokyo");
    assert.equal(getStreamerTimezone(), "Asia/Tokyo");

    // Alice chats again after the timezone change: must remain current at streak 6
    const isNew1Post = isNewStreamAttendanceSession(s1Start, prevStart, prevEnd);
    const checkin1Again = calculateUserStreakProgression(alice, s1Start, prevStart, isNew1Post, s1Start.plus({ hours: 1 }));
    assert.equal(checkin1Again.streak, 6, "Streak must not be degraded on repeated messages after timezone change");
    assert.equal(checkin1Again.status, "current");

    // Stream 1 ends at 09:00 UTC; Stream 2 starts Sunday 03:00 UTC (18h gap > 5h)
    const s1End = s1Start.plus({ hours: 4 });
    const s2Start = s1End.plus({ hours: 18 });
    tracker.synchronizeSession(s2Start.toISO());

    const isNew2 = isNewStreamAttendanceSession(s2Start, s1Start, s1End);
    assert.equal(isNew2, true);

    // Alice checks in during Stream 2: streak must increment to 7
    const checkin2 = calculateUserStreakProgression(alice, s2Start, s1Start, isNew2, s2Start.plus({ minutes: 30 }));
    assert.equal(checkin2.streak, 7, "Streak must advance normally on next stream following midstream timezone change");
    assert.equal(checkin2.status, "incremented");

    resetStreamerTimezone();
});

test("Streaks - midstream timezone shift retreating date preserves active and next streaks", () => {
    resetStreamerTimezone();
    setStreamerTimezone("Asia/Tokyo");

    // Stream 1 starts Saturday 11:00 JST = Saturday 02:00 UTC
    const s1Start = DateTime.fromISO("2026-10-10T02:00:00.000Z");
    const prevStart = s1Start.minus({ days: 1 });
    const prevEnd = prevStart.plus({ hours: 4 });

    let charlie = {
        User_Name: "synthetic_viewer_charlie",
        Streak: 8,
        Best_Streak: 8,
        Last_Updated: prevStart.plus({ hours: 1 }).toISO()
    };

    const isNew1 = isNewStreamAttendanceSession(s1Start, prevStart, prevEnd);
    assert.equal(isNew1, true);

    const checkin1 = calculateUserStreakProgression(charlie, s1Start, prevStart, isNew1, s1Start.plus({ minutes: 30 }));
    assert.equal(checkin1.streak, 9);
    assert.equal(checkin1.status, "incremented");

    charlie.Streak = checkin1.streak;
    charlie.Best_Streak = checkin1.bestStreak;
    charlie.Last_Updated = checkin1.lastUpdated;

    // Midstream: Broadcaster changes timezone to Honolulu (UTC-10), moving local date backward to Friday afternoon
    setStreamerTimezone("Pacific/Honolulu");
    assert.equal(getStreamerTimezone(), "Pacific/Honolulu");

    // Charlie chats again in same stream: must stay at streak 9
    const checkin1Again = calculateUserStreakProgression(charlie, s1Start, prevStart, isNew1, s1Start.plus({ hours: 1 }));
    assert.equal(checkin1Again.streak, 9, "Streak must not decrement when local date shifts backward");
    assert.equal(checkin1Again.status, "current");

    // Stream 1 ends at 06:00 UTC; Stream 2 starts Sunday 00:00 UTC (Saturday 14:00 HST)
    const s1End = s1Start.plus({ hours: 4 });
    const s2Start = s1End.plus({ hours: 18 });

    const isNew2 = isNewStreamAttendanceSession(s2Start, s1Start, s1End);
    assert.equal(isNew2, true);

    const checkin2 = calculateUserStreakProgression(charlie, s2Start, s1Start, isNew2, s2Start.plus({ minutes: 30 }));
    assert.equal(checkin2.streak, 10, "Streak must increment normally on subsequent broadcast");
    assert.equal(checkin2.status, "incremented");

    resetStreamerTimezone();
});

test("Streaks - midstream traversal across International Date Line preserves streak progression", () => {
    resetStreamerTimezone();

    // Part A: Westbound across Date Line (Honolulu UTC-10 to Auckland UTC+13, skipping local calendar date)
    setStreamerTimezone("Pacific/Honolulu");
    const s1Start = DateTime.fromISO("2026-10-10T06:00:00.000Z");
    const s1End = DateTime.fromISO("2026-10-10T10:00:00.000Z");

    let dana = {
        User_Name: "synthetic_viewer_dana",
        Streak: 12,
        Best_Streak: 12,
        Last_Updated: "2026-10-09T06:30:00.000Z"
    };

    const isNewA1 = isNewStreamAttendanceSession(s1Start, s1Start.minus({ days: 1 }), s1Start.minus({ days: 1, hours: 20 }));
    const checkinA1 = calculateUserStreakProgression(dana, s1Start, s1Start.minus({ days: 1 }), isNewA1, s1Start.plus({ minutes: 15 }));
    assert.equal(checkinA1.streak, 13);
    assert.equal(checkinA1.status, "incremented");

    dana.Streak = checkinA1.streak;
    dana.Best_Streak = checkinA1.bestStreak;
    dana.Last_Updated = checkinA1.lastUpdated;

    // Broadcaster updates timezone to Auckland (local date skips ahead)
    setStreamerTimezone("Pacific/Auckland");
    assert.equal(getStreamerTimezone(), "Pacific/Auckland");

    const s2Start = s1End.plus({ hours: 16 });
    const isNewA2 = isNewStreamAttendanceSession(s2Start, s1Start, s1End);
    assert.equal(isNewA2, true, "16-hour gap must be recognized as new session across Date Line");

    const checkinA2 = calculateUserStreakProgression(dana, s2Start, s1Start, isNewA2, s2Start.plus({ minutes: 30 }));
    assert.equal(checkinA2.streak, 14, "Streak must increment across Date Line skip");
    assert.equal(checkinA2.status, "incremented");

    // Part B: Eastbound across Date Line (Auckland UTC+13 to Honolulu UTC-10, repeating local calendar date)
    const s3Start = DateTime.fromISO("2026-10-15T01:00:00.000Z");
    const s3End = DateTime.fromISO("2026-10-15T05:00:00.000Z");
    const s3PrevStart = s3Start.minus({ days: 1 });

    let evan = {
        User_Name: "synthetic_viewer_evan",
        Streak: 20,
        Best_Streak: 20,
        Last_Updated: s3PrevStart.plus({ hours: 1 }).toISO()
    };

    setStreamerTimezone("Pacific/Auckland");

    const checkinB1 = calculateUserStreakProgression(evan, s3Start, s3PrevStart, true, s3Start.plus({ minutes: 15 }));
    assert.equal(checkinB1.streak, 21);
    evan.Streak = checkinB1.streak;
    evan.Best_Streak = checkinB1.bestStreak;
    evan.Last_Updated = checkinB1.lastUpdated;

    // Midstream shift to Honolulu (local date repeats)
    setStreamerTimezone("Pacific/Honolulu");
    assert.equal(getStreamerTimezone(), "Pacific/Honolulu");

    const s4Start = s3End.plus({ hours: 19 });
    const isNewB2 = isNewStreamAttendanceSession(s4Start, s3Start, s3End);
    assert.equal(isNewB2, true, "19-hour gap must be recognized as new session on Date Line repeat");

    const checkinB2 = calculateUserStreakProgression(evan, s4Start, s3Start, isNewB2, s4Start.plus({ minutes: 30 }));
    assert.equal(checkinB2.streak, 22, "Streak must increment across Date Line repeat");
    assert.equal(checkinB2.status, "incremented");

    resetStreamerTimezone();
});

test("Streaks - midstream timezone shift crossing 06:00 daily cutoff does not downgrade streaked users", () => {
    resetStreamerTimezone();
    setStreamerTimezone("America/Los_Angeles");

    // Stream starts at 04:00 AM PDT (before 06:00 cutoff) = 11:00 UTC
    const s1Start = DateTime.fromISO("2026-10-10T11:00:00.000Z");
    const prevStart = s1Start.minus({ days: 1 });
    const prevEnd = prevStart.plus({ hours: 4 });

    let frank = {
        User_Name: "synthetic_viewer_frank",
        Streak: 3,
        Best_Streak: 3,
        Last_Updated: prevStart.plus({ hours: 1 }).toISO()
    };

    const isNew = isNewStreamAttendanceSession(s1Start, prevStart, prevEnd);
    const checkin1 = calculateUserStreakProgression(frank, s1Start, prevStart, isNew, s1Start.plus({ minutes: 30 }));
    assert.equal(checkin1.streak, 4);
    assert.equal(checkin1.status, "incremented");

    frank.Streak = checkin1.streak;
    frank.Best_Streak = checkin1.bestStreak;
    frank.Last_Updated = checkin1.lastUpdated;

    // Midstream: Broadcaster changes timezone to Chicago (UTC-5), shifting local time past 06:00 AM cutoff to 07:30 AM CDT
    setStreamerTimezone("America/Chicago");
    assert.equal(getStreamerTimezone(), "America/Chicago");

    // Frank chats again after the local cutoff shift: streak must stay current at 4
    const checkinAgain = calculateUserStreakProgression(frank, s1Start, prevStart, isNew, s1Start.plus({ hours: 1, minutes: 45 }));
    assert.equal(checkinAgain.streak, 4, "User must remain at incremented streak after local cutoff transition");
    assert.equal(checkinAgain.status, "current");

    resetStreamerTimezone();
});
