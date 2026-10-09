import test from "node:test";
import assert from "node:assert/strict";
import { formatAxiosError } from "../../errorUtils.js";

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

test("Catch block safety - safe inspection does not throw on undefined response", () => {
    const errors = [
        new Error("Timeout"),
        { message: "socket hang up" },
        null,
        undefined
    ];

    for (const err of errors) {
        // Must never throw TypeError: Cannot read properties of undefined (reading 'status')
        const status = err?.response?.status;
        assert.equal(status, undefined);
    }
});
