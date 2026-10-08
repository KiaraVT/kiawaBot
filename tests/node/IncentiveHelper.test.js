import test from "node:test";
import assert from "node:assert/strict";
import IncentiveHelper from "../../IncentiveHelper.js";

test("IncentiveHelper - defaults and path navigation", () => {
    const helper = new IncentiveHelper();
    // Test path navigation via public data property in memory to isolate unit test
    // without reading or writing to persistent host storage at ./data/incentives.json.
    helper.data = {
        incentive: {
            command: "!update",
            amount: 100,
            goal: 500
        }
    };

    assert.equal(helper.has("incentive.amount"), true);
    assert.equal(helper.read("incentive.amount"), 100);
    assert.equal(helper.read("incentive.goal"), 500);
    assert.equal(helper.has("incentive.nonexistent"), false);
    assert.equal(helper.read("incentive.nonexistent"), undefined);
});
