import test from "node:test";
import assert from "node:assert/strict";
import { castIdToNumber, castIdToString } from "../../QuoteHelper.js";

test("QuoteHelper - castIdToNumber parses valid positive integers", () => {
    assert.equal(castIdToNumber("42"), 42);
    assert.equal(castIdToNumber(42), 42);
    assert.equal(castIdToNumber("42.4"), 42);
    assert.equal(castIdToNumber("42.6"), 43);
});

test("QuoteHelper - castIdToNumber returns 0 for non-positive or invalid inputs", () => {
    assert.equal(castIdToNumber("0"), 0);
    assert.equal(castIdToNumber("-5"), 0);
    assert.equal(castIdToNumber("abc"), 0);
    assert.equal(castIdToNumber(null), 0);
    assert.equal(castIdToNumber(undefined), 0);
});

test("QuoteHelper - castIdToString formats positive numbers as string", () => {
    assert.equal(castIdToString("100"), "100");
    assert.equal(castIdToString(100), "100");
});

test("QuoteHelper - castIdToString returns empty string for invalid inputs", () => {
    assert.equal(castIdToString("0"), "");
    assert.equal(castIdToString("-10"), "");
    assert.equal(castIdToString("invalid"), "");
});
