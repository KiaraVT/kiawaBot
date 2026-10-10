/**
 * Pipeline and resilience utilities for auth, retries, and streak management.
 */

import crypto from "node:crypto";
import querystring from "node:querystring";
import axios from "axios";
import { formatAxiosError, sanitizeAxiosConfig } from "./errorUtils.js";
import {
    parseIsoDateTime,
    isWithinRestartWindow,
    findOldestTimestampKey,
    FIVE_HOURS_MS,
    TEN_MINUTES_MS
} from "./timeUtils.js";

export const TWITCH_AUTH_URL = process.env.TWITCH_AUTH_URL || "https://id.twitch.tv/oauth2/authorize";
export const TWITCH_TOKEN_URL = process.env.TWITCH_TOKEN_URL || "https://id.twitch.tv/oauth2/token";
export const TWITCH_VALIDATE_URL = process.env.TWITCH_VALIDATE_URL || "https://id.twitch.tv/oauth2/validate";
export const TWITCH_API_BASE_URL = process.env.TWITCH_API_BASE_URL || "https://api.twitch.tv/helix";

/**
 * Creates a single-flight mutex runner.
 * Ensures concurrent callers await the active in-flight operation
 * instead of triggering duplicate requests.
 *
 * @returns {(fn: () => Promise<any>) => Promise<any>}
 */
export function createSingleFlightMutex() {
    let inFlight = null;
    return function execute(fn) {
        if (inFlight) {
            return inFlight;
        }
        const promise = Promise.resolve()
            .then(() => fn())
            .finally(() => {
                if (inFlight === promise) {
                    inFlight = null;
                }
            });
        inFlight = promise;
        return inFlight;
    };
}


/**
 * Creates a sequential FIFO mutex lock to serialize operations.
 *
 * @returns {<T>(fn: () => Promise<T>|T) => Promise<T>}
 */
export function createSequentialLock() {
    let tail = Promise.resolve();
    return function acquire(fn) {
        const result = tail.then(() => fn(), () => fn());
        tail = result.catch(() => {});
        return result;
    };
}


/**
 * Executes an async operation with exponential backoff for transient failures.
 *
 * @param {(attempt: number) => Promise<any>} operation
 * @param {object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {(err: any) => boolean} [options.isTransient]
 * @param {(err: any, attempt: number, delayMs: number) => void} [options.onRetry]
 * @param {number} [options.baseDelayMs=1000]
 * @param {number} [options.maxDelayMs=10000]
 * @param {boolean} [options.jitter=true]
 * @returns {Promise<any>}
 */
