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
