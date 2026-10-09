import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.WEB_PORT = "18081";
const { server, errorHandler } = await import("../../webserver/server.js");

const BASE_URL = "http://127.0.0.1:18081";

test.after(async () => {
    if (server && typeof server.close === "function") {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("Webserver - health check endpoint returns 200 and ok status", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ok");
    assert.ok(data.timestamp);
});

test("Webserver - chatwidget endpoint returns 200 and text/html", async () => {
    const res = await fetch(`${BASE_URL}/chatwidget`);
    assert.equal(res.status, 200);
    const contentType = res.headers.get("content-type") || "";
    assert.ok(contentType.includes("text/html"));
    const text = await res.text();
    assert.ok(text.length > 0);
});

test("Webserver - JSON API endpoints return 200 and application/json", async () => {
    const endpoints = ["/api/streaks", "/api/quotes", "/api/commands", "/api/incentives"];
    for (const ep of endpoints) {
        const res = await fetch(`${BASE_URL}${ep}`);
        assert.equal(res.status, 200);
        const contentType = res.headers.get("content-type") || "";
        assert.ok(contentType.includes("application/json"));
    }

    const incRes = await fetch(`${BASE_URL}/api/incentives`);
    const incData = await incRes.json();
    assert.ok(incData.incentive, "Must contain incentive root key");
    assert.equal(typeof incData.incentive.command, "string");
    assert.equal(typeof incData.incentive.amount, "number");
    assert.equal(typeof incData.incentive.goal, "number");
});

test("Webserver - /api/incentives handles malformed JSON and file size limits", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "incentives-test-"));
    const tempIncPath = path.join(tempDir, "incentives.json");
    const prevEnv = process.env.INCENTIVE_PATH;
    process.env.INCENTIVE_PATH = tempIncPath;

    try {
        // Test malformed JSON returns 500 to surface corrupt on-disk data
        fs.writeFileSync(tempIncPath, "{ malformed: json not valid }");
        const malformedRes = await fetch(`${BASE_URL}/api/incentives`);
        assert.equal(malformedRes.status, 500);
        const malformedData = await malformedRes.json();
        assert.ok(malformedData.error.includes("malformed JSON"));

        // Test oversized file returns 413
        const largeContent = "x".repeat(1024 * 1024 + 100);
        fs.writeFileSync(tempIncPath, largeContent);
        const largeRes = await fetch(`${BASE_URL}/api/incentives`);
        assert.equal(largeRes.status, 413);
        const largeData = await largeRes.json();
        assert.ok(largeData.error.includes("exceeds"));
    } finally {
        if (prevEnv !== undefined) {
            process.env.INCENTIVE_PATH = prevEnv;
        } else {
            delete process.env.INCENTIVE_PATH;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("Webserver - /api/streaks, /api/quotes, /api/commands return 500 on malformed JSON", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-malformed-test-"));
    const badStreaksPath = path.join(tempDir, "streaks.json");
    const badQuotesPath = path.join(tempDir, "quotes.json");
    const badCommandsPath = path.join(tempDir, "commands.json");

    fs.writeFileSync(badStreaksPath, "{ bad json");
    fs.writeFileSync(badQuotesPath, "{ bad json");
    fs.writeFileSync(badCommandsPath, "{ bad json");

    const prevStreaks = process.env.STREAKS_PATH;
    const prevQuotes = process.env.QUOTES_PATH;
    const prevCommands = process.env.COMMANDS_PATH;

    process.env.STREAKS_PATH = badStreaksPath;
    process.env.QUOTES_PATH = badQuotesPath;
    process.env.COMMANDS_PATH = badCommandsPath;

    try {
        const streakRes = await fetch(`${BASE_URL}/api/streaks`);
        assert.equal(streakRes.status, 500, "Streaks API must return 500 on malformed JSON");

        const quoteRes = await fetch(`${BASE_URL}/api/quotes`);
        assert.equal(quoteRes.status, 500, "Quotes API must return 500 on malformed JSON");

        const cmdRes = await fetch(`${BASE_URL}/api/commands`);
        assert.equal(cmdRes.status, 500, "Commands API must return 500 on malformed JSON");
    } finally {
        if (prevStreaks !== undefined) process.env.STREAKS_PATH = prevStreaks; else delete process.env.STREAKS_PATH;
        if (prevQuotes !== undefined) process.env.QUOTES_PATH = prevQuotes; else delete process.env.QUOTES_PATH;
        if (prevCommands !== undefined) process.env.COMMANDS_PATH = prevCommands; else delete process.env.COMMANDS_PATH;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});


test("Webserver - HTML dashboard views return 200 and text/html", async () => {
    const endpoints = ["/", "/streaks", "/quotes", "/commands", "/incentives"];
    for (const ep of endpoints) {
        const res = await fetch(`${BASE_URL}${ep}`);
        assert.equal(res.status, 200);
        const contentType = res.headers.get("content-type") || "";
        assert.ok(contentType.includes("text/html"));
        const text = await res.text();
        assert.ok(text.length > 0);
    }
});

test("Webserver - error handling middleware respects Accept header", () => {
    let htmlStatus = 0, htmlSent = "", htmlType = "";
    const mockHtmlReq = {
        accepts: (types) => (Array.isArray(types) && types[0] === "html" ? "html" : "json")
    };
    const mockHtmlRes = {
        status: (s) => { htmlStatus = s; return mockHtmlRes; },
        type: (t) => { htmlType = t; return mockHtmlRes; },
        send: (body) => { htmlSent = body; return mockHtmlRes; }
    };
    errorHandler(new Error("Test HTML err"), mockHtmlReq, mockHtmlRes, () => {});
    assert.equal(htmlStatus, 500);
    assert.equal(htmlType, "text/html");
    assert.ok(htmlSent.includes("500 Internal Server Error"));

    let jsonStatus = 0, jsonData = null;
    const mockJsonReq = {
        accepts: (types) => (Array.isArray(types) && types[0] === "html" ? "json" : "json")
    };
    const mockJsonRes = {
        status: (s) => { jsonStatus = s; return mockJsonRes; },
        json: (data) => { jsonData = data; return mockJsonRes; }
    };
    errorHandler(new Error("Test JSON err"), mockJsonReq, mockJsonRes, () => {});
    assert.equal(jsonStatus, 500);
    assert.deepEqual(jsonData, { error: "Internal Server Error" });

    // When req.accepts returns false (e.g. client requests neither html nor json), default to JSON 500
    let fallbackStatus = 0, fallbackData = null;
    const mockFallbackReq = {
        accepts: () => false
    };
    const mockFallbackRes = {
        status: (s) => { fallbackStatus = s; return mockFallbackRes; },
        json: (data) => { fallbackData = data; return mockFallbackRes; }
    };
    errorHandler(new Error("Test fallback err"), mockFallbackReq, mockFallbackRes, () => {});
    assert.equal(fallbackStatus, 500);
    assert.deepEqual(fallbackData, { error: "Internal Server Error" });
});

test("Webserver - error handling middleware delegates to next when headers are already sent", () => {
    let nextCalledWith = null;
    let statusCalled = false;
    const mockReq = { accepts: () => "json" };
    const mockRes = {
        headersSent: true,
        status: () => { statusCalled = true; return mockRes; },
        json: () => mockRes
    };
    const testErr = new Error("Headers already sent error");
    errorHandler(testErr, mockReq, mockRes, (err) => {
        nextCalledWith = err;
    });
    assert.equal(nextCalledWith, testErr);
    assert.equal(statusCalled, false);
});

test("Webserver - exports or reuses consistent default incentive object", async () => {
    const { DEFAULT_INCENTIVE } = await import("../../webserver/server.js");
    assert.ok(DEFAULT_INCENTIVE, "DEFAULT_INCENTIVE should be defined");
    assert.ok(Object.isFrozen(DEFAULT_INCENTIVE), "DEFAULT_INCENTIVE should be frozen");
    assert.deepEqual(DEFAULT_INCENTIVE.incentive, {
        command: "!update",
        amount: 0,
        goal: 0
    });
});
