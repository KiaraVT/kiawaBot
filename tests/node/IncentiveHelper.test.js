import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import IncentiveHelper from "../../IncentiveHelper.js";

test("IncentiveHelper - loadData, update, read, has, and file persistence", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "incentive-test-"));
    const tempFilePath = path.join(tempDir, "incentives.json");
    let helper = null;

    try {
        helper = new IncentiveHelper(tempFilePath);
        helper.loadData();

        // Verifies default initialized data via public methods
        assert.equal(helper.has("incentive.amount"), true);
        assert.equal(helper.read("incentive.amount"), 0);
        assert.equal(helper.read("incentive.goal"), 700);

        // Verifies updates and reading modified state
        assert.equal(helper.update("incentive.amount", 100), true);
        assert.equal(helper.read("incentive.amount"), 100);
        assert.equal(helper.has("incentive.nonexistent"), false);
        assert.equal(helper.read("incentive.nonexistent"), undefined);

        // Verifies synchronous save and reloading from persistent storage
        assert.equal(helper.saveData(), true);
        const reloadedHelper = new IncentiveHelper(tempFilePath);
        reloadedHelper.loadData();
        assert.equal(reloadedHelper.read("incentive.amount"), 100);
    } finally {
        if (helper.autoSaveTimeout) {
            clearTimeout(helper.autoSaveTimeout);
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
