import test from "node:test";
import assert from "node:assert/strict";

process.env.WEB_PORT = "18081";
const { server, errorHandler } = await import("../../webserver/server.js");

const BASE_URL = "http://127.0.0.1:18081";

test.after(() => {
    if (server && typeof server.close === "function") {
        server.close();
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
});
