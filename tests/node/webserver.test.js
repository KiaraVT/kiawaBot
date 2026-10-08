import test from "node:test";
import assert from "node:assert/strict";

process.env.WEB_PORT = "18081";
const { server } = await import("../../webserver/server.js");

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
    const endpoints = ["/api/streaks", "/api/quotes", "/api/commands"];
    for (const ep of endpoints) {
        const res = await fetch(`${BASE_URL}${ep}`);
        assert.equal(res.status, 200);
        const contentType = res.headers.get("content-type") || "";
        assert.ok(contentType.includes("application/json"));
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
