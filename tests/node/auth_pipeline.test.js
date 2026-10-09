import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { formatAxiosError, redactSensitiveUrl } from "../../errorUtils.js";
import AuthDataHelper from "../../AuthDataHelper.js";
import {
    createSingleFlightMutex,
    executeWithBackoff,
    processStreamStartStreak,
    validateCommandArguments
} from "../../pipelineUtils.js";

test("formatAxiosError - formats standard AxiosError with response status and url", () => {
    const mockError = {
        message: "Request failed with status code 500",
        config: {
            method: "get",
            url: "https://api.twitch.tv/helix/streams?user_id=123"
        },
        response: {
            status: 500,
            statusText: "Internal Server Error",
            data: { message: "Internal server error on Twitch" }
        }
    };

    const formatted = formatAxiosError(mockError);
    assert.ok(formatted.includes("500 Internal Server Error"), "Should contain status and statusText");
    assert.ok(formatted.includes("GET https://api.twitch.tv/helix/streams?user_id=123"), "Should contain method and url");
    assert.ok(formatted.includes("Internal server error on Twitch"), "Should contain error message data");
    assert.equal(formatted.includes("[object Object]"), false, "Should not format as raw object");
});

test("formatAxiosError - redacts sensitive query parameters from URL", () => {
    const sensitiveError = {
        message: "Token exchange failed",
        config: {
            method: "post",
            url: "https://id.twitch.tv/oauth2/token?client_secret=secret123&code=authcode456&refresh_token=refresh789"
        },
        response: {
            status: 400,
            statusText: "Bad Request",
            data: { message: "Invalid authorization code" }
        }
    };

    const formatted = formatAxiosError(sensitiveError);
    assert.equal(formatted.includes("secret123"), false, "Must not leak client_secret");
    assert.equal(formatted.includes("authcode456"), false, "Must not leak authorization code");
    assert.equal(formatted.includes("refresh789"), false, "Must not leak refresh_token");
    assert.ok(formatted.includes("[REDACTED]"), "Should show [REDACTED]");
});

test("redactSensitiveUrl - handles relative and absolute urls", () => {
    assert.equal(redactSensitiveUrl(""), "");
    const redacted = redactSensitiveUrl("/oauth2/token?access_token=xyz&foo=bar");
    assert.ok(redacted.includes("access_token=[REDACTED]"));
    assert.ok(redacted.includes("foo=bar"));
});

test("redactSensitiveUrl - preserves non-oauth token parameters", () => {
    const url = "https://example.com/api?token=genericToken&custom_token=123&access_token=secretOAuth";
    const redacted = redactSensitiveUrl(url);
    assert.ok(redacted.includes("token=genericToken"), "Generic token param should not be redacted");
    assert.ok(redacted.includes("custom_token=123"), "Custom token param should not be redacted");
    assert.ok(redacted.includes("access_token=[REDACTED]"), "access_token must be redacted");
});

test("formatAxiosError - formats network error where response is undefined", () => {
    const networkError = {
        message: "connect ECONNREFUSED 127.0.0.1:3000",
        code: "ECONNREFUSED",
        config: {
            method: "post",
            url: "https://id.twitch.tv/oauth2/token"
        }
    };

    const formatted = formatAxiosError(networkError);
    assert.ok(formatted.includes("ECONNREFUSED"), "Should contain error code or message");
    assert.ok(formatted.includes("POST https://id.twitch.tv/oauth2/token"), "Should contain method and url");
    assert.ok(formatted.includes("no response"), "Should clearly indicate no response was received");
});

test("formatAxiosError - formats generic Error or string safely", () => {
    const genericError = new Error("Something broke");
    const formatted = formatAxiosError(genericError);
    assert.ok(formatted.includes("Something broke"));

    const stringError = formatAxiosError("simple string error");
    assert.ok(stringError.includes("simple string error"));

    const nullError = formatAxiosError(null);
    assert.ok(typeof nullError === "string" && nullError.length > 0);
});

test("Optional chaining safety - does not throw on non-Axios or null/undefined errors", () => {
    const errors = [
        new Error("Timeout"),
        { message: "socket hang up" },
        null,
        undefined
    ];

    for (const err of errors) {
        const status = err?.response?.status;
        assert.equal(status, undefined);
    }
});

