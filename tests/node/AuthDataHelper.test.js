import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AuthDataHelper, { deepMerge, safeSetPermission } from "../../AuthDataHelper.js";

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

test("deepMerge - clones arrays and handles null values safely", () => {
    const target = {
        twitch: { access_token: "old", scopes: ["chat:read"] },
        flags: { active: true },
        count: 10
    };
    const sourceArr = ["chat:read", "chat:edit"];
    const source = {
        twitch: { access_token: "new", scopes: sourceArr },
        flags: null,
        extra: [1, 2, 3]
    };

    const merged = deepMerge(target, source);

    // Array is cloned, not referenced directly
    assert.deepEqual(merged.twitch.scopes, ["chat:read", "chat:edit"]);
    assert.notEqual(merged.twitch.scopes, sourceArr, "Array should be cloned, not shared by reference");
    sourceArr.push("whispers:read");
    assert.equal(merged.twitch.scopes.length, 2, "Mutating source array should not affect merged result");

    // Null source values override target safely without wiping sibling keys
    assert.equal(merged.flags, null);
    assert.equal(merged.count, 10, "Target sibling keys must be preserved");
    assert.deepEqual(merged.extra, [1, 2, 3]);

    // Array target or source top-level handling
    assert.deepEqual(deepMerge(["a"], ["b", "c"]), ["b", "c"]);
    assert.equal(deepMerge({ a: 1 }, null), null);
});

test("deepMerge - protects against prototype pollution keys", () => {
    const maliciousPayload = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}');
    const target = { safe: true };

    const merged = deepMerge(target, maliciousPayload);

    assert.equal(Object.prototype.polluted, undefined, "Object.prototype must not be polluted");
    assert.equal({}.polluted, undefined, "Empty object must not have polluted property");
    assert.equal(merged.__proto__.polluted, undefined, "Merged object prototype must not contain injected keys");
    assert.equal(merged.safe, true);
});

test("AuthDataHelper - directory and file modes are configured with 0o700 and 0o600", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-perm-"));
    const dataPath = path.join(tempDir, "sub", "auth-data.json");
    let mkdirMode = null;
    let writeFileMode = null;
    const origMkdirSync = fs.mkdirSync;
    const origWriteFileSync = fs.writeFileSync;

    fs.mkdirSync = (p, opts) => {
        if (opts && typeof opts === "object") mkdirMode = opts.mode;
        return origMkdirSync(p, opts);
    };
    fs.writeFileSync = (p, data, opts) => {
        if (opts && typeof opts === "object") writeFileMode = opts.mode;
        return origWriteFileSync(p, data, opts);
    };

    try {
        const helper = new AuthDataHelper();
        helper.dataPath = dataPath;
        helper.loadData();
        helper.update("twitchBroadcaster.access_token", "secret_tok", true, true);

        assert.equal(mkdirMode, 0o700, "mkdirSync must specify mode 0o700");
        assert.equal(writeFileMode, 0o600, "writeFileSync must specify mode 0o600");

        if (process.platform !== "win32") {
            const dirStat = fs.statSync(path.dirname(dataPath));
            assert.equal(dirStat.mode & 0o777, 0o700, "Auth directory mode must be 0o700");
            const fileStat = fs.statSync(dataPath);
            assert.equal(fileStat.mode & 0o777, 0o600, "Auth data file mode must be 0o600");
        }
    } finally {
        fs.mkdirSync = origMkdirSync;
        fs.writeFileSync = origWriteFileSync;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("AuthDataHelper - corrupted backup filename uses crypto random bytes hex", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-rnd-"));
    const corruptPath = path.join(tempDir, "auth-data.json");
    try {
        fs.writeFileSync(corruptPath, "{ invalid json }");
        const helper = new AuthDataHelper();
        helper.dataPath = corruptPath;
        helper.loadData();

        const files = fs.readdirSync(tempDir);
        const backupFile = files.find(f => f.startsWith("auth-data.json.corrupted."));
        assert.ok(backupFile, "Corrupted backup should exist");
        const suffix = backupFile.replace("auth-data.json.corrupted.", "");
        const parts = suffix.split(".");
        assert.equal(parts.length, 2, "Backup suffix should have timestamp and hex token");
        assert.match(parts[1], /^[a-f0-9]{8}$/, "Random token must be 8-char crypto hex string");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("safeSetPermission - logs warning on unexpected chmod failure", () => {
    let warnLogged = null;
    const origWarn = console.warn;
    const origChmodSync = fs.chmodSync;
    console.warn = (...args) => { warnLogged = args.join(" "); };
    fs.chmodSync = () => {
        const err = new Error("EACCES: permission denied");
        err.code = "EACCES";
        throw err;
    };
    try {
        safeSetPermission("/mock/path", 0o600);
        assert.ok(warnLogged && warnLogged.includes("Unable to set permissions on /mock/path"));
    } finally {
        console.warn = origWarn;
        fs.chmodSync = origChmodSync;
    }
});

test("deepMerge - recursively clones nested objects and arrays without sharing references", () => {
    const source = {
        twitch: {
            custom_nested: {
                setting: 42
            }
        },
        items: [{ id: 1 }]
    };
    const target = {};
    const merged = deepMerge(target, source);
    assert.deepEqual(merged.twitch.custom_nested, { setting: 42 });
    assert.notEqual(merged.twitch.custom_nested, source.twitch.custom_nested, "Nested object must not share reference");
    assert.notEqual(merged.items[0], source.items[0], "Nested array item must not share reference");
});

test("loadData - corrupted file recovery creates isolated deep clone of defaultData", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-corrupt-clone-"));
    const authPath = path.join(tempDir, "auth-data.json");
    try {
        fs.writeFileSync(authPath, "{ invalid json }");
        const helper = new AuthDataHelper();
        helper.dataPath = authPath;
        helper.legacyPath = null;
        helper.loadData();

        helper.update("twitch.access_token", "mutated_token", true, true);
        assert.equal(helper.data.twitch.access_token, "mutated_token");
        assert.equal(helper.defaultData.twitch.access_token, "", "defaultData must remain pristine and unmutated");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("loadData - does not rename or overwrite file if disk content is valid JSON", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-valid-check-"));
    const authPath = path.join(tempDir, "auth-data.json");
    try {
        const validJson = JSON.stringify({ twitch: { access_token: "existing_valid" } });
        fs.writeFileSync(authPath, validJson);
        const helper = new AuthDataHelper();
        helper.dataPath = authPath;
        helper.legacyPath = null;

        // Simulate an unexpected JSON.parse failure during initial read in loadData
        const origParse = JSON.parse;
        let parseCallCount = 0;
        JSON.parse = (text, reviver) => {
            parseCallCount += 1;
            if (parseCallCount === 1) {
                throw new Error("Simulated parse error on first pass");
            }
            return origParse(text, reviver);
        };

        try {
            helper.loadData();
        } finally {
            JSON.parse = origParse;
        }

        const files = fs.readdirSync(tempDir);
        const corruptedFiles = files.filter(f => f.includes(".corrupted."));
        assert.equal(corruptedFiles.length, 0, "Valid JSON file must not be renamed to corrupted backup");
        assert.equal(fs.readFileSync(authPath, "utf8"), validJson, "Valid JSON file on disk must be preserved");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
