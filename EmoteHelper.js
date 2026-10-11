/**
 * @file EmoteHelper.js
 * Service for fetching, aggregating, and filtering FrankerFaceZ and BetterTTV emotes.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const BTTV_GLOBAL_URL = "https://api.betterttv.net/3/cached/emotes/global";
const BTTV_CHANNEL_URL = "https://api.betterttv.net/3/cached/users/twitch/";
const BTTV_CDN_BASE = "https://cdn.betterttv.net/emote/";
const FFZ_GLOBAL_URL = "https://api.frankerfacez.com/v1/set/global";
const FFZ_ROOM_ID_URL = "https://api.frankerfacez.com/v1/room/id/";
const FFZ_ROOM_NAME_URL = "https://api.frankerfacez.com/v1/room/";

/**
 * Escapes unsafe HTML characters to prevent cross-site scripting (XSS).
 *
 * @param {string} unsafe - Raw text.
 * @returns {string} Sanitized text.
 */
export function escapeHtml(unsafe) {
    if (typeof unsafe !== "string") return "";
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Normalizes FrankerFaceZ URLs by adding https: protocol if protocol-relative.
 *
 * @param {string|null|undefined} rawUrl - Image URL from API.
 * @returns {string} Fully qualified URL.
 */
export function normalizeFfzUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    if (rawUrl.startsWith("//")) {
        return `https:${rawUrl}`;
    }
    return rawUrl;
}

/**
 * Selects highest available resolution from FFZ urls object (4x > 2x > 1x).
 *
 * @param {Record<string, string>} urls - URLs keyed by scale.
 * @returns {string} Chosen normalized URL.
 */
export function pickHighestFfzUrl(urls) {
    if (!urls || typeof urls !== "object") return "";
    const chosen = urls["4"] || urls["2"] || urls["1"] || "";
    return normalizeFfzUrl(chosen);
}

/**
 * Replaces known emote tokens in a chat text string with HTML img elements.
 * Unmatched tokens and whitespace are safely preserved and HTML-escaped.
 *
 * @param {string} text - Raw input message text.
 * @param {Record<string, { code: string, url: string }>} emoteMap - Allowed emotes.
 * @returns {string} Safe formatted HTML string.
 */
export function replaceEmotesInText(text, emoteMap) {
    if (typeof text !== "string" || !text) return "";
    if (!emoteMap || typeof emoteMap !== "object") {
        return escapeHtml(text);
    }

    const tokens = text.split(/(\s+)/);
    const resultParts = tokens.map((token) => {
        if (!token) return "";
        if (/^\s+$/.test(token)) return token;

        const emote = emoteMap[token];
        if (emote && emote.url) {
            const escapedCode = escapeHtml(token);
            const escapedUrl = escapeHtml(emote.url);
            return `<img class="emote" src="${escapedUrl}" alt="${escapedCode}" title="${escapedCode}">`;
        }

        return escapeHtml(token);
    });

    return resultParts.join("");
}

export default class EmoteHelper {
    /**
     * @param {object} [options] - Configuration options.
     * @param {boolean} [options.enableGlobalFFZ=true] - Enable FFZ global emotes.
     * @param {boolean} [options.enableGlobalBTTV=true] - Enable BTTV global emotes.
     * @param {string[]} [options.channels=[]] - Channel IDs to fetch channel emotes.
     * @param {string[]} [options.banList=[]] - Single unified ban list of emote codes.
     * @param {string[]} [options.denyList=[]] - Alias for banList.
     * @param {number} [options.ttlMs=1800000] - Cache time-to-live in ms.
     * @param {typeof fetch} [options.fetchFn] - Custom fetch implementation for testing.
     */
    constructor(options = {}) {
        this.enableGlobalFFZ = options.enableGlobalFFZ !== false;
        this.enableGlobalBTTV = options.enableGlobalBTTV !== false;
        this.channels = Array.isArray(options.channels) ? [...options.channels] : [];
        const initialBans = options.banList || options.denyList || [];
        this.banList = new Set(Array.isArray(initialBans) ? initialBans : []);
        this.ttlMs = typeof options.ttlMs === "number" ? options.ttlMs : DEFAULT_TTL_MS;
        this.fetchFn = options.fetchFn || globalThis.fetch;
        this.cachedData = null;
        this.lastFetchTime = 0;
    }

    /**
     * Checks if an emote code is present in the unified ban list.
     *
     * @param {string} code - Emote code.
     * @returns {boolean} True if banned.
     */
    isBanned(code) {
        if (!code || typeof code !== "string") return true;
        return this.banList.has(code);
    }

    /**
     * Alias for isBanned for backward compatibility.
     *
     * @param {string} code - Emote code.
     * @returns {boolean} True if denied.
     */
    isDenied(code) {
        return this.isBanned(code);
    }

    /**
     * Fetches and parses global BTTV emotes.
     *
     * @returns {Promise<Array<{ id: string, code: string, url: string, source: "bttv", animated: boolean }>>}
     */
    async fetchBttvGlobal() {
        if (!this.enableGlobalBTTV) return [];
        try {
            const res = await this.fetchFn(BTTV_GLOBAL_URL);
            if (!res.ok) return [];
            const data = await res.json();
            if (!Array.isArray(data)) return [];

            return data
                .filter((item) => item?.id && item?.code && !this.isBanned(item.code))
                .map((item) => ({
                    id: String(item.id),
                    code: String(item.code),
                    url: `${BTTV_CDN_BASE}${item.id}/3x`,
                    source: "bttv",
                    animated: Boolean(item.animated)
                }));
        } catch (err) {
            console.error(`[EmoteHelper] Error fetching BTTV global: ${err?.message || err}`);
            return [];
        }
    }