test("AuthDataHelper - constructor initializes legacyPath and supports immediate persistence", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-test-"));
    const dataPath = path.join(tmpDir, "data", "auth-data.json");
    const helper = new AuthDataHelper();
    assert.equal(helper.legacyPath, "./auth-data.json", "legacyPath should default to ./auth-data.json");

    helper.dataPath = dataPath;
    helper.loadData();

    // Verify update with immediate = true writes to disk synchronously
    helper.update("twitchBroadcaster.access_token", "immediate_token_123", true, true);
    const contentOnDisk = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    assert.equal(contentOnDisk.twitchBroadcaster.access_token, "immediate_token_123");

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("AuthDataHelper - update warns on unknown top-level schema keys", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-test-warn-"));
    const dataPath = path.join(tmpDir, "auth.json");
    const helper = new AuthDataHelper();
    helper.dataPath = dataPath;
    helper.loadData();

    let warned = false;
    const origWarn = console.warn;
    console.warn = (msg) => {
        if (typeof msg === "string" && msg.includes("Updating unknown top-level key")) {
            warned = true;
        }
    };
    try {
        helper.update("unknownProvider.token", "xyz", true, true);
        assert.equal(warned, true, "Should log a warning for unknown top-level key");
    } finally {
        console.warn = origWarn;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("createSingleFlightMutex - deduplicates concurrent calls", async () => {
    const singleFlight = createSingleFlightMutex();
    let invocationCount = 0;

    const worker = () => {
        invocationCount += 1;
        return new Promise(resolve => setTimeout(() => resolve("done"), 20));
    };

    // Run 5 concurrent calls
    const results = await Promise.all([
        singleFlight(worker),
        singleFlight(worker),
        singleFlight(worker),
        singleFlight(worker),
        singleFlight(worker)
    ]);

    assert.equal(invocationCount, 1, "Underlying worker should only have executed once for concurrent requests");
    assert.deepEqual(results, ["done", "done", "done", "done", "done"]);

    // Subsequent call after settling executes again
    const subsequent = await singleFlight(worker);
    assert.equal(invocationCount, 2, "New call after settling should execute worker again");
    assert.equal(subsequent, "done");
});

test("createSingleFlightMutex - handles rejections and resets after microtask queue", async () => {
    const singleFlight = createSingleFlightMutex();
    let invocationCount = 0;

    const failingWorker = () => {
        invocationCount += 1;
        return Promise.reject(new Error("Worker failure"));
    };

    // Both concurrent callers receive rejection
    await assert.rejects(
        () => Promise.all([singleFlight(failingWorker), singleFlight(failingWorker)]),
        /Worker failure/
    );
    assert.equal(invocationCount, 1, "Failed worker should only run once for concurrent calls");

    // Wait for microtask queue to clear in-flight reference
    await new Promise(resolve => setTimeout(resolve, 10));

    const successWorker = () => {
        invocationCount += 1;
        return Promise.resolve("recovered");
    };
    const result = await singleFlight(successWorker);
    assert.equal(result, "recovered");
    assert.equal(invocationCount, 2, "Should allow new attempt after settlement");
});

test("executeWithBackoff - retries on transient errors and succeeds", async () => {
    let callCount = 0;
    const transientError = { response: { status: 503, statusText: "Service Unavailable" } };

    const operation = async () => {
        callCount += 1;
        if (callCount < 3) {
            throw transientError;
        }
        return "success";
    };

    const result = await executeWithBackoff(operation, {
        maxRetries: 3,
        baseDelayMs: 5
    });

    assert.equal(result, "success");
    assert.equal(callCount, 3);
});

test("executeWithBackoff - throws immediately on non-transient error (400/401)", async () => {
    let callCount = 0;
    const authError = { response: { status: 401, statusText: "Unauthorized" } };

    const operation = async () => {
        callCount += 1;
        throw authError;
    };

    await assert.rejects(
        () => executeWithBackoff(operation, { maxRetries: 3, baseDelayMs: 5 }),
        (err) => err?.response?.status === 401
    );
    assert.equal(callCount, 1, "Should not retry 401 non-transient error");
});

test("executeWithBackoff - throws after exhausting max retries", async () => {
    let callCount = 0;
    const transientError = { response: { status: 500 } };

    const operation = async () => {
        callCount += 1;
        throw transientError;
    };

    await assert.rejects(
        () => executeWithBackoff(operation, { maxRetries: 2, baseDelayMs: 5 }),
        (err) => err?.response?.status === 500
    );
    assert.equal(callCount, 3, "Initial attempt (0) + 2 retries = 3 total attempts");
});

test("processStreamStartStreak - handles missing or invalid dates safely", () => {
    const res1 = processStreamStartStreak("path.json", null);
    assert.equal(res1.updated, false);
    assert.equal(res1.reason, "missing_started_at");

    const res2 = processStreamStartStreak("path.json", "invalid-date-xyz");
    assert.equal(res2.updated, false);
    assert.equal(res2.reason, "invalid_started_at_date");
});

test("processStreamStartStreak - initializes new streak file when data is missing", () => {
    let written = null;
    const io = {
        readFn: () => null,
        writeFn: (_p, data) => { written = data; }
    };

    const res = processStreamStartStreak("path.json", "2026-10-09T08:00:00Z", io);
    assert.equal(res.updated, true);
    assert.equal(res.reason, "initialized_new_file");
    assert.equal(written.Current_Stream.Start, "2026-10-09T08:00:00Z");
    assert.equal(written.Last_Stream.Start, "2026-10-09T08:00:00Z");
});

test("processStreamStartStreak - prevents updates within 5-hour restart window", () => {
    const existing = {
        Current_Stream: { Start: "2026-10-09T08:00:00Z" },
        Last_Stream: { Start: "2026-10-08T08:00:00Z", End: "2026-10-08T12:00:00Z" }
    };
    const io = {
        readFn: () => existing,
        writeFn: () => { assert.fail("Should not write on restart within 5h"); }
    };

    // Stream start 1 hour later
    const res = processStreamStartStreak("path.json", "2026-10-09T09:00:00Z", io);
    assert.equal(res.updated, false);
    assert.equal(res.reason, "restarted_within_window");
});

test("processStreamStartStreak - performs standard update and resets streaked users", () => {
    let streakResetCalled = false;
    let writtenData = null;
    const existing = {
        Current_Stream: { Start: "2026-10-08T08:00:00Z" },
        Last_Stream: {
            Start: "2026-10-07T08:00:00Z",
            End: "2026-10-07T12:00:00Z",
            Backup_End: "2026-10-08T13:00:00Z"
        },
        Users: { user1: 5 }
    };
    const io = {
        readFn: () => existing,
        writeFn: (_p, data) => { writtenData = data; },
        onStreakReset: () => { streakResetCalled = true; }
    };

    // New stream start 24h later
    const res = processStreamStartStreak("path.json", "2026-10-09T18:00:00Z", io);
    assert.equal(res.updated, true);
    assert.equal(res.reason, "standard_update");
    assert.equal(streakResetCalled, true, "onStreakReset callback must be called");
    assert.equal(writtenData.Current_Stream.Start, "2026-10-09T18:00:00Z");
    assert.equal(writtenData.Last_Stream.Start, "2026-10-08T08:00:00Z");
});

test("validateCommandArguments - validates !addcommand and !editcommand", () => {
    assert.equal(validateCommandArguments("!addcommand", []).valid, false);
    assert.equal(validateCommandArguments("!addcommand", ["!addcommand"]).valid, false);
    assert.equal(validateCommandArguments("!addcommand", ["!addcommand", "hello"]).valid, false);

    const valid = validateCommandArguments("!addcommand", ["!addcommand", "!greet", "Hello", "world"]);
    assert.equal(valid.valid, true);
    assert.equal(valid.tag, "greet");
    assert.equal(valid.text, "Hello world");
});

test("validateCommandArguments - validates !updateincentive", () => {
    assert.equal(validateCommandArguments("!updateincentive", ["!updateincentive"]).valid, false);
    assert.equal(validateCommandArguments("!updateincentive", ["!updateincentive", "sub", "not_a_number"]).valid, false);
    assert.equal(validateCommandArguments("!updateincentive", ["!updateincentive", "sub", "-5"]).valid, false);

    const valid = validateCommandArguments("!updateincentive", ["!updateincentive", "goal", "100"]);
    assert.equal(valid.valid, true);
    assert.equal(valid.identifier, "!goal");
    assert.equal(valid.goal, 100);
});

test("validateCommandArguments - validates !addincentive", () => {
    assert.equal(validateCommandArguments("!addincentive", ["!addincentive"]).valid, false);
    assert.equal(validateCommandArguments("!addincentive", ["!addincentive", "abc"]).valid, false);

    const valid = validateCommandArguments("!addincentive", ["!addincentive", "25.50"]);
    assert.equal(valid.valid, true);
    assert.equal(valid.amount, 25.50);
});