export async function executeWithBackoff(operation, options = {}) {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 10000;
    const isTransient = options.isTransient ?? ((err) => {
        const status = err?.response?.status;
        return !err?.response || [429, 500, 502, 503, 504].includes(status);
    });
    const onRetry = options.onRetry ?? (() => {});

    let attempt = 0;
    while (true) {
        try {
            return await operation(attempt);
        } catch (error) {
            if (attempt < maxRetries && isTransient(error)) {
                attempt += 1;
                const rawDelay = Math.min(Math.pow(2, attempt) * baseDelayMs, maxDelayMs);
                const jitterFactor = options.jitter === false ? 1 : (0.8 + Math.random() * 0.4);
                const delayMs = Math.round(rawDelay * jitterFactor);
                onRetry(error, attempt, delayMs);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            throw error;
        }
    }
}


/**
 * Update streaks safely upon stream start.
 *
 * @param {string} streakPath
 * @param {string} startedAtStr
 * @param {object} [io]
 * @param {(path: string) => any} [io.readFn]
 * @param {(path: string, data: any, opts?: any) => void} [io.writeFn]
 * @param {() => void} [io.onStreakReset]
 * @returns {{ updated: boolean, reason?: string }}
 */
export function processStreamStartStreak(streakPath, startedAtStr, io = {}) {
    if (!startedAtStr || typeof startedAtStr !== "string") {
        return { updated: false, reason: "missing_started_at" };
    }
    const currentStart = parseIsoDateTime(startedAtStr);
    if (!currentStart) {
        return { updated: false, reason: "invalid_started_at_date" };
    }

    let streakList = null;
    if (io.readFn) {
        try {
            streakList = io.readFn(streakPath);
        } catch (e) {
            if (e?.code === "ENOENT" || e?.name === "NotFoundError") {
                streakList = null;
            } else {
                console.error(`[Streaks] Error reading streak file from ${streakPath}:`, e?.message || String(e));
                return { updated: false, reason: "read_error" };
            }
        }
    }

    const writeFn = io.writeFn || (() => {});

    if (!streakList || typeof streakList !== "object") {
        const initial = {
            Last_Stream: { Start: startedAtStr, End: "" },
            Current_Stream: { Start: startedAtStr },
            Users: {}
        };
        writeFn(streakPath, initial, { spaces: 2, EOL: "\n" });
        return { updated: true, reason: "initialized_new_file" };
    }

    streakList = typeof globalThis.structuredClone === "function"
        ? globalThis.structuredClone(streakList)
        : JSON.parse(JSON.stringify(streakList));

    if (!streakList.Last_Stream) {
        streakList.Last_Stream = { Start: startedAtStr, End: "" };
    }
    if (!streakList.Current_Stream) {
        streakList.Current_Stream = { Start: startedAtStr };
    }
    if (!streakList.Users) {
        streakList.Users = {};
    }

    if (streakList.Current_Stream.Start) {
        const currentStreamStart = parseIsoDateTime(streakList.Current_Stream.Start);
        if (isWithinRestartWindow(currentStreamStart, currentStart, FIVE_HOURS_MS)) {
            return { updated: false, reason: "restarted_within_window" };
        }
    }

    const lastStart = parseIsoDateTime(streakList.Last_Stream.Start);
    const lastEnd = parseIsoDateTime(streakList.Last_Stream.End);
    const backupEnd = parseIsoDateTime(streakList.Last_Stream.Backup_End);

    if (!lastEnd) {
        streakList.Last_Stream.Start = streakList.Current_Stream.Start;
        streakList.Current_Stream.Start = startedAtStr;
        writeFn(streakPath, streakList, { spaces: 2, EOL: "\n" });
        return { updated: true, reason: "null_last_end" };
    }

    if (isWithinRestartWindow(backupEnd, currentStart, FIVE_HOURS_MS)) {
        return { updated: false, reason: "started_shortly_after_last" };
    }

    if (backupEnd && lastStart && backupEnd < lastStart) {
        streakList.Last_Stream.End = "";
        streakList.Last_Stream.Start = streakList.Current_Stream.Start;
        streakList.Current_Stream.Start = startedAtStr;
        writeFn(streakPath, streakList, { spaces: 2, EOL: "\n" });

        return { updated: true, reason: "end_detection_failed" };
    }

    streakList.Last_Stream.Start = streakList.Current_Stream.Start;
    streakList.Current_Stream.Start = startedAtStr;
    streakList.Last_Stream.End = streakList.Last_Stream.Backup_End || "";
    if (io.onStreakReset) {
        io.onStreakReset();
    }
    writeFn(streakPath, streakList, { spaces: 2, EOL: "\n" });
    return { updated: true, reason: "standard_update" };
}

/**
 * Validates command arguments safely without throwing or producing NaN.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {{ valid: boolean, error?: string, [key: string]: any }}
 */
export function validateCommandArguments(command, args) {
    if (!Array.isArray(args)) {
        return { valid: false, error: "invalid_arguments" };
    }

    if (command === "!addcommand" || command === "!editcommand") {
        if (!args[1] || args.length < 3) {
            return { valid: false, error: `Usage: ${command} <tag> <response>` };
        }
        const tag = String(args[1]).trim().toLowerCase().replace(/^!/, "");
        const text = args.slice(2).join(" ").trim();
        if (!tag || !text) {
            return { valid: false, error: `Usage: ${command} <tag> <response>` };
        }
        return { valid: true, tag, text };
    }


    if (command === "!updateincentive") {
        if (!args[1] || args.length < 3) {
            return { valid: false, error: "Usage: !updateincentive <command> <goal>" };
        }
        const identifier = "!" + String(args[1]).trim().toLowerCase().replace(/^!/, "");
        const goal = Number(args.slice(2).join(" "));
        if (!Number.isFinite(goal) || goal <= 0) {
            return { valid: false, error: "Incentive goal must be a positive number." };
        }
        return { valid: true, identifier, goal };
    }


    if (command === "!addincentive") {
        if (!args[1]) {
            return { valid: false, error: "Usage: !addincentive <amount>" };
        }
        const amount = Number(args.slice(1).join(" "));
        if (!Number.isFinite(amount)) {
            return { valid: false, error: "Incentive amount must be a valid number." };
        }
        return { valid: true, amount };
    }

    return { valid: true };
}

/**
 * Twitch authentication pipeline coordinator.
 * Manages token lifecycle, single-flight mutual exclusion, validation,
 * automatic backoff retries, and scoped OAuth account routing.
 */
export class TwitchAuthPipeline {
    /**
     * @param {object} [options]
     * @param {any} [options.authData]
     * @param {any} [options.axios]
     * @param {string} [options.clientId]
     * @param {string} [options.clientSecret]
     * @param {string} [options.redirectUri]
     * @param {string[]|string} [options.scopes]
     * @param {string} [options.tokenUrl]
     * @param {string} [options.validateUrl]
     * @param {string} [options.authUrl]
     * @param {number} [options.cooldownMs]
     * @param {() => void} [options.onInitialValidation]
     * @param {(reason: string, authUrl: string, accountKey?: string, accountName?: string) => Promise<void>|void} [options.notifyAuthRequired]
     */
    constructor(options = {}) {
        this.authData = options.authData;
        this.axios = options.axios || axios;
        this.clientId = options.clientId || process.env.TWITCH_CLIENT_ID || "";
        this.clientSecret = options.clientSecret || process.env.TWITCH_CLIENT_SECRET || "";
        this.redirectUri = options.redirectUri || process.env.TWITCH_REDIRECT_URI || "http://localhost:3000";
        this.scopes = options.scopes || [];
        this.tokenUrl = options.tokenUrl || TWITCH_TOKEN_URL;
        this.validateUrl = options.validateUrl || TWITCH_VALIDATE_URL;
        this.authUrl = options.authUrl || TWITCH_AUTH_URL;
        this.cooldownMs = options.cooldownMs ?? 60000;
        this.onInitialValidation = options.onInitialValidation || (() => {});
        this.notifyAuthRequired = options.notifyAuthRequired || (() => {});

        this.broadcasterAuthReady = false;
        this.botAuthReady = false;
        this.initialValidationHandled = false;
        this.isValidating = false;

        this.lastRefreshBroadcasterAttempt = 0;
        this.lastRefreshBotAttempt = 0;

        this.singleFlightBroadcaster = createSingleFlightMutex();
        this.singleFlightBot = createSingleFlightMutex();
        this.ensureBroadcasterSingleFlight = createSingleFlightMutex();
        this.ensureBotSingleFlight = createSingleFlightMutex();
        this.validateSingleFlight = createSingleFlightMutex();

        this.activeAuthStates = new Map();
        this.maxActiveAuthStates = options.maxActiveAuthStates ?? 100;
    }

    /**
     * Generates an authorization URL bound to a state nonce and optional code_challenge.
     *
     * @param {string} stateNonce
     * @param {string} [codeChallenge]
     * @returns {string}
     */
    buildAuthUrl(stateNonce, codeChallenge = null) {
        const scopeStr = Array.isArray(this.scopes) ? this.scopes.join(" ") : String(this.scopes || "");
        const queryParams = {
            response_type: "code",
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            scope: scopeStr,
            state: stateNonce
        };
        if (codeChallenge) {
            queryParams.code_challenge = codeChallenge;
            queryParams.code_challenge_method = "S256";
        }
        const authQueryString = querystring.stringify(queryParams);
        return `${this.authUrl}?${authQueryString}`;
    }

    /**
     * Purges expired auth states older than 10 minutes.
     */
    cleanupExpiredAuthStates() {
        const now = Date.now();
        for (const [nonce, session] of this.activeAuthStates.entries()) {
            if (now - session.createdAt > TEN_MINUTES_MS) {
                this.activeAuthStates.delete(nonce);
            }
        }
    }

    /**
     * Initiates OAuth consent flow for a given account.
     *
     * @param {string} [reason]
     * @param {string} [accountKey]
     * @param {string} [accountName]
     * @returns {Promise<{ started: boolean, pending: boolean, authUrl: string }>}
     */
    async startAuth(reason = "Twitch Authorization Needed", accountKey = "twitchBroadcaster", accountName = "Broadcaster") {
        this.cleanupExpiredAuthStates();
        while (this.activeAuthStates.size >= this.maxActiveAuthStates) {
            const oldestNonceKey = findOldestTimestampKey(this.activeAuthStates);
            if (!oldestNonceKey) {
                // Map contains no entries to purge
                break;
            }
            this.activeAuthStates.delete(oldestNonceKey);
        }
        for (const [nonce, session] of this.activeAuthStates.entries()) {
            if (session.accountKey === accountKey && (Date.now() - session.createdAt < 60000)) {
                const pendingAuthUrl = this.buildAuthUrl(nonce, session.codeChallenge);
                console.warn(`[Auth] Authorization prompt already active for ${accountName}; re-surfacing pending authorization URL.`);
                await this.notifyAuthRequired(`[${accountName}] ${reason} (pending)`, pendingAuthUrl, accountKey, accountName);
                return { started: false, pending: true, authUrl: pendingAuthUrl };
            }
        }
        const nonce = crypto.randomBytes(32).toString("hex");
        const codeVerifier = crypto.randomBytes(32).toString("base64url");
        const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
        this.activeAuthStates.set(nonce, {
            accountKey,
            accountName,
            createdAt: Date.now(),
            codeVerifier,
            codeChallenge
        });
        const authUrl = this.buildAuthUrl(nonce, codeChallenge);
        await this.notifyAuthRequired(`[${accountName}] ${reason}`, authUrl, accountKey, accountName);
        return { started: true, pending: false, authUrl };
    }

    /**
     * Exchanges an authorization code for access and refresh tokens.
     *
     * @param {string} code
     * @param {string} [codeVerifier]
     * @returns {Promise<any>}
     */
    async exchangeCodeForAccessToken(code, codeVerifier = null) {
        const postData = {
            grant_type: "authorization_code",
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: this.redirectUri,
            code
        };
        if (codeVerifier) {
            postData.code_verifier = codeVerifier;
        }
        try {
            const response = await this.axios.post(this.tokenUrl, postData);
            return response.data;
        } catch (error) {
            if (error?.config) {
                error.config = sanitizeAxiosConfig(error.config, { clone: true });
            }
            throw error;
        }
    }

    /**
     * Handles incoming OAuth callback and routes tokens to the bound account.
     *
     * @param {string} code
     * @param {string} state
     * @returns {Promise<{ status: number, accountKey?: string, accountName?: string, tokenData?: any, message?: string, error?: string }>}
     */
    async handleOAuthCallback(code, state) {
        this.cleanupExpiredAuthStates();
        const authSession = state ? this.activeAuthStates.get(state) : null;
        if (!authSession) {
            return {
                status: 400,
                error: "Authorization failed: invalid or expired state parameter."
            };
        }

        const { accountKey, accountName, codeVerifier } = authSession;
        this.activeAuthStates.delete(state);

        try {
            const tokenData = await this.exchangeCodeForAccessToken(code, codeVerifier);
            if (this.authData) {
                this.authData.update(`${accountKey}.access_token`, tokenData.access_token, true, true);
                this.authData.update(`${accountKey}.refresh_token`, tokenData.refresh_token, true, true);
            }
            if (accountKey === "twitchBroadcaster") {
                this.broadcasterAuthReady = true;
            } else if (accountKey === "twitchBot") {
                this.botAuthReady = true;
            }
            return {
                status: 200,
                accountKey,
                accountName,
                tokenData,
                message: `You're now Authorized for ${accountName}! You can close this tab and return to the bot`
            };
        } catch (error) {
            if (accountKey === "twitchBroadcaster") {
                this.broadcasterAuthReady = false;
            } else if (accountKey === "twitchBot") {
                this.botAuthReady = false;
            }
            return {
                status: 500,
                accountKey,
                accountName,
                error: error.message || "Token exchange failed"
            };
        }
    }

    /**
     * Refreshes a single account token with backoff.
     *
     * @param {string} accountKey
     * @param {string} accountName
     * @returns {Promise<{ refreshed: boolean, reason?: string, status?: number, data?: any, error?: any, authRequired?: boolean }>}
     */
    async refreshSingleToken(accountKey, accountName) {
        const refreshToken = this.authData?.read?.(`${accountKey}.refresh_token`);
        if (!refreshToken) {
            if (accountKey === "twitchBroadcaster") this.broadcasterAuthReady = false;
            if (accountKey === "twitchBot") this.botAuthReady = false;
            return { refreshed: false, reason: "missing_refresh_token", authRequired: true };
        }

        const postData = {
            grant_type: "refresh_token",
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: refreshToken
        };

        try {
            return await executeWithBackoff(
                async () => {
                    const response = await this.axios.post(this.tokenUrl, postData);
                    if (this.authData) {
                        this.authData.update(`${accountKey}.access_token`, response.data.access_token, true, true);
                        this.authData.update(`${accountKey}.refresh_token`, response.data.refresh_token, true, true);
                    }
                    if (accountKey === "twitchBroadcaster") this.broadcasterAuthReady = true;
                    if (accountKey === "twitchBot") this.botAuthReady = true;
                    return { refreshed: true, data: response.data, authRequired: false };
                },
                {
                    maxRetries: 3,
                    baseDelayMs: 1000,
                    onRetry: (err, attempt, delayMs) => {
                        console.warn(`[Auth] Transient error refreshing ${accountName} token (${formatAxiosError(err)}). Retrying in ${delayMs}ms (attempt ${attempt}/3)...`);
                    }
                }
            );
        } catch (error) {
            if (error?.config) {
                error.config = sanitizeAxiosConfig(error.config, { clone: true });
            }
            if (error?.response?.config) {
                error.response.config = sanitizeAxiosConfig(error.response.config, { clone: true });
            }
            const status = error?.response?.status;
            if (status === 400 || status === 401 || status === 403) {
                if (accountKey === "twitchBroadcaster") this.broadcasterAuthReady = false;
                if (accountKey === "twitchBot") this.botAuthReady = false;
                return { refreshed: false, reason: "permanent_failure", status, authRequired: true };
            }
            return { refreshed: false, reason: "transient_retry_exhausted", error, authRequired: false };
        }
    }

    /**
     * Refreshes a designated account and prompts auth if required.
     *
     * @param {string} accountKey
     * @param {string} accountName
     * @returns {Promise<any>}
     */
    async refreshAccount(accountKey, accountName) {
        if (accountKey === "twitchBroadcaster") {
            const res = await this.singleFlightBroadcaster(() => this.refreshSingleToken("twitchBroadcaster", accountName));
            if (res.authRequired) {
                await this.startAuth(`${accountName} (${res.reason})`, "twitchBroadcaster", accountName);
            }
            return res;
        }

        const res = await this.singleFlightBot(() => this.refreshSingleToken("twitchBot", accountName));
        if (res.authRequired) {
            await this.startAuth(`${accountName} (${res.reason})`, "twitchBot", accountName);
        }
        return res;
    }

    /**
     * Refreshes access tokens for both broadcaster and bot accounts.
     *
     * @returns {Promise<{ broadcaster: any, bot: any, authPrompted: boolean }>}
     */
    async refreshAccessToken() {
        const broadcaster = await this.singleFlightBroadcaster(() => this.refreshSingleToken("twitchBroadcaster", "Broadcaster"));
        const bot = await this.singleFlightBot(() => this.refreshSingleToken("twitchBot", "Bot"));

        let authPrompted = false;
        if (broadcaster.authRequired || bot.authRequired) {
            authPrompted = true;
            if (broadcaster.authRequired) {
                await this.startAuth(`Broadcaster (${broadcaster.reason})`, "twitchBroadcaster", "Broadcaster");
            }
            if (bot.authRequired) {
                await this.startAuth(`Bot (${bot.reason})`, "twitchBot", "Bot");
            }
        }

        return { broadcaster, bot, authPrompted };
    }

    /**
     * Validates a single account against the Twitch validate endpoint.
     *
     * @param {string} accountKey
     * @param {string} accountName
     * @returns {Promise<boolean>}
     */
    async validateSingleAccount(accountKey, accountName, autoRefresh = true) {
        const token = this.authData?.read?.(`${accountKey}.access_token`);
        try {
            await this.axios.get(this.validateUrl, {
                headers: { Authorization: "Bearer " + (token || "") }
            });
            if (accountKey === "twitchBroadcaster") this.broadcasterAuthReady = true;
            if (accountKey === "twitchBot") this.botAuthReady = true;
            return true;
        } catch (error) {
            console.warn(`[Auth] Unable to validate ${accountName} token:`, formatAxiosError(error));
            if (accountKey === "twitchBroadcaster") this.broadcasterAuthReady = false;
            if (accountKey === "twitchBot") this.botAuthReady = false;
            if (autoRefresh) {
                const refreshRes = await this.refreshAccount(accountKey, accountName);
                if (refreshRes?.refreshed) {
                    if (accountKey === "twitchBroadcaster") this.broadcasterAuthReady = true;
                    if (accountKey === "twitchBot") this.botAuthReady = true;
                    return true;
                }
            }
            return false;
        }
    }

    /**
     * Validates both accounts and fires initial validation callback on success.
     * Validations run in parallel, while any necessary token refreshes run sequentially.
     *
     * @returns {Promise<void>}
     */
    async validateAccessToken() {
        return this.validateSingleFlight(async () => {
            const [broadcasterResult, botResult] = await Promise.allSettled([
                this.validateSingleAccount("twitchBroadcaster", "Broadcaster", false),
                this.validateSingleAccount("twitchBot", "Bot", false)
            ]);

            const broadcasterValid = broadcasterResult.status === "fulfilled" && broadcasterResult.value;
            const botValid = botResult.status === "fulfilled" && botResult.value;

            if (!broadcasterValid) {
                await this.refreshAccount("twitchBroadcaster", "Broadcaster");
            }
            if (!botValid) {
                await this.refreshAccount("twitchBot", "Bot");
            }

            if (this.broadcasterAuthReady && this.botAuthReady) {
                if (!this.initialValidationHandled) {
                    this.initialValidationHandled = true;
                    this.onInitialValidation();
                }
            }
        });
    }

    /**
     * Ensures broadcaster authorization is ready, refreshing if needed.
     *
     * @returns {Promise<boolean>}
     */
    async ensureBroadcasterAuth() {
        if (this.broadcasterAuthReady) return true;
        return this.ensureBroadcasterSingleFlight(async () => {
            if (this.broadcasterAuthReady) return true;
            const now = Date.now();
            if (now - this.lastRefreshBroadcasterAttempt > this.cooldownMs) {
                this.lastRefreshBroadcasterAttempt = now;
                const refreshRes = await this.refreshAccount("twitchBroadcaster", "Broadcaster");
                if (refreshRes?.refreshed) {
                    this.broadcasterAuthReady = true;
                    return true;
                }
            }
            return false;
        });
    }

    /**
     * Ensures bot authorization is ready, refreshing if needed.
     *
     * @returns {Promise<boolean>}
     */
    async ensureBotAuth() {
        if (this.botAuthReady) return true;
        return this.ensureBotSingleFlight(async () => {
            if (this.botAuthReady) return true;
            const now = Date.now();
            if (now - this.lastRefreshBotAttempt > this.cooldownMs) {
                this.lastRefreshBotAttempt = now;
                const refreshRes = await this.refreshAccount("twitchBot", "Bot");
                if (refreshRes?.refreshed) {
                    this.botAuthReady = true;
                    return true;
                }
            }
            return false;
        });
    }

    /**
     * Wraps an API request with automatic 401 retry, token refresh, and URL redaction.
     *
     * @param {string} accountKey
     * @param {string} accountName
     * @param {(isRetry: boolean) => Promise<any>} requestFn
     * @returns {Promise<any>}
     */
    async withAuthRetry(accountKey, accountName, requestFn) {
        const isReady = accountKey === "twitchBroadcaster"
            ? await this.ensureBroadcasterAuth()
            : await this.ensureBotAuth();

        if (!isReady) {
            throw new Error("twitch not yet authorized, wait a bit and try again");
        }

        try {
            return await requestFn(false);
        } catch (error) {
            if (error?.response?.status === 401) {
                console.info(`[Auth] ${accountName} token expired (401), refreshing token...`);
                if (accountKey === "twitchBroadcaster") {
                    this.broadcasterAuthReady = false;
                } else {
                    this.botAuthReady = false;
                }

                try {
                    const refreshRes = await this.refreshAccount(accountKey, accountName);
                    if (refreshRes?.refreshed) {
                        if (accountKey === "twitchBroadcaster") {
                            this.broadcasterAuthReady = true;
                            this.lastRefreshBroadcasterAttempt = Date.now();
                        }
                        if (accountKey === "twitchBot") {
                            this.botAuthReady = true;
                            this.lastRefreshBotAttempt = Date.now();
                        }
                        return await requestFn(true);
                    }
                } catch (refreshErr) {
                    console.error(`[Auth] Refresh failed during retry for ${accountName}:`, formatAxiosError(refreshErr));
                }
            }

            if (error?.response?.status === 400) {
                console.warn("[API] Bad Request (400):", error.response.data?.message || "Bad Request");
            }
            if (error?.config) {
                error.config = sanitizeAxiosConfig(error.config);
            }
            if (error?.response?.config) {
                error.response.config = sanitizeAxiosConfig(error.response.config);
            }
            if (error?.request && typeof error.request === "object") {
                if (typeof error.request._header === "string") {
                    const redactedHeader = error.request._header.replace(/(Authorization:\s*Bearer\s+)[^\r\n]+/gi, "$1[REDACTED]");
                    error.request = { ...error.request, _header: redactedHeader };
                }
            }
            throw error;
        }
    }
}

