import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AuthDataHelper from "../../AuthDataHelper.js";

test("AuthDataHelper - does not have dead constructorIncentive method", () => {
    const helper = new AuthDataHelper();
    assert.equal(typeof helper.constructorIncentive, "undefined");
});

test("AuthDataHelper - handles missing intermediate path segments correctly", () => {
    const helper = new AuthDataHelper();
    helper.data = { a: { c: 123 } };

    // Intermediate segment "b" does not exist
    assert.equal(helper.has("a.b.c"), false);
    assert.equal(helper.read("a.b.c"), undefined);

    // update with create=false should return false and not mutate a.c
    const updateResult = helper.update("a.b.c", 999, false);
    assert.equal(updateResult, false);
    assert.equal(helper.data.a.c, 123);

    // delete should return false and not delete a.c
    const deleteResult = helper.delete("a.b.c");
    assert.equal(deleteResult, false);
    assert.equal(helper.data.a.c, 123);
});

test("AuthDataHelper - loadData, update, read, and file persistence", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-test-"));
    const tempFilePath = path.join(tempDir, "auth-data.json");
    let helper = null;

    try {
        helper = new AuthDataHelper();
        helper.dataPath = tempFilePath;
        helper.loadData();

        assert.equal(helper.has("twitch.access_token"), true);
        assert.equal(helper.read("twitch.access_token"), "");

        assert.equal(helper.update("twitch.access_token", "new_token"), true);
        assert.equal(helper.read("twitch.access_token"), "new_token");

        assert.equal(helper.saveData(), true);
        const reloaded = new AuthDataHelper();
        reloaded.dataPath = tempFilePath;
        reloaded.loadData();
        assert.equal(reloaded.read("twitch.access_token"), "new_token");
    } finally {
        if (helper?.autoSaveTimeout) {
            clearTimeout(helper.autoSaveTimeout);
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("AuthDataHelper - defaults dataPath to ./data/auth-data.json and includes broadcaster and bot schema", () => {
    const helper = new AuthDataHelper();
    assert.equal(helper.dataPath, "./data/auth-data.json");
    assert.ok(helper.defaultData.twitchBroadcaster, "twitchBroadcaster should be defined in defaultData");
    assert.ok(helper.defaultData.twitchBot, "twitchBot should be defined in defaultData");
    assert.equal(helper.defaultData.twitchBroadcaster.access_token, "");
    assert.equal(helper.defaultData.twitchBot.access_token, "");
});

test("AuthDataHelper - update defaults create to true and sets nested values", () => {
    const helper = new AuthDataHelper();
    helper.data = {};
    // update without 3rd param should default create=true
    const result = helper.update("twitchBroadcaster.access_token", "test_broadcaster_token");
    assert.equal(result, true);
    assert.equal(helper.read("twitchBroadcaster.access_token"), "test_broadcaster_token");
});

test("AuthDataHelper - migrates legacy auth-data.json if ./data/auth-data.json does not exist", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-migration-"));
    const legacyPath = path.join(tempDir, "auth-data.json");
    const newDir = path.join(tempDir, "data");
    const newPath = path.join(newDir, "auth-data.json");

    try {
        const legacyData = {
            twitchBroadcaster: { access_token: "legacy_tok", refresh_token: "legacy_ref" }
        };
        fs.writeFileSync(legacyPath, JSON.stringify(legacyData));

        const helper = new AuthDataHelper();
        helper.dataPath = newPath;
        helper.legacyPath = legacyPath;
        helper.loadData();

        assert.equal(helper.read("twitchBroadcaster.access_token"), "legacy_tok");
        assert.ok(fs.existsSync(newPath), "new path should exist after migration");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("AuthDataHelper - preserves corrupted auth file and initializes fresh default data", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-corrupt-"));
    const corruptPath = path.join(tempDir, "auth-data.json");
    let loggedError = "";
    const origError = console.error;
    console.error = (msg) => {
        loggedError += msg;
    };

    try {
        fs.writeFileSync(corruptPath, "{ malformed: json, not_valid }");
        const helper = new AuthDataHelper();
        helper.dataPath = corruptPath;
        helper.loadData();

        assert.equal(helper.read("twitchBroadcaster.access_token"), "");
        assert.ok(fs.existsSync(corruptPath), "Fresh default file should be written");
        const freshContent = JSON.parse(fs.readFileSync(corruptPath, "utf8"));
        assert.equal(freshContent.twitchBroadcaster.access_token, "");

        const files = fs.readdirSync(tempDir);
        const backupFile = files.find(f => f.startsWith("auth-data.json.corrupted."));
        assert.ok(backupFile, "Corrupted file backup should exist");
        assert.equal(fs.readFileSync(path.join(tempDir, backupFile), "utf8"), "{ malformed: json, not_valid }");
        assert.ok(loggedError.includes("Preserved corrupted file as"), "Should log corrupted file preservation");
    } finally {
        console.error = origError;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("AuthDataHelper - preserves nested unknown keys and defaults when loading existing data", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-nested-"));
    const dataPath = path.join(tempDir, "auth-data.json");

    try {
        const customData = {
            twitchBroadcaster: {
                access_token: "broadcaster_tok",
                custom_nested: { setting: 42, flag: true }
            },
            future_extension: { enabled: true }
        };
        fs.writeFileSync(dataPath, JSON.stringify(customData));

        const helper = new AuthDataHelper();
        helper.dataPath = dataPath;
        helper.loadData();

        // Preserved existing values
        assert.equal(helper.read("twitchBroadcaster.access_token"), "broadcaster_tok");
        assert.equal(helper.read("twitchBroadcaster.custom_nested.setting"), 42);
        assert.equal(helper.read("future_extension.enabled"), true);

        // Retains default schema values that were not in customData
        assert.equal(helper.read("twitchBroadcaster.refresh_token"), "");
        assert.equal(helper.read("twitchBot.access_token"), "");
        assert.equal(helper.read("youtube.access_token"), "");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

