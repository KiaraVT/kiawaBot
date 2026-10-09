import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { formatAxiosError, redactSensitiveUrl, sanitizeAxiosConfig } from "../../errorUtils.js";
import AuthDataHelper from "../../AuthDataHelper.js";
import {
    createSingleFlightMutex,
    executeWithBackoff,
    processStreamStartStreak,
    validateCommandArguments,
    TwitchAuthPipeline
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

test("redactSensitiveUrl - redacts tokens in hash fragments and fallback strings", () => {
    const fragmentUrl = "https://example.com/callback#access_token=secretFragment&state=xyz&refresh_token=refreshFragment";
    const redactedFrag = redactSensitiveUrl(fragmentUrl);
    assert.ok(redactedFrag.includes("access_token=[REDACTED]"));
    assert.ok(redactedFrag.includes("refresh_token=[REDACTED]"));
    assert.ok(redactedFrag.includes("state=[REDACTED]"));
    assert.equal(redactedFrag.includes("secretFragment"), false);
    assert.equal(redactedFrag.includes("xyz"), false);

    const fallbackString = "invalid-url?code=secretCode#access_token=hashToken&state=secretState";
    const redactedFallback = redactSensitiveUrl(fallbackString);
    assert.ok(redactedFallback.includes("code=[REDACTED]"));
    assert.ok(redactedFallback.includes("access_token=[REDACTED]"));
    assert.ok(redactedFallback.includes("state=[REDACTED]"));
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

test("executeWithBackoff - enforces maxDelayMs cap and applies jitter", async () => {
    const recordedDelays = [];
    const transientError = { response: { status: 503 } };

    const operation = async () => {
        throw transientError;
    };

    await assert.rejects(
        () => executeWithBackoff(operation, {
            maxRetries: 3,
            baseDelayMs: 20,
            maxDelayMs: 30,
            onRetry: (_err, _attempt, delayMs) => {
                recordedDelays.push(delayMs);
            }
        }),
        (err) => err?.response?.status === 503
    );

    assert.equal(recordedDelays.length, 3);
    // With maxDelayMs=30, raw delay is capped at 30 before jitter (0.8 - 1.2), so bounds are [24, 36]
    for (const delay of recordedDelays) {
        assert.ok(delay <= 36, `Delay ${delay} should be at most 36 (1.2 * 30)`);
        assert.ok(delay >= 24, `Delay ${delay} should be at least 24 (0.8 * 30)`);
    }

    // Verify jitter: false produces exact deterministic delay
    const nonJitterDelays = [];
    await assert.rejects(
        () => executeWithBackoff(operation, {
            maxRetries: 2,
            baseDelayMs: 20,
            maxDelayMs: 30,
            jitter: false,
            onRetry: (_err, _attempt, delayMs) => {
                nonJitterDelays.push(delayMs);
            }
        }),
        (err) => err?.response?.status === 503
    );
    assert.deepEqual(nonJitterDelays, [30, 30], "With jitter disabled, delays must equal exact capped delay");
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

test("processStreamStartStreak - handles read errors distinguishing ENOENT from I/O failure", () => {
    let writeCalled = false;
    const ioEnoent = {
        readFn: () => {
            const err = new Error("File not found");
            err.code = "ENOENT";
            throw err;
        },
        writeFn: () => { writeCalled = true; }
    };

    const enoentRes = processStreamStartStreak("path.json", "2026-10-09T10:00:00Z", ioEnoent);
    assert.equal(enoentRes.updated, true);
    assert.equal(enoentRes.reason, "initialized_new_file");
    assert.equal(writeCalled, true);

    let writeCalledOnError = false;
    const ioPermissionError = {
        readFn: () => {
            const err = new Error("Permission denied");
            err.code = "EACCES";
            throw err;
        },
        writeFn: () => { writeCalledOnError = true; }
    };

    const errRes = processStreamStartStreak("path.json", "2026-10-09T10:00:00Z", ioPermissionError);
    assert.equal(errRes.updated, false);
    assert.equal(errRes.reason, "read_error");
    assert.equal(writeCalledOnError, false, "Must not write on I/O read failure");
});

test("validateCommandArguments - validates !addcommand and !editcommand", () => {
    assert.equal(validateCommandArguments("!addcommand", []).valid, false);
    assert.equal(validateCommandArguments("!addcommand", ["!addcommand"]).valid, false);
    assert.equal(validateCommandArguments("!addcommand", ["!addcommand", "hello"]).valid, false);
    assert.equal(validateCommandArguments("!addcommand", ["!addcommand", "hello", "   "]).valid, false);

    const valid = validateCommandArguments("!addcommand", ["!addcommand", "!greet", "  Hello  ", "world  "]);
    assert.equal(valid.valid, true);
    assert.equal(valid.tag, "greet");
    assert.equal(valid.text, "Hello   world");
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

test("TwitchAuthPipeline - validateAccessToken validates both accounts and triggers initial validation", async () => {
    let initialValidationCalled = false;
    const mockAuthData = {
        data: {
            twitchBroadcaster: { access_token: "tok_broadcaster", refresh_token: "ref_broadcaster" },
            twitchBot: { access_token: "tok_bot", refresh_token: "ref_bot" }
        },
        read(k) {
            const [acc, prop] = k.split(".");
            return this.data[acc]?.[prop];
        },
        update(k, v) {
            const [acc, prop] = k.split(".");
            if (this.data[acc]) this.data[acc][prop] = v;
        }
    };

    const mockAxios = {
        get: async (url, config) => {
            const authHeader = config?.headers?.Authorization || "";
            if (authHeader.includes("tok_broadcaster") || authHeader.includes("tok_bot")) {
                return { status: 200, data: { client_id: "test_cid", expires_in: 3600 } };
            }
            const err = new Error("Invalid token");
            err.response = { status: 401 };
            throw err;
        },
        post: async () => ({ data: {} })
    };

    const pipeline = new TwitchAuthPipeline({
        authData: mockAuthData,
        axios: mockAxios,
        onInitialValidation: () => { initialValidationCalled = true; }
    });

    await pipeline.validateAccessToken();

    assert.equal(pipeline.broadcasterAuthReady, true);
    assert.equal(pipeline.botAuthReady, true);
    assert.equal(initialValidationCalled, true);
});

test("TwitchAuthPipeline - validateAccessToken refreshes expired tokens on 401", async () => {
    const mockAuthData = {
        data: {
            twitchBroadcaster: { access_token: "expired_broadcaster", refresh_token: "ref_broadcaster" },
            twitchBot: { access_token: "valid_bot", refresh_token: "ref_bot" }
        },
        read(k) {
            const [acc, prop] = k.split(".");
            return this.data[acc]?.[prop];
        },
        update(k, v) {
            const [acc, prop] = k.split(".");
            if (this.data[acc]) this.data[acc][prop] = v;
        }
    };

    const mockAxios = {
        get: async (url, config) => {
            const authHeader = config?.headers?.Authorization || "";
            if (authHeader.includes("refreshed_broadcaster") || authHeader.includes("valid_bot")) {
                return { status: 200, data: { client_id: "test_cid" } };
            }
            const err = new Error("Unauthorized");
            err.response = { status: 401 };
            throw err;
        },
        post: async (url, data) => {
            if (data?.refresh_token === "ref_broadcaster") {
                return { data: { access_token: "refreshed_broadcaster", refresh_token: "new_ref_broadcaster" } };
            }
            throw new Error("Unexpected post");
        }
    };

    const pipeline = new TwitchAuthPipeline({
        authData: mockAuthData,
        axios: mockAxios
    });

    await pipeline.validateAccessToken();

    assert.equal(pipeline.broadcasterAuthReady, true);
    assert.equal(pipeline.botAuthReady, true);
    assert.equal(mockAuthData.data.twitchBroadcaster.access_token, "refreshed_broadcaster");
    assert.equal(mockAuthData.data.twitchBroadcaster.refresh_token, "new_ref_broadcaster");
});

test("TwitchAuthPipeline - refreshSingleToken classifies HTTP 400/401/403 as permanent auth failures", async () => {
    let authNotified = false;
    const mockAuthData = {
        data: {
            twitchBroadcaster: { access_token: "tok", refresh_token: "revoked_ref" }
        },
        read() { return this.data.twitchBroadcaster.refresh_token; },
        update() {}
    };

    const mockAxios = {
        post: async () => {
            const err = new Error("Invalid refresh token");
            err.response = { status: 400 };
            throw err;
        }
    };

    const pipeline = new TwitchAuthPipeline({
        authData: mockAuthData,
        axios: mockAxios,
        notifyAuthRequired: () => { authNotified = true; }
    });

    const result = await pipeline.refreshSingleToken("twitchBroadcaster", "Broadcaster");
    assert.equal(result.refreshed, false);
    assert.equal(result.authRequired, true);
    assert.equal(result.reason, "permanent_failure");
    assert.equal(result.status, 400);
    assert.equal(pipeline.broadcasterAuthReady, false);
    assert.equal(authNotified, false);
    // Preserves existing refresh token on disk
    assert.equal(mockAuthData.data.twitchBroadcaster.refresh_token, "revoked_ref");
});

test("TwitchAuthPipeline - refreshAccount triggers notifyAuthRequired on permanent auth failure", async () => {
    let notifiedMessage = null;
    let notifiedUrl = null;
    let notifiedAccountKey = null;
    let notifiedAccountName = null;

    const mockAuthData = {
        data: {
            twitchBroadcaster: { access_token: "tok", refresh_token: "revoked_ref" }
        },
        read() { return this.data.twitchBroadcaster.refresh_token; },
        update() {}
    };

    const mockAxios = {
        post: async () => {
            const err = new Error("Invalid refresh token");
            err.response = { status: 400 };
            throw err;
        }
    };

    const pipeline = new TwitchAuthPipeline({
        authData: mockAuthData,
        axios: mockAxios,
        notifyAuthRequired: async (message, url, accountKey, accountName) => {
            notifiedMessage = message;
            notifiedUrl = url;
            notifiedAccountKey = accountKey;
            notifiedAccountName = accountName;
        }
    });

    const result = await pipeline.refreshAccount("twitchBroadcaster", "Broadcaster");
    assert.equal(result.refreshed, false);
    assert.equal(result.authRequired, true);
    assert.equal(result.reason, "permanent_failure");
    assert.equal(pipeline.broadcasterAuthReady, false);
    assert.ok(notifiedMessage.includes("Broadcaster"));
    assert.ok(notifiedUrl.startsWith("https://id.twitch.tv/oauth2/authorize?"));
    assert.equal(notifiedAccountKey, "twitchBroadcaster");
    assert.equal(notifiedAccountName, "Broadcaster");
});

test("TwitchAuthPipeline - ensureBroadcasterAuth and ensureBotAuth throttle via cooldown", async () => {
    let postCount = 0;
    const mockAuthData = {
        read: () => "mock_ref",
        update: () => {}
    };
    const mockAxios = {
        post: async () => {
            postCount += 1;
            return { data: { access_token: "new_tok", refresh_token: "new_ref" } };
        }
    };

    const pipeline = new TwitchAuthPipeline({
        authData: mockAuthData,
        axios: mockAxios,
        cooldownMs: 5000
    });

    // First attempt succeeds and recovers readiness
    const ready1 = await pipeline.ensureBroadcasterAuth();
    assert.equal(ready1, true);
    assert.equal(pipeline.broadcasterAuthReady, true);
    assert.equal(postCount, 1);

    // If marked unready within cooldown, second attempt does not fire post
    pipeline.broadcasterAuthReady = false;
    const ready2 = await pipeline.ensureBroadcasterAuth();
    assert.equal(ready2, false);
    assert.equal(postCount, 1, "Should not refresh again within cooldown window");
});

test("TwitchAuthPipeline - withAuthRetry retries on 401 and redacts URL on final error", async () => {
    let refreshCalled = false;
    let requestCount = 0;
    const mockAuthData = {
        data: {
            twitchBroadcaster: { access_token: "old_tok", refresh_token: "valid_ref" }
        },
        read: () => "valid_ref",
        update: () => {}
    };
    const mockAxios = {
        post: async () => {
            refreshCalled = true;
            return { data: { access_token: "refreshed_tok", refresh_token: "new_ref" } };
        }
    };

    const pipeline = new TwitchAuthPipeline({
        authData: mockAuthData,
        axios: mockAxios
    });

    const successfulRetry = await pipeline.withAuthRetry("twitchBroadcaster", "Broadcaster", async () => {
        requestCount += 1;
        if (requestCount === 1) {
            const err = new Error("Unauthorized");
            err.response = { status: 401 };
            throw err;
        }
        return { data: "success" };
    });

    assert.equal(successfulRetry.data, "success");
    assert.equal(requestCount, 2);
    assert.equal(refreshCalled, true);

    // Final failure redacts URL before throwing
    const failingOp = async () => {
        const err = new Error("Fatal Twitch error");
        err.config = { url: "https://api.twitch.tv/helix/users?access_token=secretOAuthToken123" };
        err.response = { status: 500 };
        throw err;
    };

    await assert.rejects(
        () => pipeline.withAuthRetry("twitchBroadcaster", "Broadcaster", failingOp),
        (err) => {
            assert.ok(err.config.url.includes("access_token=[REDACTED]"));
            assert.equal(err.config.url.includes("secretOAuthToken123"), false);
            return true;
        }
    );
});

test("TwitchAuthPipeline - OAuth flow generates state and callback routes to correct account", async () => {
    let capturedAuthUrl = "";
    const updatedTokens = {};
    const mockAuthData = {
        update(k, v) { updatedTokens[k] = v; },
        read: () => ""
    };
    const mockAxios = {
        post: async (url, data) => {
            if (data?.code === "auth_code_123") {
                return { data: { access_token: "bot_access_tok", refresh_token: "bot_refresh_tok" } };
            }
            throw new Error("Invalid code");
        },
        get: async () => ({ status: 200, data: {} })
    };

    const pipeline = new TwitchAuthPipeline({
        authData: mockAuthData,
        axios: mockAxios,
        clientId: "cid",
        clientSecret: "csecret",
        redirectUri: "http://127.0.0.1:3000",
        scopes: ["user:bot"],
        notifyAuthRequired: (_r, url) => { capturedAuthUrl = url; }
    });

    // Start auth for bot account
    await pipeline.startAuth("Bot auth expired", "twitchBot", "Bot");
    assert.ok(capturedAuthUrl.includes("client_id=cid"));
    const stateMatch = capturedAuthUrl.match(/state=([a-f0-9]+)/);
    assert.ok(stateMatch, "Must include state nonce in auth URL");
    const stateNonce = stateMatch[1];

    // Invalid state returns 400
    const invalidResult = await pipeline.handleOAuthCallback("auth_code_123", "wrong_nonce");
    assert.equal(invalidResult.status, 400);

    // Valid callback updates bot account tokens
    const validResult = await pipeline.handleOAuthCallback("auth_code_123", stateNonce);
    assert.equal(validResult.status, 200);
    assert.equal(validResult.accountKey, "twitchBot");
    assert.equal(updatedTokens["twitchBot.access_token"], "bot_access_tok");
    assert.equal(updatedTokens["twitchBot.refresh_token"], "bot_refresh_tok");
    assert.equal(pipeline.botAuthReady, true);
});

test("sanitizeAxiosConfig - redacts sensitive secrets in config data, params, and url", () => {
    const configWithObjectData = {
        method: "post",
        url: "https://id.twitch.tv/oauth2/token?client_secret=url_secret",
        data: {
            client_id: "cid123",
            client_secret: "secret_xyz",
            refresh_token: "ref_tok_abc",
            code: "auth_code_999"
        },
        params: {
            state: "secret_state_nonce",
            access_token: "bearer_secret"
        }
    };

    sanitizeAxiosConfig(configWithObjectData);

    assert.equal(configWithObjectData.url.includes("client_secret=[REDACTED]"), true);
    assert.equal(configWithObjectData.data.client_secret, "[REDACTED]");
    assert.equal(configWithObjectData.data.refresh_token, "[REDACTED]");
    assert.equal(configWithObjectData.data.code, "[REDACTED]");
    assert.equal(configWithObjectData.data.client_id, "cid123", "Non-secret keys preserved");
    assert.equal(configWithObjectData.params.state, "[REDACTED]");
    assert.equal(configWithObjectData.params.access_token, "[REDACTED]");

    const configWithJsonData = {
        data: JSON.stringify({ client_secret: "json_secret", refresh_token: "json_ref" })
    };
    sanitizeAxiosConfig(configWithJsonData);
    assert.equal(configWithJsonData.data.includes("json_secret"), false);
    assert.ok(configWithJsonData.data.includes("[REDACTED]"));

    const configWithUrlEncodedData = {
        data: "client_id=cid&client_secret=form_secret&refresh_token=form_ref"
    };
    sanitizeAxiosConfig(configWithUrlEncodedData);
    assert.equal(configWithUrlEncodedData.data.includes("form_secret"), false);
    assert.ok(configWithUrlEncodedData.data.includes("client_secret=[REDACTED]"));
});

test("formatAxiosError - formats error string with endpoint without leaking sensitive data", () => {
    const error = {
        message: "Token request failed",
        config: {
            method: "post",
            url: "https://id.twitch.tv/oauth2/token?client_secret=raw_secret",
            data: { client_secret: "raw_secret" }
        },
        response: {
            status: 400,
            statusText: "Bad Request",
            data: { message: "Invalid client secret" }
        }
    };

    const formatted = formatAxiosError(error);
    assert.ok(formatted.includes("[Axios] Token request failed (POST https://id.twitch.tv/oauth2/token?client_secret=[REDACTED]) -> 400 Bad Request: Invalid client secret"));
    assert.equal(formatted.includes("raw_secret"), false);
});

test("TwitchAuthPipeline - withAuthRetry sanitizes error.config.data before throwing", async () => {
    const mockAuthData = {
        data: {
            twitchBroadcaster: { access_token: "tok", refresh_token: "ref" }
        },
        read: () => "valid_ref",
        update: () => {}
    };
    const mockAxios = {
        post: async () => ({ data: { access_token: "tok", refresh_token: "ref" } })
    };

    const pipeline = new TwitchAuthPipeline({
        authData: mockAuthData,
        axios: mockAxios
    });
    pipeline.broadcasterAuthReady = true;

    const failingOp = async () => {
        const err = new Error("Twitch error with payload");
        err.config = {
            url: "https://api.twitch.tv/helix/users?access_token=secret123",
            data: { client_secret: "leak_secret_456" }
        };
        err.response = { status: 500 };
        throw err;
    };

    await assert.rejects(
        () => pipeline.withAuthRetry("twitchBroadcaster", "Broadcaster", failingOp),
        (err) => {
            assert.equal(err.config.data.client_secret, "[REDACTED]");
            return true;
        }
    );
});

test("TwitchAuthPipeline - caps activeAuthStates to prevent unbounded memory growth", async () => {
    const pipeline = new TwitchAuthPipeline({
        maxActiveAuthStates: 3,
        notifyAuthRequired: async () => {}
    });

    pipeline.activeAuthStates.set("state-a", { accountKey: "k", createdAt: Date.now() - 5000 });
    pipeline.activeAuthStates.set("state-b", { accountKey: "k", createdAt: Date.now() - 4000 });
    pipeline.activeAuthStates.set("state-c", { accountKey: "k", createdAt: Date.now() - 3000 });

    assert.equal(pipeline.activeAuthStates.size, 3);
    await pipeline.startAuth("prompt 3", "twitchBroadcaster", "Broadcaster");
    assert.ok(pipeline.activeAuthStates.size <= 3, "activeAuthStates must not exceed maxActiveAuthStates cap");
});


