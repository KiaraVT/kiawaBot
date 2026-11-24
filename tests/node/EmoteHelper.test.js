import test from "node:test";
import assert from "node:assert/strict";
import EmoteHelper, { replaceEmotesInText } from "../../EmoteHelper.js";

const MOCK_BTTV_GLOBAL = [
    {
        id: "bttv_1",
        code: ":tf:",
        imageType: "png",
        animated: false
    },
    {
        id: "bttv_2",
        code: "SourPls",
        imageType: "gif",
        animated: true
    }
];

const MOCK_FFZ_GLOBAL = {
    default_sets: [3],
    sets: {
        "3": {
            id: 3,
            title: "Global Emotes",
            emoticons: [
                {
                    id: 9,
                    name: "ZrehplaR",
                    urls: {
                        "1": "//cdn.frankerfacez.com/emote/9/1",
                        "2": "//cdn.frankerfacez.com/emote/9/2",
                        "4": "//cdn.frankerfacez.com/emote/9/4"
                    },
                    animated: null
                },
                {
                    id: 81792,
                    name: "SoStylish",
                    urls: {
                        "1": "https://cdn.frankerfacez.com/emote/81792/1",
                        "2": "https://cdn.frankerfacez.com/emote/81792/2"
                    },
                    animated: null
                }
            ]
        }
    }
};

const MOCK_BTTV_CHANNEL = {
    id: "user_123",
    channelEmotes: [
        {
            id: "bttv_c1",
            code: "pepega",
            imageType: "png",
            animated: false
        }
    ],
    sharedEmotes: [
        {
            id: "bttv_c2",
            code: "monkaS",
            imageType: "png",
            animated: false
        }
    ]
};

const MOCK_FFZ_ROOM = {
    room: {
        _id: 10,
        twitch_id: 12345,
        id: "broadcaster"
    },
    sets: {
        "100": {
            id: 100,
            emoticons: [
                {
                    id: 31554,
                    name: "crabMissile",
                    urls: {
                        "1": "//cdn.frankerfacez.com/emote/31554/1",
                        "4": "//cdn.frankerfacez.com/emote/31554/4"
                    }
                }
            ]
        }
    }
};

function createMockFetch(routes = {}) {
    return async (url) => {
        const urlStr = String(url);
        for (const [pattern, handler] of Object.entries(routes)) {
            if (urlStr.includes(pattern)) {
                return handler(urlStr);
            }
        }
        return {
            ok: false,
            status: 404,
            json: async () => ({ message: "Not found" }),
            text: async () => "Not found"
        };
    };
}

test("EmoteHelper - fetches and parses global FFZ and BTTV emotes by default", async () => {
    let bttvCalled = false;
    let ffzCalled = false;

    const mockFetch = createMockFetch({
        "api.betterttv.net/3/cached/emotes/global": () => {
            bttvCalled = true;
            return {
                ok: true,
                status: 200,
                json: async () => MOCK_BTTV_GLOBAL
            };
        },
        "api.frankerfacez.com/v1/set/global": () => {
            ffzCalled = true;
            return {
                ok: true,
                status: 200,
                json: async () => MOCK_FFZ_GLOBAL
            };
        }
    });

    const helper = new EmoteHelper({ fetchFn: mockFetch });
    const result = await helper.getEmotes();

    assert.equal(bttvCalled, true);
    assert.equal(ffzCalled, true);
    assert.ok(result.emotes);

    // Verifies BTTV emote
    assert.deepEqual(result.emotes[":tf:"], {
        id: "bttv_1",
        code: ":tf:",
        url: "https://cdn.betterttv.net/emote/bttv_1/3x",
        source: "bttv",
        animated: false
    });

    // Verifies FFZ emote with normalized https protocol and highest available scale
    assert.deepEqual(result.emotes["ZrehplaR"], {
        id: 9,
        code: "ZrehplaR",
        url: "https://cdn.frankerfacez.com/emote/9/4",
        source: "ffz",
        animated: false
    });

    // Verifies FFZ fallback to scale 2 when scale 4 is missing
    assert.deepEqual(result.emotes["SoStylish"], {
        id: 81792,
        code: "SoStylish",
        url: "https://cdn.frankerfacez.com/emote/81792/2",
        source: "ffz",
        animated: false
    });
});