    /**
     * Fetches and parses global FFZ emotes.
     *
     * @returns {Promise<Array<{ id: number, code: string, url: string, source: "ffz", animated: boolean }>>}
     */
    async fetchFfzGlobal() {
        if (!this.enableGlobalFFZ) return [];
        try {
            const res = await this.fetchFn(FFZ_GLOBAL_URL);
            if (!res.ok) return [];
            const data = await res.json();
            const defaultSets = Array.isArray(data?.default_sets) ? data.default_sets : [];
            const sets = data?.sets || {};
            const emotes = [];

            for (const setId of defaultSets) {
                const set = sets[String(setId)];
                if (!Array.isArray(set?.emoticons)) continue;
                for (const item of set.emoticons) {
                    if (!item?.id || !item?.name || this.isBanned(item.name)) continue;
                    const url = pickHighestFfzUrl(item.urls);
                    if (url) {
                        emotes.push({
                            id: item.id,
                            code: String(item.name),
                            url,
                            source: "ffz",
                            animated: Boolean(item.animated)
                        });
                    }
                }
            }
            return emotes;
        } catch (err) {
            console.error(`[EmoteHelper] Error fetching FFZ global: ${err?.message || err}`);
            return [];
        }
    }

    /**
     * Fetches channel-specific BTTV emotes.
     *
     * @param {string} channelId - Broadcaster Twitch ID.
     * @returns {Promise<Array<{ id: string, code: string, url: string, source: "bttv", animated: boolean }>>}
     */
    async fetchBttvChannel(channelId) {
        if (!channelId) return [];
        try {
            const res = await this.fetchFn(`${BTTV_CHANNEL_URL}${encodeURIComponent(channelId)}`);
            if (!res.ok) return [];
            const data = await res.json();
            const combined = [
                ...(Array.isArray(data?.channelEmotes) ? data.channelEmotes : []),
                ...(Array.isArray(data?.sharedEmotes) ? data.sharedEmotes : [])
            ];

            return combined
                .filter((item) => item?.id && item?.code && !this.isBanned(item.code))
                .map((item) => ({
                    id: String(item.id),
                    code: String(item.code),
                    url: `${BTTV_CDN_BASE}${item.id}/3x`,
                    source: "bttv",
                    animated: Boolean(item.animated)
                }));
        } catch (err) {
            console.error(`[EmoteHelper] Error fetching BTTV channel ${channelId}: ${err?.message || err}`);
            return [];
        }
    }

    /**
     * Fetches channel-specific FFZ emotes.
     *
     * @param {string} channelId - Broadcaster Twitch ID or username.
     * @returns {Promise<Array<{ id: number, code: string, url: string, source: "ffz", animated: boolean }>>}
     */
    async fetchFfzChannel(channelId) {
        if (!channelId) return [];
        try {
            const isNumeric = /^\d+$/.test(String(channelId));
            const baseUrl = isNumeric ? FFZ_ROOM_ID_URL : FFZ_ROOM_NAME_URL;
            const res = await this.fetchFn(`${baseUrl}${encodeURIComponent(channelId)}`);
            if (!res.ok) return [];
            const data = await res.json();
            const sets = data?.sets || {};
            const emotes = [];

            for (const setKey of Object.keys(sets)) {
                const set = sets[setKey];
                if (!Array.isArray(set?.emoticons)) continue;
                for (const item of set.emoticons) {
                    if (!item?.id || !item?.name || this.isBanned(item.name)) continue;
                    const url = pickHighestFfzUrl(item.urls);
                    if (url) {
                        emotes.push({
                            id: item.id,
                            code: String(item.name),
                            url,
                            source: "ffz",
                            animated: Boolean(item.animated)
                        });
                    }
                }
            }
            return emotes;
        } catch (err) {
            console.error(`[EmoteHelper] Error fetching FFZ channel ${channelId}: ${err?.message || err}`);
            return [];
        }
    }

    /**
     * Refreshes the emote cache by querying all active sources.
     *
     * @returns {Promise<{ emotes: Record<string, object>, channels: string[], updatedAt: string }>}
     */
    async refresh() {
        const fetchTasks = [
            this.fetchBttvGlobal(),
            this.fetchFfzGlobal()
        ];

        for (const channel of this.channels) {
            fetchTasks.push(this.fetchBttvChannel(channel));
            fetchTasks.push(this.fetchFfzChannel(channel));
        }

        const taskResults = await Promise.allSettled(fetchTasks);
        const aggregated = {};

        for (const result of taskResults) {
            if (result.status === "fulfilled" && Array.isArray(result.value)) {
                for (const emote of result.value) {
                    if (emote?.code) {
                        aggregated[emote.code] = emote;
                    }
                }
            }
        }

        this.cachedData = {
            emotes: aggregated,
            channels: [...this.channels],
            banList: Array.from(this.banList),
            updatedAt: new Date().toISOString()
        };
        this.lastFetchTime = Date.now();
        return this.cachedData;
    }

    /**
     * Returns cached emotes, refreshing if cache expired or absent.
     *
     * @returns {Promise<{ emotes: Record<string, object>, channels: string[], updatedAt: string }>}
     */
    async getEmotes() {
        const now = Date.now();
        if (this.cachedData && now - this.lastFetchTime < this.ttlMs) {
            return this.cachedData;
        }
        return this.refresh();
    }
}
