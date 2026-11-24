import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QuoteHelper, { castIdToNumber, castIdToString } from "../../QuoteHelper.js";
import { formatQuoteTimestamp } from "../../timeUtils.js";

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

test("QuoteHelper - add rejects empty quote text", () => {
    const fixture = createQuoteHelperFixture();
    try {
        assert.equal(fixture.helper.add("", "viewer", "Chat"), undefined);
        assert.equal(fixture.helper.add("   ", "viewer", "Chat"), undefined);
        const activeQuotes = JSON.parse(fs.readFileSync(fixture.quotesPath, "utf8"));
        assert.equal(activeQuotes.length, 4);
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
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
        assert.equal(trash[0].Original_Date, "2026-01-02 00:00:00");
        assert.equal(trash[0].Quote_Text, "Second");
        assert.ok(trash[0].Deleted_At);
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - remove rolls back trash state when the active save fails", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-remove-rollback-test-"));
    const quotesPath = path.join(tempDir, "quotes.json");
    const trashPath = path.join(tempDir, "quotes-trash.json");
    fs.writeFileSync(quotesPath, JSON.stringify([
        { Quote_Count: "1" },
        { Index: "1", Quote_Text: "Retained", Submitter: "Alice", Category: "Chat", Date: "2026-01-01 00:00:00" }
    ], null, 2));
    const writeJson = (filePath, data) => {
        if (filePath === quotesPath) {
            throw new Error("Simulated active quote save failure");
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    };
    const helper = new QuoteHelper(quotesPath, writeJson, trashPath);
    try {
        assert.throws(() => helper.remove("1"), /Simulated active quote save failure/);
        const activeQuotes = JSON.parse(fs.readFileSync(quotesPath, "utf8"));
        assert.equal(activeQuotes.length, 2);
        assert.equal(activeQuotes[1].Quote_Text, "Retained");
        const trash = JSON.parse(fs.readFileSync(trashPath, "utf8"));
        assert.equal(trash.length, 0);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - load reconciles a pending removal after an interrupted transaction", () => {
    const fixture = createUndoQuoteFixture([
        { Index: "1", Quote_Text: "First", Submitter: "viewer", Category: "Chat", Date: "2026-01-01 00:00:00" }
    ]);
    try {
        fs.writeFileSync(fixture.trashPath, JSON.stringify([
            {
                Trash_ID: "1",
                Original_Index: "1",
                Quote_Text: "First",
                Submitter: "viewer",
                Category: "Chat",
                Original_Date: "2026-01-01 00:00:00",
                Creation_Sequence: "1",
                Deleted_At: "2026-01-01T00:00:00.000Z",
                Pending_Remove: "true"
            }
        ], null, 2));

        assert.equal(fixture.helper.getMaxIndex(), 0);
        const activeQuotes = JSON.parse(fs.readFileSync(fixture.quotesPath, "utf8"));
        assert.deepEqual(activeQuotes.map(quote => quote.Index), [undefined]);
        const trash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.equal(trash[0].Pending_Remove, undefined);
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
        assert.equal(restoredQuote?.Date, "2026-01-02 00:00:00");

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

test("QuoteHelper - restore reindexes active quotes into sequential order", () => {
    const fixture = createUndoQuoteFixture([
        { Index: "1", Quote_Text: "First", Submitter: "Alice", Category: "Chat", Date: "2026-11-23 10:00:00" },
        { Index: "3", Quote_Text: "Third", Submitter: "Alice", Category: "Chat", Date: "2026-11-23 11:00:00" }
    ]);
    try {
        fs.writeFileSync(fixture.trashPath, JSON.stringify([
            {
                Trash_ID: "1",
                Quote_Text: "Restored",
                Submitter: "Alice",
                Category: "Chat",
                Original_Date: "2026-11-23 09:00:00",
                Deleted_At: "2026-11-23T09:00:00.000Z"
            }
        ], null, 2));

        const restoredQuote = fixture.helper.restore("1");
        assert.equal(restoredQuote?.Index, "3");
        const activeQuotes = JSON.parse(fs.readFileSync(fixture.quotesPath, "utf8"));
        assert.deepEqual(activeQuotes.map(quote => quote.Index), [undefined, "1", "2", "3"]);
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
        const result = fixture.helper.undoAdd("alice", null, now);
        assert.equal(result.status, "removed");
        assert.equal(result.quote?.Index, "3");
        assert.equal(result.quote?.Quote_Text, "Alice latest");
        assert.equal(result.quote?.Trash_ID, "1");

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
        const result = fixture.helper.undoAdd("alice", "1", now);
        assert.equal(result.status, "removed");
        assert.equal(result.quote?.Index, "1");
        assert.equal(result.quote?.Quote_Text, "Alice recent");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd breaks same-second timestamp ties by insertion order", () => {
    const quotes = [
        { Index: "1", Quote_Text: "First", Submitter: "Alice", Category: "Chat", Date: "2026-11-23 11:59:00" },
        { Index: "2", Quote_Text: "Second", Submitter: "Alice", Category: "Chat", Date: "2026-11-23 11:59:00" }
    ];
    const fixture = createUndoQuoteFixture(quotes);
    const now = "2026-11-23T12:00:00Z";
    try {
        const result = fixture.helper.undoAdd("alice", null, now);
        assert.equal(result.status, "removed");
        assert.equal(result.quote?.Index, "2");
        assert.equal(result.quote?.Quote_Text, "Second");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd preserves creation ordering after a quote is restored", () => {
    const quotes = [
        { Index: "1", Quote_Text: "First", Submitter: "Alice", Category: "Chat", Date: "2026-11-23 11:59:00" },
        { Index: "2", Quote_Text: "Second", Submitter: "Alice", Category: "Chat", Date: "2026-11-23 11:59:00" }
    ];
    const fixture = createUndoQuoteFixture(quotes);
    const now = "2026-11-23T12:00:00Z";
    try {
        fixture.helper.remove("1");
        fixture.helper.restore("1");
        const result = fixture.helper.undoAdd("alice", null, now);
        assert.equal(result.status, "removed");
        assert.equal(result.quote?.Index, "1");
        assert.equal(result.quote?.Quote_Text, "Second");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd reports distinct ownership, existence, and age failures", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    const now = "2026-11-23T12:00:00Z";
    try {
        assert.equal(fixture.helper.undoAdd("alice", "2", now).status, "not-owner");
        assert.equal(fixture.helper.undoAdd("alice", "99", now).status, "not-found");
        assert.equal(fixture.helper.undoAdd("alice", "4", now).status, "expired");
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
        assert.equal(fixture.helper.undoAdd("alice", "1", now).status, "expired");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd reports an invalid reference time distinctly", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    try {
        const result = fixture.helper.undoAdd("alice", "1", "not-a-date");
        assert.equal(result.status, "invalid-reference-time");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd rejects a future quote timestamp", () => {
    const quotes = createUndoQuotes();
    quotes[0].Date = "2026-11-23 13:00:00";
    const fixture = createUndoQuoteFixture(quotes);
    const now = "2026-11-23T12:00:00Z";
    try {
        assert.equal(fixture.helper.undoAdd("alice", "1", now).status, "expired");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd reports legacy and unparsable timestamps distinctly", () => {
    const quotes = createUndoQuotes();
    quotes[0].Date = "2026/10/9 1:30 PM";
    const fixture = createUndoQuoteFixture(quotes);
    const now = "2026-11-23T12:00:00Z";
    try {
        assert.equal(fixture.helper.undoAdd("alice", "1", now).status, "unparsable-date");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd prefers the expired reason when an expired quote exists", () => {
    const quotes = [
        { Index: "1", Quote_Text: "Malformed", Submitter: "Alice", Category: "Chat", Date: "2026/10/9 1:30 PM" },
        { Index: "2", Quote_Text: "Expired", Submitter: "Alice", Category: "Chat", Date: "2026-11-21 12:00:00" }
    ];
    const fixture = createUndoQuoteFixture(quotes);
    const now = "2026-11-23T12:00:00Z";
    try {
        assert.equal(fixture.helper.undoAdd("alice", null, now).status, "expired");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - undoAdd persists creation sequences for legacy quotes", () => {
    const quotes = [
        { Index: "1", Quote_Text: "Legacy", Submitter: "Alice", Category: "Chat", Date: "2026-11-21 12:00:00" }
    ];
    const fixture = createUndoQuoteFixture(quotes);
    const now = "2026-11-23T12:00:00Z";
    try {
        assert.equal(fixture.helper.undoAdd("alice", null, now).status, "expired");
        const activeQuotes = JSON.parse(fs.readFileSync(fixture.quotesPath, "utf8"));
        assert.equal(activeQuotes[0].Creation_Sequence, undefined);
        assert.equal(activeQuotes[1].Creation_Sequence, "1");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - getMaxTrashIndex handles large trash files without argument spreading", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    try {
        const trashEntries = Array.from({ length: 70000 }, (_, index) => ({
            Trash_ID: String(index + 1),
            Quote_Text: `Quote ${index + 1}`,
            Original_Date: "2026-11-23 00:00:00",
            Deleted_At: "2026-11-23T00:00:00.000Z"
        }));
        fs.writeFileSync(fixture.trashPath, JSON.stringify(trashEntries));
        assert.equal(fixture.helper.getMaxTrashIndex(), 70000);
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - loadTrash drops unusable entries and preserves the maximum seen trash ID", (t) => {
    const warnMock = t.mock.method(console, "warn", () => {});
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    const now = "2026-11-23T12:00:00Z";
    try {
        const validEntry = {
            Trash_ID: "1",
            Quote_Text: "Valid",
            Submitter: "Alice",
            Category: "Chat",
            Original_Date: "2026-11-23 00:00:00",
            Deleted_At: "2026-11-23T00:00:00.000Z"
        };
        const emptyFreeTextEntry = {
            ...validEntry,
            Trash_ID: "2",
            Quote_Text: "",
            Category: ""
        };
        const malformedEntries = [
            { ...validEntry, Trash_ID: "3", Deleted_At: "" },
            { ...validEntry, Trash_ID: "4", Original_Date: "" },
            { ...validEntry, Trash_ID: "5", Deleted_At: "not-a-date" },
            { ...validEntry, Trash_ID: undefined }
        ];
        fs.writeFileSync(fixture.trashPath, JSON.stringify([
            validEntry,
            emptyFreeTextEntry,
            ...malformedEntries
        ], null, 2));

        fixture.helper.pruneExpiredTrash(now);
        const trash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.deepEqual(
            trash.filter(entry => entry.Trash_ID).map(entry => entry.Trash_ID),
            ["1", "2"]
        );
        assert.equal(trash.find(entry => entry.Last_Trash_ID)?.Last_Trash_ID, "5");
        assert.ok(warnMock.mock.calls.length > 0);

        const removedQuote = fixture.helper.remove("1");
        assert.equal(removedQuote?.Trash_ID, "6");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - pruneExpiredTrash skips pruning for an invalid reference time", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    try {
        fs.writeFileSync(fixture.trashPath, JSON.stringify([
            {
                Trash_ID: "1",
                Quote_Text: "Retained",
                Submitter: "Alice",
                Category: "Chat",
                Original_Date: "2026-11-23 00:00:00",
                Deleted_At: "2020-01-01T00:00:00.000Z"
            }
        ], null, 2));

        assert.doesNotThrow(() => fixture.helper.pruneExpiredTrash("not-a-date"));
        assert.equal(fixture.helper.pruneExpiredTrash("not-a-date"), 0);
        const trash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.equal(trash[0].Quote_Text, "Retained");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - pruneExpiredTrash removes future-dated entries and reports the affected ID", (t) => {
    const warnMock = t.mock.method(console, "warn", () => {});
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    const now = "2026-11-23T12:00:00Z";
    try {
        fs.writeFileSync(fixture.trashPath, JSON.stringify([
            {
                Trash_ID: "9",
                Quote_Text: "Future",
                Submitter: "Alice",
                Category: "Chat",
                Original_Date: "2026-11-23 00:00:00",
                Deleted_At: "2099-11-23T00:00:00.000Z"
            }
        ], null, 2));

        assert.equal(fixture.helper.pruneExpiredTrash(now), 1);
        const trash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.equal(trash.filter(entry => entry.Trash_ID).length, 0);
        assert.equal(trash.find(entry => entry.Last_Trash_ID)?.Last_Trash_ID, "9");
        assert.ok(warnMock.mock.calls.some(call => (
            call.arguments.some(argument => String(argument).includes("9"))
        )));
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - restore rejects legacy Date records and retains them in trash", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    try {
        fs.writeFileSync(fixture.trashPath, JSON.stringify([
            {
                Trash_ID: "1",
                Quote_Text: "Legacy",
                Submitter: "Alice",
                Category: "Chat",
                Date: "2026/10/9 1:30 PM",
                Deleted_At: "2026-11-23T00:00:00.000Z"
            }
        ], null, 2));

        assert.equal(fixture.helper.restore("1"), undefined);
        const trash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.equal(trash.length, 1);
        assert.equal(trash[0].Quote_Text, "Legacy");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - restore permits empty free text with a supported timestamp", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    try {
        fs.writeFileSync(fixture.trashPath, JSON.stringify([
            {
                Trash_ID: "1",
                Quote_Text: "",
                Submitter: "",
                Category: "",
                Original_Date: "2026-11-23 00:00:00",
                Deleted_At: "2026-11-23T00:00:00.000Z"
            }
        ], null, 2));

        const restoredQuote = fixture.helper.restore("1");
        assert.equal(restoredQuote?.Quote_Text, "");
        assert.equal(restoredQuote?.Submitter, "");
        assert.equal(restoredQuote?.Category, "");
        assert.equal(restoredQuote?.Date, "2026-11-23 00:00:00");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});

test("Kiara_bot - !undoaddquote uses the message sender identity", async () => {
    const { messageHandler } = await import("../../Kiara_bot.js");
    assert.equal(messageHandler.length, 2, "messageHandler must accept injectable command dependencies");

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-command-test-"));
    const quotesPath = path.join(tempDir, "quotes.json");
    const trashPath = path.join(tempDir, "quotes-trash.json");
    const quote = {
        Index: "1",
        Quote_Text: "Sender quote",
        Submitter: "itsjustatank",
        Category: "Chat",
        Date: formatQuoteTimestamp()
    };
    fs.writeFileSync(quotesPath, JSON.stringify([{ Quote_Count: "1" }, quote], null, 2));
    const writeJson = (filePath, data) => {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    };
    const helper = new QuoteHelper(quotesPath, writeJson, trashPath);
    const sentMessages = [];

    try {
        await messageHandler({
            message: { text: "!undoaddquote" },
            "display-name": "itsjustatank",
            chatter_user_name: "Different Display Name",
            chatter_user_login: "kiawa_bot",
            badges: []
        }, {
            quoteData: helper,
            postMessage: (userId, message) => sentMessages.push(message)
        });

        assert.ok(sentMessages.some(message => message.includes("Undid Quote #1")));
        const activeQuotes = JSON.parse(fs.readFileSync(quotesPath, "utf8"));
        assert.equal(activeQuotes.length, 1);
        const trash = JSON.parse(fs.readFileSync(trashPath, "utf8"));
        assert.equal(trash[0].Quote_Text, "Sender quote");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - getMaxTrashIndex does not rewrite or serialize an unchanged metadata-only trash file", (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-trash-write-test-"));
    const quotesPath = path.join(tempDir, "quotes.json");
    const trashPath = path.join(tempDir, "quotes-trash.json");
    fs.writeFileSync(quotesPath, JSON.stringify([{ Quote_Count: "0" }]));
    fs.writeFileSync(trashPath, JSON.stringify([{ Last_Trash_ID: "7" }]));
    let writeCount = 0;
    const writeJson = (filePath, data) => {
        writeCount += 1;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    };
    const helper = new QuoteHelper(quotesPath, writeJson, trashPath);
    const originalStringify = JSON.stringify;
    let stringifyCount = 0;
    t.mock.method(JSON, "stringify", (...args) => {
        stringifyCount += 1;
        return originalStringify(...args);
    });
    try {
        assert.equal(helper.getMaxTrashIndex(), 7);
        assert.equal(helper.getMaxTrashIndex(), 7);
        assert.equal(writeCount, 0);
        assert.equal(stringifyCount, 0);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("QuoteHelper - pruneExpiredTrash removes old entries and preserves the last trash ID", () => {
    const fixture = createUndoQuoteFixture(createUndoQuotes());
    const now = "2026-11-23T12:00:00Z";
    try {
        fs.writeFileSync(fixture.trashPath, JSON.stringify([
            { Trash_ID: "2", Quote_Text: "Old", Submitter: "Alice", Category: "Chat", Original_Date: "2026-10-01 00:00:00", Deleted_At: "2026-10-01T00:00:00.000Z" },
            { Trash_ID: "1", Quote_Text: "Recent", Submitter: "Alice", Category: "Chat", Original_Date: "2026-11-22 00:00:00", Deleted_At: "2026-11-22T00:00:00.000Z" }
        ], null, 2));

        assert.equal(fixture.helper.pruneExpiredTrash(now), 1);
        const trash = JSON.parse(fs.readFileSync(fixture.trashPath, "utf8"));
        assert.equal(trash.filter(quote => quote.Trash_ID).length, 1);
        assert.equal(trash.find(quote => quote.Trash_ID)?.Quote_Text, "Recent");
        assert.equal(trash.find(quote => quote.Last_Trash_ID)?.Last_Trash_ID, "2");

        const removedQuote = fixture.helper.remove("1");
        assert.equal(removedQuote?.Trash_ID, "3");
    } finally {
        fs.rmSync(fixture.tempDir, { recursive: true, force: true });
    }
});