test("EmoteHelper - channels array empty initially bypasses channel endpoints", async () => {
    let channelCalled = false;

    const mockFetch = createMockFetch({
        "api.betterttv.net/3/cached/emotes/global": () => ({
            ok: true,
            status: 200,
            json: async () => MOCK_BTTV_GLOBAL
        }),
        "api.frankerfacez.com/v1/set/global": () => ({
            ok: true,
            status: 200,
            json: async () => MOCK_FFZ_GLOBAL
        }),
        "/users/twitch/": () => {
            channelCalled = true;
            return { ok: true, status: 200, json: async () => MOCK_BTTV_CHANNEL };
        },
        "/room/id/": () => {
            channelCalled = true;
            return { ok: true, status: 200, json: async () => MOCK_FFZ_ROOM };
        }
    });

    const helper = new EmoteHelper({ channels: [], fetchFn: mockFetch });
    const result = await helper.getEmotes();

    assert.equal(channelCalled, false);
    assert.equal(result.emotes["pepega"], undefined);
    assert.equal(result.emotes["crabMissile"], undefined);
});

test("EmoteHelper - loads channel emotes when channels are configured", async () => {
    const mockFetch = createMockFetch({
        "api.betterttv.net/3/cached/emotes/global": () => ({
            ok: true,
            status: 200,
            json: async () => MOCK_BTTV_GLOBAL
        }),
        "api.frankerfacez.com/v1/set/global": () => ({
            ok: true,
            status: 200,
            json: async () => MOCK_FFZ_GLOBAL
        }),
        "/users/twitch/12345": () => ({
            ok: true,
            status: 200,
            json: async () => MOCK_BTTV_CHANNEL
        }),
        "/room/id/12345": () => ({
            ok: true,
            status: 200,
            json: async () => MOCK_FFZ_ROOM
        })
    });

    const helper = new EmoteHelper({ channels: ["12345"], fetchFn: mockFetch });
    const result = await helper.getEmotes();

    // Verifies channel emotes from both BTTV (channel & shared) and FFZ
    assert.ok(result.emotes["pepega"]);
    assert.equal(result.emotes["pepega"].source, "bttv");
    assert.ok(result.emotes["monkaS"]);
    assert.equal(result.emotes["monkaS"].source, "bttv");
    assert.ok(result.emotes["crabMissile"]);
    assert.equal(result.emotes["crabMissile"].source, "ffz");
});

test("EmoteHelper - handles channel 404 gracefully without failing global emotes", async () => {
    const mockFetch = createMockFetch({
        "api.betterttv.net/3/cached/emotes/global": () => ({
            ok: true,
            status: 200,
            json: async () => MOCK_BTTV_GLOBAL
        }),
        "api.frankerfacez.com/v1/set/global": () => ({
            ok: true,
            status: 200,
            json: async () => MOCK_FFZ_GLOBAL
        }),
        "/users/twitch/nonexistent": () => ({
            ok: false,
            status: 404,
            json: async () => ({ message: "user not found" })
        }),
        "/room/id/nonexistent": () => ({
            ok: false,
            status: 404,
            json: async () => ({ message: "No such room" })
        })
    });

    const helper = new EmoteHelper({ channels: ["nonexistent"], fetchFn: mockFetch });
    const result = await helper.getEmotes();

    assert.ok(result.emotes[":tf:"]);
    assert.ok(result.emotes["ZrehplaR"]);
});

