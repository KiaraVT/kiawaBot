import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QuoteHelper, { castIdToNumber, castIdToString } from "../../QuoteHelper.js";

test("QuoteHelper - castIdToNumber parses valid positive integers", () => {
    assert.equal(castIdToNumber("42"), 42);
    assert.equal(castIdToNumber(42), 42);
    // castIdToNumber uses Math.round to round decimal inputs to nearest integer ID
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

function createQuoteHelperFixture() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-trash-test-"));
    const quotesPath = path.join(tempDir, "quotes.json");
    const trashPath = path.join(tempDir, "quotes-trash.json");
    const quotes = [
        { Quote_Count: "3" },
        { Index: "1", Quote_Text: "First", Submitter: "viewer", Category: "Chat", Date: "2026-01-01 00:00:00" },
        { Index: "2", Quote_Text: "Second", Submitter: "viewer", Category: "Chat", Date: "2026-01-02 00:00:00" },
        { Index: "3", Quote_Text: "Third", Submitter: "viewer", Category: "Chat", Date: "2026-01-03 00:00:00" }
    ];
    fs.writeFileSync(quotesPath, JSON.stringify(quotes, null, 2));
    const writeJson = (filePath, data) => {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    };
    const helper = new QuoteHelper(quotesPath, writeJson, trashPath);
    return { tempDir, quotesPath, trashPath, helper };
}

test("QuoteHelper - remove moves a quote to trash and reindexes active quotes", () => {
    const fixture = createQuoteHelperFixture();
    try {
        const removedQuote = fixture.helper.remove("2");
        assert.equal(removedQuote?.Index, "2");
        assert.equal(removedQuote?.Trash_ID, "1");

        const activeQuotes = JSON.parse(fs.readFileSync(fixture.quotesPath, "utf8"));
        assert.deepEqual(activeQuotes.map(quote => quote.Index), [undefined, "1", "2"]);
        assert.equal(activeQuotes[2].Quote_Text, "Third");

        const trash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.equal(trash.length, 1);
        assert.equal(trash[0].Trash_ID, "1");
        assert.equal(trash[0].Original_Index, "2");
        assert.equal(trash[0].Quote_Text, "Second");
        assert.ok(trash[0].Deleted_At);
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - restore returns a trashed quote to the active collection", () => {
    const fixture = createQuoteHelperFixture();
    try {
        fixture.helper.remove("2");
        const restoredQuote = fixture.helper.restore("1");
        assert.equal(restoredQuote?.Index, "3");
        assert.equal(restoredQuote?.Quote_Text, "Second");

        const activeQuotes = JSON.parse(fs.readFileSync(fixture.quotesPath, "utf8"));
        assert.deepEqual(activeQuotes.map(quote => quote.Index), [undefined, "1", "2", "3"]);
        assert.equal(activeQuotes[3].Quote_Text, "Second");

        const trash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.equal(trash.length, 1);
        assert.equal(trash[0].Restored_Index, "3");
        assert.ok(trash[0].Restored_At);
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - restore returns undefined for an unknown trash ID", () => {
    const fixture = createQuoteHelperFixture();
    try {
        fixture.helper.remove("2");
        assert.equal(fixture.helper.restore("99"), undefined);
        assert.equal(JSON.parse(fs.readFileSync(fixture.trashPath, "utf8")).length, 1);
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - restore does not restore the same trash entry twice", () => {
    const fixture = createQuoteHelperFixture();
    try {
        fixture.helper.remove("2");
        assert.ok(fixture.helper.restore("1"));
        assert.equal(fixture.helper.restore("1"), undefined);
        assert.equal(JSON.parse(fs.readFileSync(fixture.quotesPath, "utf8")).length, 4);
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - clearTrash removes trash entries without reusing trash IDs", () => {
    const fixture = createQuoteHelperFixture();
    try {
        fixture.helper.remove("2");
        fixture.helper.remove("2");
        assert.equal(fixture.helper.clearTrash(), 2);

        const clearedTrash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.equal(clearedTrash.filter(quote => quote.Trash_ID).length, 0);

        const removedQuote = fixture.helper.remove("1");
        assert.equal(removedQuote?.Trash_ID, "3");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

function createUndoQuoteFixture(quotes) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-undo-test-"));
    const quotesPath = path.join(tempDir, "quotes.json");
    const trashPath = path.join(tempDir, "quotes-trash.json");
    fs.writeFileSync(quotesPath, JSON.stringify([
        { Quote_Count: String(quotes.length) },
        ...quotes
    ], null, 2));
    const writeJson = (filePath, data) => {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    };
    const helper = new QuoteHelper(quotesPath, writeJson, trashPath);
    return { tempDir, quotesPath, trashPath, helper };
}

function createUndoQuotes() {
    return [
        { Index: "1", Quote_Text: "Alice recent", Submitter: "Alice", Category: "Chat", Date: "2026-11-22 13:00:00" },
        { Index: "2", Quote_Text: "Bob recent", Submitter: "Bob", Category: "Chat", Date: "2026-11-23 11:30:00" },
        { Index: "3", Quote_Text: "Alice latest", Submitter: "Alice", Category: "Chat", Date: "2026-11-23 10:00:00" },
        { Index: "4", Quote_Text: "Alice expired", Submitter: "Alice", Category: "Chat", Date: "2026-11-21 12:00:00" }
    ];
}

test("QuoteHelper - undoAdd without an ID removes the caller's latest quote within 24 hours", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    const now = "2026-11-23T12:00:00Z";
    try {
        const undoneQuote = fixture.helper.undoAdd("alice", null, now);
        assert.equal(undoneQuote?.Index, "3");
        assert.equal(undoneQuote?.Quote_Text, "Alice latest");
        assert.equal(undoneQuote?.Trash_ID, "1");

        const trash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.equal(trash[0].Quote_Text, "Alice latest");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd with an ID removes only the caller's eligible quote", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    const now = "2026-11-23T12:00:00Z";
    try {
        const undoneQuote = fixture.helper.undoAdd("alice", "1", now);
        assert.equal(undoneQuote?.Index, "1");
        assert.equal(undoneQuote?.Quote_Text, "Alice recent");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd rejects another submitter and quotes older than 24 hours", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    const now = "2026-11-23T12:00:00Z";
    try {
        assert.equal(fixture.helper.undoAdd("alice", "2", now), undefined);
        assert.equal(fixture.helper.undoAdd("alice", "4", now), undefined);
        assert.equal(JSON.parse(fs.readFileSync(fixture.quotesPath, "utf8")).length, 5);
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd rejects a quote exactly 24 hours old", () => {
    const quotes = createUndoQuotes();
    quotes[0].Date = "2026-11-22 12:00:00";
    const fixture = createUndoQuoteFixture(quotes);
    const now = "2026-11-23T12:00:00Z";
    try {
        assert.equal(fixture.helper.undoAdd("alice", "1", now), undefined);
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});
