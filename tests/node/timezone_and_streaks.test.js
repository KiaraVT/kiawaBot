import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
    getStreamerTimezone,
    setStreamerTimezone,
    resetStreamerTimezone,
    getDailyResetCutoffTime,
    StreamAttendanceSessionTracker,
    normalizeTimezone,
    isValidTimezone
} from "../../timeUtils.js";
import {
    streamAttendanceTracker,
    handleTimedCommandsInterval,
    updateStreaks
} from "../../Kiara_bot.js";

test("timezone_and_streaks - dynamic broadcaster timezone shifts daily reset cutoff", () => {
    resetStreamerTimezone();
    assert.equal(getStreamerTimezone(), "America/Los_Angeles");

    // Reference time: Friday 2026-10-09 at 15:00 UTC (08:00 AM PDT)
    const refUtc = DateTime.fromISO("2026-10-09T15:00:00Z");

    // In America/Los_Angeles (UTC-7 PDT), 06:00 AM is 13:00 UTC
    const pacificCutoff = getDailyResetCutoffTime(refUtc, "America/Los_Angeles");
    assert.equal(pacificCutoff.toISO(), "2026-10-09T13:00:00.000Z");

    // Broadcaster updates timezone to Tokyo (+9) after stream start:
    const updateSuccess = setStreamerTimezone("Asia/Tokyo");
    assert.equal(updateSuccess, true);
    assert.equal(getStreamerTimezone(), "Asia/Tokyo");

    // In Asia/Tokyo (+9), 15:00 UTC on Oct 9 is 00:00 AM (midnight) Oct 10.
    // Since 00:00 is before 06:00 AM local time, the active broadcast day began at 06:00 AM on Oct 9 local time,
    // which corresponds to 2026-10-08T21:00:00Z in UTC.
    const tokyoCutoff = getDailyResetCutoffTime(refUtc);
    assert.equal(tokyoCutoff.toISO(), "2026-10-08T21:00:00.000Z");

    // Broadcaster updates timezone via UTC offset "+2" (or "UTC+2")
    assert.equal(setStreamerTimezone("+2"), true);
    assert.equal(getStreamerTimezone(), "UTC+2");

    // In UTC+2, 15:00 UTC is 17:00 local time (past 06:00 AM).
    // Cutoff is 06:00 local on Oct 9, which is 04:00 UTC.
    const offsetCutoff = getDailyResetCutoffTime(refUtc);
    assert.equal(offsetCutoff.toISO(), "2026-10-09T04:00:00.000Z");

    // Reset back
    resetStreamerTimezone();
    assert.equal(getStreamerTimezone(), "America/Los_Angeles");
});

test("timezone_and_streaks - broadcaster offset formats normalize reliably", () => {
    assert.equal(normalizeTimezone("+5"), "UTC+5");
    assert.equal(normalizeTimezone("-8"), "UTC-8");
    assert.equal(normalizeTimezone("+05:00"), "UTC+05:00");
    assert.equal(normalizeTimezone("-08:00"), "UTC-08:00");
    assert.equal(normalizeTimezone("GMT+2"), "UTC+2");
    assert.equal(normalizeTimezone("gmt-5"), "UTC-5");
    assert.equal(normalizeTimezone("UTC+3"), "UTC+3");
    assert.equal(normalizeTimezone("America/Chicago"), "America/Chicago");

    // Invalid zones rejected
    assert.equal(isValidTimezone("Atlantis/Ocean"), false);
    assert.equal(isValidTimezone("invalid-offset-123"), false);
});

test("timezone_and_streaks - Kiara_bot exports and StreamAttendanceSessionTracker integration", () => {
    assert.ok(streamAttendanceTracker instanceof StreamAttendanceSessionTracker);
    assert.equal(typeof handleTimedCommandsInterval, "function");
    assert.equal(typeof updateStreaks, "function");

    // Verify session tracker prevents duplicate streak within same stream session
    streamAttendanceTracker.synchronizeSession("2026-10-09T18:00:00Z");
    assert.equal(streamAttendanceTracker.hasStreaked("user-999"), false);

    streamAttendanceTracker.markStreaked("user-999");
    assert.equal(streamAttendanceTracker.hasStreaked("user-999"), true);

    // Same session does not clear
    streamAttendanceTracker.synchronizeSession("2026-10-09T18:00:00Z");
    assert.equal(streamAttendanceTracker.hasStreaked("user-999"), true);

    // New stream start clears session cache
    streamAttendanceTracker.synchronizeSession("2026-10-10T18:00:00Z");
    assert.equal(streamAttendanceTracker.hasStreaked("user-999"), false);
});