test("EmoteHelper - unified ban list filters emotes across all providers", async () => {
    const mockFetch = createMockFetch({
        "api.betterttv.net/3/cached/emotes/global": () => ({
            ok: true,
            status: 200,
            json: async () => [
                { id: "b1", code: ":tf:", imageType: "png", animated: false },
                { id: "b2", code: "SourPls", imageType: "gif", animated: true }
            ]
        }),
        "api.frankerfacez.com/v1/set/global": () => ({
            ok: true,
            status: 200,
            json: async () => ({
                default_sets: [3],
                sets: {
                    "3": {
                        emoticons: [
                            {
                                id: 20,
                                name: "SoStylish",
                                urls: { "1": "https://cdn.frankerfacez.com/emote/20/1" }
                            },
                            {
                                id: 30,
                                name: "ZrehplaR",
                                urls: { "1": "https://cdn.frankerfacez.com/emote/30/1" }
                            }
                        ]
                    }
                }
            })
        })
    });

    // 1. Empty ban list allows all emotes through
    const helperEmpty = new EmoteHelper({ banList: [], fetchFn: mockFetch });
    const resultEmpty = await helperEmpty.getEmotes();
    assert.ok(resultEmpty.emotes[":tf:"]);
    assert.ok(resultEmpty.emotes["SourPls"]);
    assert.ok(resultEmpty.emotes["SoStylish"]);
    assert.ok(resultEmpty.emotes["ZrehplaR"]);

    // 2. Banning :tf: and SoStylish removes both regardless of provider
    const helperBanned = new EmoteHelper({
        banList: [":tf:", "SoStylish"],
        fetchFn: mockFetch
    });
    const resultBanned = await helperBanned.getEmotes();
    assert.equal(resultBanned.emotes[":tf:"], undefined);
    assert.equal(resultBanned.emotes["SoStylish"], undefined);
    assert.ok(resultBanned.emotes["SourPls"]);
    assert.ok(resultBanned.emotes["ZrehplaR"]);
});

test("EmoteHelper - cache respects TTL and refresh forces update", async () => {
    let callCount = 0;
    const mockFetch = createMockFetch({
        "api.betterttv.net/3/cached/emotes/global": () => {
            callCount++;
            return {
                ok: true,
                status: 200,
                json: async () => MOCK_BTTV_GLOBAL
            };
        },
        "api.frankerfacez.com/v1/set/global": () => ({
            ok: true,
            status: 200,
            json: async () => MOCK_FFZ_GLOBAL
        })
    });

    const helper = new EmoteHelper({ ttlMs: 10000, fetchFn: mockFetch });

    // Initial fetch
    await helper.getEmotes();
    assert.equal(callCount, 1);

    // Immediate second fetch uses cache
    await helper.getEmotes();
    assert.equal(callCount, 1);

    // Manual refresh forces re-fetching
    await helper.refresh();
    assert.equal(callCount, 2);
});

test("replaceEmotesInText - tokenizes and replaces allowed emotes safely", () => {
    const emoteMap = {
        ":tf:": {
            code: ":tf:",
            url: "https://cdn.betterttv.net/emote/bttv_1/3x"
        },
        "SoStylish": {
            code: "SoStylish",
            url: "https://cdn.frankerfacez.com/emote/81792/4"
        }
    };

    // Standard message with space separation
    const input1 = "Look at this SoStylish emote!";
    const output1 = replaceEmotesInText(input1, emoteMap);
    assert.equal(
        output1,
        'Look at this <img class="emote" src="https://cdn.frankerfacez.com/emote/81792/4" alt="SoStylish" title="SoStylish"> emote!'
    );

    // Punctuation emote
    const input2 = "Trolling :tf: again";
    const output2 = replaceEmotesInText(input2, emoteMap);
    assert.equal(
        output2,
        'Trolling <img class="emote" src="https://cdn.betterttv.net/emote/bttv_1/3x" alt=":tf:" title=":tf:"> again'
    );

    // Untrusted HTML input is escaped
    const input3 = "<script>alert(1)</script> SoStylish <img onerror='evil()'>";
    const output3 = replaceEmotesInText(input3, emoteMap);
    assert.ok(!output3.includes("<script>"));
    assert.ok(output3.includes("&lt;script&gt;"));
    assert.ok(output3.includes("&lt;img onerror=&#039;evil()&#039;&gt;"));
    assert.ok(output3.includes('class="emote"'));
});

test("Security - !refreshemotes is broadcaster-only and ignored for other users", async () => {
    const { messageHandler } = await import("../../Kiara_bot.js");

    // Non-broadcaster attempting !refreshemotes
    await messageHandler({
        chatter_user_id: "12345",
        chatter_user_name: "viewer",
        chatter_user_login: "viewer",
        message: { text: "!refreshemotes" },
        badges: [{ set_id: "vip", id: "1" }]
    });

    // Broadcaster attempting !refreshemotes
    await messageHandler({
        chatter_user_id: "99999",
        chatter_user_name: "broadcaster",
        chatter_user_login: "broadcaster",
        message: { text: "!refreshemotes" },
        badges: [{ set_id: "broadcaster", id: "1" }]
    });
});

