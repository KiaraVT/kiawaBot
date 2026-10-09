//load all the required crap
import TES from "tesjs";
import axios from "axios";
import path from 'path';
import jsonfile from "jsonfile";
const quote_Path = './data/quotes.json';
const streak_Path = './data/streaks.json';
const command_Path = './data/command_List.json';
import AuthDataHelper from "./AuthDataHelper.js";
import IncentiveHelper from "./IncentiveHelper.js";
import QuoteHelper, {castIdToNumber} from "./QuoteHelper.js";
import { WebSocketServer } from "ws";
import express from "express"
import { formatAxiosError, redactSensitiveUrl } from "./errorUtils.js";
import {
    createSingleFlightMutex,
    executeWithBackoff,
    processStreamStartStreak,
    validateCommandArguments
} from "./pipelineUtils.js";

import querystring from "qs"
//Include line reading module
import fs from "fs"
import crypto from "crypto"

// Ensure data directory exists
const dataDir = './data';
if (!fs.existsSync(dataDir)) {
    console.log('Creating data directory...');
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize data files if they don't exist
const defaultFiles = [
    { path: quote_Path, content: [] },
    { path: streak_Path, content: {} },
    { path: command_Path, content: [] }
];

defaultFiles.forEach(({ path, content }) => {
    if (!fs.existsSync(path)) {
        console.log(`Creating default ${path}...`);
        try {
            writeAtomicSync(path, content, { spaces: 2, EOL: "\n" });
        } catch (error) {
            console.error(`Failed to create ${path}:`, error);
        }
    }
});

const t1Value = 3.60;
const t2Value = 6.00;
const t3Value = 17.50;
const primeValue = 2.50;
//const t1Value = 1;
//const t2Value = 2;
//const t3Value = 6;
//const primeValue = 1;
const broadcasterID = process.env.BROADCASTER_ID;
const channelName = process.env.BROADCASTER_NAME;
//details for Twitch OAuth
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const yt_clientId = process.env.YT_CLIENT_ID;
const yt_clientSecret = process.env.YT_CLIENT_SECRET;
const botID = process.env.BOT_ID;
const botName = process.env.BOT_NAME;
const INCENTIVEPATH = process.env.INCENTIVE_PATH;
var incentiveAmount;
var incentiveGoal;
const timedCommands = ['discord', 'kofi', 'socials2', 'socials1', 'links', 'patreon', 'youtube', 'archives'];
const scopes = [
    'bits:read',
    'channel:read:subscriptions',
    'channel:read:guest_star',
    'channel:read:goals',
    'channel:read:polls',
    'channel:read:predictions',
    'channel:read:redemptions',
    'channel:read:hype_train',
    'moderator:read:followers',
    'moderator:read:shoutouts',
    'moderation:read',
    'channel:moderate',
    'moderator:manage:banned_users',
    'user:read:chat',
    'channel:bot',
    'user:read:chat',
    'user:write:chat',
    'user:bot',
    'moderator:read:blocked_terms',
    'moderator:read:chat_settings',
    'moderator:read:unban_requests',
    'moderator:read:banned_users',
    'moderator:read:chat_messages',
    'moderator:read:moderators',
    'moderator:read:vips'
];

const yt_scopes = [
];
//Variables for the !server command
var servers = ["the Hyrule", "the BOP", "the Eorzean", "the Aether",
    "Your Mom's ", "the Zebes", "the Adamantoise", "the Atlantis",
    "the South America", "the Greenland", "the Timber Hearth",
    "the Mars", "the US West", "the US East", "the Nibel",
    "the Australia", "the Europe", "the Antarctica"];

//Quote function Allow List
var allow_List = ["baeginning", "caeshura", "chocolatedave", "clockworkophelia",
    "drawize", "feff", "flockhead", "ghoststrike49",
    "ghoul02", "grimelios", "itsjustatank",
    "jayo_exe", "kirbymastah", "mayeginz", "neoashetaka",
    "notsonewby", "ogndrahcir", "orgran", "pancakeninjagames", "porkduckrice", "roosesr",
    "shadomagi", "sheepyamaya", "sigmasin", "kiara_tv", "smashysr", "sonicshadowsilver2",
    "spikevegeta", "stingerpa", "terra21", "thedragonfeeney", "trojandude12", "tsubasaakari",
    "vellhart", "vulajin", "woodenbarrel", "yagamoth", "billyboyrutherford", "violaxcore",
    "keizaron", "myriachan", "smulchypansie", "opheliaway", "sakoneko", "abelltronics17",
    "foung_shui", "eddie", "v0oid", "J_o_n_i_d_T_h_e_1_s_t_", "froggythighs", "lenaflieder", "zoiteki", "shoujo", "justanyia", "shinobufujiko", "minikitty", "pofflecakey", "bobbeigh", "dangers"]

const oAuthPort = 3000;
const redirectUri = 'http://127.0.0.1:' + oAuthPort;

//variables to store auth-related data
let validationTicker = null;
let broadcasterAuthReady = false;
let botAuthReady = false;
let initialValidationHandled = false;
let isValidating = false;
const activeAuthStates = new Map();

function cleanupExpiredAuthStates() {
    const now = Date.now();
    const TTL_MS = 15 * 60 * 1000;
    for (const [nonce, session] of activeAuthStates.entries()) {
        if (now - session.createdAt > TTL_MS) {
            activeAuthStates.delete(nonce);
        }
    }
}

let lastRefreshBroadcasterAttempt = 0;
let lastRefreshBotAttempt = 0;
const REFRESH_COOLDOWN_MS = 10000;

const singleFlightBroadcaster = createSingleFlightMutex();
const singleFlightBot = createSingleFlightMutex();

//setup for server that will listen for OAuth stuff so we can get our Access Token when the user consents
const authListener = express();
let authServerInstance = null;
function ensureAuthListener() {
    if (!authServerInstance) {
        authServerInstance = authListener.listen(oAuthPort, () => {
            console.info(`[Auth] OAuth callback listener active on port ${oAuthPort}`);
        });
    }
}

authListener.get("/", (req, res) => {
    if (!req.query.code) {
        console.warn("[Auth] Received authorization callback without code parameter:", req.query);
        res.status(400).send("Authorization failed: missing authorization code or access denied.");
        return;
    }

    cleanupExpiredAuthStates();
    const stateNonce = req.query.state;
    const authSession = stateNonce ? activeAuthStates.get(stateNonce) : null;

    if (!authSession) {
        console.warn("[Auth] Authorization callback state mismatch or expired nonce:", stateNonce);
        res.status(400).send("Authorization failed: invalid or expired state parameter.");
        return;
    }

    const { accountKey, accountName } = authSession;

    exchangeCodeForAccessToken(req.query.code)
        .then(tokenData => {
            activeAuthStates.delete(stateNonce);
            cancelGracefulAuthExit();
            res.send(`You're now Authorized for ${accountName}!  You can close this tab and return to the bot`);
            authData.update(`${accountKey}.access_token`, tokenData.access_token, true, true);
            authData.update(`${accountKey}.refresh_token`, tokenData.refresh_token, true, true);
            if (accountKey === 'twitchBroadcaster') {
                broadcasterAuthReady = true;
            } else if (accountKey === 'twitchBot') {
                botAuthReady = true;
            }
            validateAccessToken();
            if (validationTicker) {
                clearInterval(validationTicker);
            }
            validationTicker = setInterval(() => { validateAccessToken(); }, 1000 * 600);
        })
        .catch(error => {
            activeAuthStates.delete(stateNonce);
            res.status(500).send("Authorization error: failed to exchange authorization code for access tokens.");
            if (accountKey === 'twitchBroadcaster') {
                broadcasterAuthReady = false;
            } else if (accountKey === 'twitchBot') {
                botAuthReady = false;
            }
            console.error(`[Auth] Token exchange failed for ${accountName}:`, formatAxiosError(error));
        });
});

ensureAuthListener();

function buildAuthUrl(stateNonce) {
    const authQueryString = querystring.stringify({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        state: stateNonce
    });
    return 'https://id.twitch.tv/oauth2/authorize?' + authQueryString;
}

async function notifyAuthRequired(reason, authUrl) {
    const webhookUrl = process.env.AUTH_WEBHOOK_URL;
    if (webhookUrl) {
        try {
            const sanitizedWebhookUrl = authUrl.replace(/([?&]state=)[^&]+/i, "$1[REDACTED]");
            await axios.post(webhookUrl, {
                event: 'auth_required',
                reason: reason,
                auth_url: sanitizedWebhookUrl,
                timestamp: new Date().toISOString()
            }, { timeout: 5000 }).catch(err => {
                console.error('[Auth] Failed to send auth webhook alert:', formatAxiosError(err));
            });
        } catch (e) {
            console.error('[Auth] Webhook dispatch error:', e.message);
        }
    }

    console.info("================================================================================");
    console.info("ACTION REQUIRED: " + reason);
    console.info("Please visit the following URL to authorize the bot:");
    console.info(authUrl);
    console.info("Once authorized, return here and the bot will resume automatically.");
    console.info("================================================================================");
}

function shouldExitOnAuthFailure() {
    const authAction = (process.env.AUTH_FAILURE_ACTION || (process.env.EXIT_ON_AUTH_FAILURE === 'true' ? 'exit' : 'wait')).toLowerCase();
    return authAction === 'exit';
}

function performGracefulExit() {
    console.error("[Auth] Initiating graceful shutdown due to unrecoverable auth requirement (AUTH_FAILURE_ACTION=exit).");
    try {
        authData.saveDataImmediate();
        if (authServerInstance && typeof authServerInstance.close === 'function') {
            authServerInstance.close();
        }
    } catch (cleanupErr) {
        console.error('[Auth] Cleanup error before exit:', cleanupErr.message);
    }
    process.exit(1);
}

let authExitTimer = null;
const AUTH_EXIT_GRACE_PERIOD_MS = parseInt(process.env.AUTH_EXIT_GRACE_PERIOD_MS || "120000", 10);

function scheduleGracefulAuthExit() {
    if (!shouldExitOnAuthFailure()) {
        return;
    }
    if (!authExitTimer) {
        console.warn(`[Auth] AUTH_FAILURE_ACTION=exit configured. Bot will shut down in ${AUTH_EXIT_GRACE_PERIOD_MS / 1000}s if authorization is not completed.`);
        authExitTimer = setTimeout(() => {
            authExitTimer = null;
            if (!broadcasterAuthReady || !botAuthReady) {
                performGracefulExit();
            }
        }, AUTH_EXIT_GRACE_PERIOD_MS);
    }
}

function cancelGracefulAuthExit() {
    if (authExitTimer) {
        console.info('[Auth] Canceling scheduled shutdown: authorization recovered.');
        clearTimeout(authExitTimer);
        authExitTimer = null;
    }
}

//Begin the auth process by opening the user's browser to the consent screen
async function startAuth(reason = "Twitch Authorization Needed", accountKey = "twitchBroadcaster", accountName = "Broadcaster") {
    cleanupExpiredAuthStates();
    for (const session of activeAuthStates.values()) {
        if (session.accountKey === accountKey && (Date.now() - session.createdAt < 60000)) {
            return;
        }
    }
    ensureAuthListener();
    const nonce = crypto.randomBytes(16).toString('hex');
    activeAuthStates.set(nonce, { accountKey, accountName, createdAt: Date.now() });
    const authUrl = buildAuthUrl(nonce);
    await notifyAuthRequired(`[${accountName}] ${reason}`, authUrl);
    if (shouldExitOnAuthFailure()) {
        scheduleGracefulAuthExit();
    }
}


//exchange the authorization code we get from Twitch when the user consents to get an Access Token
function exchangeCodeForAccessToken(code) {
    return new Promise((resolve, reject) => {
        const postData = {
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code: code
        };
        axios.post("https://id.twitch.tv/oauth2/token", postData)
            .then(response => resolve(response.data))
            .catch(error => reject(error));
    });
}

//helper to refresh a single account token with exponential backoff for transient errors
async function refreshSingleToken(accountKey, accountName) {
    const refreshToken = authData.read(`${accountKey}.refresh_token`);
    if (!refreshToken) {
        console.warn(`[Auth] No refresh token found for ${accountName}.`);
        if (accountKey === 'twitchBroadcaster') broadcasterAuthReady = false;
        if (accountKey === 'twitchBot') botAuthReady = false;
        return { refreshed: false, reason: 'missing_refresh_token', authRequired: true };
    }

    const postData = {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken
    };

    console.info(`[Auth] Attempting to refresh Access Token for ${accountName}...`);
    try {
        return await executeWithBackoff(
            async () => {
                const response = await axios.post("https://id.twitch.tv/oauth2/token", postData);
                console.info(`[Auth] Access Token for ${accountName} was successfully refreshed`);
                authData.update(`${accountKey}.access_token`, response.data.access_token, true, true);
                authData.update(`${accountKey}.refresh_token`, response.data.refresh_token, true, true);
                if (accountKey === 'twitchBroadcaster') broadcasterAuthReady = true;
                if (accountKey === 'twitchBot') botAuthReady = true;
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
        const status = error?.response?.status;
        console.error(`[Auth] Unable to refresh Access Token for ${accountName}:`, formatAxiosError(error));
        // Treat HTTP 400, 401, and 403 as non-retryable permanent auth failures
        if (status === 400 || status === 401 || status === 403) {
            console.warn(`[Auth] Permanent auth failure (HTTP ${status}) for ${accountName}. Retaining existing tokens on disk.`);
            if (accountKey === 'twitchBroadcaster') broadcasterAuthReady = false;
            if (accountKey === 'twitchBot') botAuthReady = false;
            return { refreshed: false, reason: 'permanent_failure', status, authRequired: true };
        }
        return { refreshed: false, reason: 'transient_retry_exhausted', error, authRequired: false };
    }
}

//attempt to refresh the Access Token using the Refresh Token
async function refreshAccessToken() {
    // Sequentially execute broadcaster and bot refreshes to avoid parallel token endpoint races
    const broadcaster = await singleFlightBroadcaster(() => refreshSingleToken('twitchBroadcaster', 'Broadcaster'));
    const bot = await singleFlightBot(() => refreshSingleToken('twitchBot', 'Bot'));

    let authPrompted = false;
    if (broadcaster.authRequired || bot.authRequired) {
        authPrompted = true;
        if (validationTicker) {
            clearInterval(validationTicker);
            validationTicker = null;
        }
        if (broadcaster.authRequired) {
            await startAuth(`Broadcaster (${broadcaster.reason})`, 'twitchBroadcaster', 'Broadcaster');
        }
        if (bot.authRequired) {
            await startAuth(`Bot (${bot.reason})`, 'twitchBot', 'Bot');
        }
    }

    return { broadcaster, bot, authPrompted };
}

let transientRetryTimer = null;
function scheduleTransientValidationRetry(delayMs = 15000) {
    if (!transientRetryTimer && (!broadcasterAuthReady || !botAuthReady)) {
        console.info(`[Auth] Scheduling validation retry in ${delayMs / 1000}s due to transient failure...`);
        transientRetryTimer = setTimeout(() => {
            transientRetryTimer = null;
            const now = Date.now();
            lastRefreshBroadcasterAttempt = now;
            lastRefreshBotAttempt = now;
            validateAccessToken();
        }, delayMs);
    }
}

//attempt to validate the Access Token to be sure it is still valid
async function validateAccessToken() {
    if (isValidating) return;
    isValidating = true;

    console.info('[Auth] Attempting to validate Access Token...');

    const validateBroadcaster = axios.get("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: 'Bearer ' + authData.read('twitchBroadcaster.access_token') }
    })
        .then(() => {
            console.info('[Auth] Access Token for Broadcaster was successfully validated');
            broadcasterAuthReady = true;
        })
        .catch(async error => {
            console.warn('[Auth] Unable to validate Broadcaster Access Token:', formatAxiosError(error));
            broadcasterAuthReady = false;
            const refreshRes = await refreshAccessToken();
            if (refreshRes.broadcaster?.refreshed) {
                broadcasterAuthReady = true;
            } else if (refreshRes.broadcaster?.reason === 'transient_retry_exhausted') {
                scheduleTransientValidationRetry();
            }
        });

    const validateBot = axios.get("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: 'Bearer ' + authData.read('twitchBot.access_token') }
    })
        .then(() => {
            console.info('[Auth] Access Token for Bot was successfully validated');
            botAuthReady = true;
        })
        .catch(async error => {
            console.warn('[Auth] Unable to validate Bot Access Token:', formatAxiosError(error));
            botAuthReady = false;
            const refreshRes = await refreshAccessToken();
            if (refreshRes.bot?.refreshed) {
                botAuthReady = true;
            } else if (refreshRes.bot?.reason === 'transient_retry_exhausted') {
                scheduleTransientValidationRetry();
            }
        });

    try {
        await Promise.allSettled([validateBroadcaster, validateBot]);
        if (broadcasterAuthReady && botAuthReady) {
            cancelGracefulAuthExit();
            if (transientRetryTimer) {
                clearTimeout(transientRetryTimer);
                transientRetryTimer = null;
            }
            if (!initialValidationHandled) {
                initialValidationHandled = true;
                handleInitialAuthValidation();
            }
        }
    } finally {
        isValidating = false;
    }
}

async function ensureBroadcasterAuth() {
    if (broadcasterAuthReady) return true;
    const now = Date.now();
    if (now - lastRefreshBroadcasterAttempt > REFRESH_COOLDOWN_MS) {
        lastRefreshBroadcasterAttempt = now;
        console.info('[Auth] Broadcaster auth not ready, attempting recovery refresh...');
        const refreshRes = await refreshAccessToken();
        if (refreshRes.broadcaster?.refreshed) {
            broadcasterAuthReady = true;
            return true;
        }
    }
    return false;
}

async function ensureBotAuth() {
    if (botAuthReady) return true;
    const now = Date.now();
    if (now - lastRefreshBotAttempt > REFRESH_COOLDOWN_MS) {
        lastRefreshBotAttempt = now;
        console.info('[Auth] Bot auth not ready, attempting recovery refresh...');
        const refreshRes = await refreshAccessToken();
        if (refreshRes.bot?.refreshed) {
            botAuthReady = true;
            return true;
        }
    }
    return false;
}

//send a GET request to the Twitch API
async function apiGetRequest(method, parameters, isRetry = false) {
    const isReady = await ensureBroadcasterAuth();
    if (!isReady) {
        throw new Error("twitch not yet authorized, wait a bit and try again");
    }

    const requestQueryString = querystring.stringify(parameters);
    const axiosConfig = {
        headers: {
            "Authorization": "Bearer " + authData.read('twitchBroadcaster.access_token'),
            "Client-Id": clientId
        }
    };

    try {
        const response = await axios.get("https://api.twitch.tv/helix/" + method + "?" + requestQueryString, axiosConfig);
        return response.data;
    } catch (error) {
        if (error?.response?.status === 401 && !isRetry) {
            console.info('[Auth] Broadcaster token expired (401), refreshing token...');
            broadcasterAuthReady = false;
            lastRefreshBroadcasterAttempt = Date.now();
            try {
                const refreshRes = await refreshAccessToken();
                if (refreshRes.broadcaster?.refreshed) {
                    broadcasterAuthReady = true;
                    return await apiGetRequest(method, parameters, true);
                }
            } catch (refreshErr) {
                console.error('[Auth] Refresh failed during apiGetRequest retry:', formatAxiosError(refreshErr));
            }
        }
        if (error?.config?.url) {
            error.config.url = redactSensitiveUrl(error.config.url);
        }
        throw error;
    }
}

//send a POST request to the Twitch API
async function apiPostRequest(method, parameters, data, isRetry = false) {
    const isReady = await ensureBroadcasterAuth();
    if (!isReady) {
        throw new Error("twitch not yet authorized, wait a bit and try again");
    }
    const requestQueryString = querystring.stringify(parameters);
    const axiosConfig = {
        headers: {
            "Authorization": "Bearer " + authData.read('twitchBroadcaster.access_token'),
            "Client-Id": clientId,
            "Content-Type": 'application/json'
        }
    };
    try {
        const response = await axios.post("https://api.twitch.tv/helix/" + method + "?" + requestQueryString, data, axiosConfig);
        return response.data;
    } catch (error) {
        if (error?.response?.status === 401 && !isRetry) {
            console.info('[Auth] Broadcaster token expired (401), refreshing token...');
            broadcasterAuthReady = false;
            lastRefreshBroadcasterAttempt = Date.now();
            try {
                const refreshRes = await refreshAccessToken();
                if (refreshRes.broadcaster?.refreshed) {
                    broadcasterAuthReady = true;
                    return await apiPostRequest(method, parameters, data, true);
                }
            } catch (refreshErr) {
                console.error('[Auth] Refresh failed during apiPostRequest retry:', formatAxiosError(refreshErr));
            }
        }
        if (error?.response?.status === 400) {
            console.warn('[API] Bad Request (400):', error.response.data?.message || 'Bad Request');
        }
        if (error?.config?.url) {
            error.config.url = redactSensitiveUrl(error.config.url);
        }
        throw error;
    }
}

async function apiPostRequestBot(method, parameters, data, isRetry = false) {
    const isReady = await ensureBotAuth();
    if (!isReady) {
        throw new Error("twitch not yet authorized, wait a bit and try again");
    }
    const requestQueryString = querystring.stringify(parameters);
    const axiosConfig = {
        headers: {
            "Authorization": "Bearer " + authData.read('twitchBot.access_token'),
            "Client-Id": clientId,
            "Content-Type": 'application/json'
        }
    };
    try {
        const response = await axios.post("https://api.twitch.tv/helix/" + method + "?" + requestQueryString, data, axiosConfig);
        return response.data;
    } catch (error) {
        if (error?.response?.status === 401 && !isRetry) {
            console.info('[Auth] Bot token expired (401), refreshing token...');
            botAuthReady = false;
            lastRefreshBotAttempt = Date.now();
            try {
                const refreshRes = await refreshAccessToken();
                if (refreshRes.bot?.refreshed) {
                    botAuthReady = true;
                    return await apiPostRequestBot(method, parameters, data, true);
                }
            } catch (refreshErr) {
                console.error('[Auth] Refresh failed during apiPostRequestBot retry:', formatAxiosError(refreshErr));
            }
        }
        if (error?.response?.status === 400) {
            console.warn('[API] Bad Request (400):', error.response.data?.message || 'Bad Request');
        }
        if (error?.config?.url) {
            error.config.url = redactSensitiveUrl(error.config.url);
        }
        throw error;
    }
}
//use the API to get Channel Data for a given broadcaster_id
//use this as a template if you want to make other shorthand functions to make common API stuff easier

function getChannelInfo(broadcaster_id) {
    return new Promise((resolve, reject) => {
        apiGetRequest('channels', { broadcaster_id: broadcaster_id })
            .then(data => resolve(data.data))
            .catch(error => reject(error))
    });
}

function getUserInfo(user_Name) {
    return new Promise((resolve, reject) => {
        apiGetRequest('users', { login: user_Name })
            .then(data => resolve(data.data))
            .catch(error => reject(error))
    });
}

// #region ==================== BADGES =====================

/**
 * Map of badge set IDs and version IDs to the original version objects from Twitch.
 * Easier data structure to work with than the original API response.
 * @example
 * {
 *   "bits": {
 *     "1": {
 *       "image_url_4x": "https://path.to/some/badge.jpg",
 *       // many other properties
 *     },
 *     // many other versions
 *   },
 *   // many other sets
 * }
 */
const allBadges = {};

/**
 * Add a badge API request's response data to the provided target object.
 * @param {Object} target - The target object to add the badge data to.
 * @param {Object[]} source - The source object containing the Twitch badge data.
 */
function addTwitchBadges(target, source) {
    for (const { set_id, versions } of source) {
        if (!target[set_id]) {
            // if the set_id doesn't exist in target, create an empty placeholder for later
            target[set_id] = {};
        }
        versions.forEach(version => {
            target[set_id][version.id] = version;
        });
    }
}

function getChannelBadges(broadcasterID) {
    return new Promise((resolve, reject) => {
        apiGetRequest("chat/badges", { broadcaster_id: broadcasterID })
            .then(data => resolve(data.data))
            .catch(error => reject(error))
    });
}

function getGlobalBadges() {
    return new Promise((resolve, reject) => {
        apiGetRequest("chat/badges/global")
            .then(data => resolve(data.data))
            .catch(error => reject(error))
    });
}

async function getBadgeVersion(set_id, version_id) {
    // if there are no badges loaded yet...
    if (Object.keys(allBadges).length < 1) {
        try {
            // fetch badges from Twitch API
            const channelBadges = await getChannelBadges(broadcasterID);
            const globalBadges = await getGlobalBadges();

            // merge all kinds of badges into tempBadges first, so we don't partially fill allBadges and have an error partway through
            const tempBadges = {};
            addTwitchBadges(tempBadges, globalBadges);
            addTwitchBadges(tempBadges, channelBadges);

            // merge tempBadges into allBadges
            Object.assign(allBadges, tempBadges);
        }
        catch (error) {
            console.log("Total failure fetching badges:", error);
        }
    }
    const set = allBadges[set_id];
    if (set) {
        const version = set[version_id];
        if (version) {
            return version;
        }
    }
    console.log(`Badge version not found for set_id: ${set_id}, version_id: ${version_id}`);
    return undefined;
}

// #endregion ==================== BADGES =====================


function serverBoop(user_id, duration, reason) {
    return new Promise((resolve, reject) => {
        apiPostRequest('moderation/bans', { broadcaster_id: broadcasterID, moderator_id: broadcasterID }, { "data": { "user_id": user_id, "duration": duration, "reason": reason } })
            .then(data => resolve(data.data))
            .catch(error => {
                console.log("Error when doin' a boop");
                setTimeout(() => { postMessage(botID, 'kiawaBONK kiawaBONK') }, 3000);
                setTimeout(() => { postMessage(botID, 'kiawaWat') }, 6000);
                setTimeout(() => { postMessage(botID, 'kiawaPuff') }, 8000);
                setTimeout(() => { postMessage(botID, 'kiawaBONK kiawaBONK kiawaBONK') }, 11000);
                setTimeout(() => { postMessage(botID, 'kiawaDed') }, 13000);

            });
        postMessage(botID, 'kiawaBONK');
    });
}

function postMessage(user_id, message) {
    return apiPostRequestBot('chat/messages', { broadcaster_id: broadcasterID, sender_id: user_id, message: message })
        .then(data => ({ ok: true, data }))
        .catch(error => {
            console.error('[Bot] Failed to send chat message:', formatAxiosError(error));
            return { ok: false, error: formatAxiosError(error) };
        });
}

//handle changes to the status of the auth-data file
function handleAuthFileStatusChange(status) {
    console.info('Auth File status changed: ' + status);
    if (status === 'loaded') {
        //data has been loaded at app start.  Proceed with the rest of the bot stuff
        validateAccessToken();

    }

}

function InitializeIncentive() {
    incentiveAmount = incentiveData.read('incentive.amount');
    incentiveGoal = incentiveData.read('incentive.goal');
}

function handleIncentiveFileStatusChange(status) {
    console.info('Incentive File status changed: ' + status);
    if (status === 'loaded') {
        //data has been loaded at app start.  Proceed with the rest of the bot stuff
        InitializeIncentive();
    }

}

//Things to do when the Twitch auth is initially validated
function handleInitialAuthValidation() {
    //as an example, we'll fetch the channel info once we know the token's good to show the API is working
    getChannelInfo(broadcasterID)
        .then(channel_data => {
            console.info('Got channel data!', channel_data);
        })
        .catch(error => {
            console.error('[Auth] Failed to fetch initial channel data:', formatAxiosError(error));
        });

}
//start up the auth file handler and attach the function that responds to changes
const authData = new AuthDataHelper();

//start up the incentive handler
const incentiveData = new IncentiveHelper();
const quoteData = new QuoteHelper(quote_Path, writeAtomicSync);
authData.statusCallback = handleAuthFileStatusChange;
authData.loadData();
validateAccessToken();
validationTicker = setInterval(() => { validateAccessToken(); }, 1000 * 600);
incentiveData.statusCallback = handleIncentiveFileStatusChange;
incentiveData.loadData();
// if (!fs.existsSync(INCENTIVEPATH)) {
//     const content = incentiveData.read('incentive.command') + ' $' + Number(incentiveData.read('incentive.amount')).toFixed(2) + ' / $' + incentiveData.read('incentive.goal');
//     //const content = Number(incentiveData.read('incentive.amount')).toFixed(0) + '/' + incentiveData.read('incentive.goal');
//     fs.writeFile(INCENTIVEPATH, content, err => {
//         if (err) {
//             console.error(err);
//         } else {
//             // file written successfully
//         }
//     });
// }

//LISTENING SECTION

class TesManager {
    // TES doesn't provide strong typing, so some of these could be more detailed if we wanted to put in the effort.
    /** @typedef {(event: Event) => any} TesEventHandler */
    /** @typedef {{type: string, condition: object, callback?: TesEventHandler}} TesSubscriptionParams */
    /** @typedef {{type: string, id: string, condition: object, created_at: string}} Subscription */

    /** @type {TES} */
    #tes;

    /** @type {TesSubscriptionParams[]} */
    #pendingSubscriptions = [];

    /** @type {{[messageId: string]: NodeJS.Timeout}} */
    #recentlySeenEventIdentifiers = {};

    /** @type {{[subscriptionType: string]: Subscription}} */
    #subscriptionByType = {};

    constructor() {
        this.#tes = this.#buildTesInstance();
        if (this.#tes.on) { // if TES was able to auth properly
            this.#initializeSubscriptionQueue();
        }
        else {
            console.log("TesManager can only auth at startup.  Please restart the bot once Twitch auth is complete.")
        }
    }

    /** @returns {TES} */
    #buildTesInstance() {
        try {
            const tes = new TES({
                identity: {
                    id: process.env.CLIENT_ID,
                    secret: process.env.CLIENT_SECRET,
                    accessToken: authData.read('twitchBroadcaster.access_token'),
                    refreshToken: authData.read('twitchBroadcaster.refresh_token')
                },
                listener: { type: "websocket", port: 8082 },
            });

            /**
             * Twitch revoked an EventSub subscription.  Maybe something related to the user revoking auth for the bot in general?
             * Nothing to be done here - resubscribing won't work on the fly, and your access token may even be entirely revoked.
             * 
             * @param {Subscription} subscription
             */
            const onRevocation = subscription => {
                console.error(`Subscription ${subscription.id} ${subscription.type} has been revoked.`);
            };
            tes.on("revocation", onRevocation);

            /**
             * TES and Twitch got disconnected - TES will handle reconnecting itself but not inherently resubscribing.
             * 
             * @param {{[subscriptionId: string]: {type: string, condition: object}}} subscriptionTypeAndConditionById
             */
            const onConnectionLost = subscriptionTypeAndConditionById => {
                const types = Object.values(subscriptionTypeAndConditionById).map(({ type }) => type).sort().join(", ");
                console.log(`Connection lost for subscription types ${types}; let's repair them.`)
                this.#repairSubscriptions();
            };
            tes.on("connection_lost", onConnectionLost);

            return tes;
        } catch (error) {
            //let's assume any error here is due to a bad access token and re-auth
            const warning = () => console.log("TES failed to initialize.  Could just be an authentication error - try restarting the bot after you reauth.", error);
            warning();
            startAuth();
            return { queueSubscription: warning }; // calls to queueSubscription won't crash the bot entirely
        }
    }

    #initializeSubscriptionQueue() {
        let queueHeat = 0;

        // Handle queued subscription requests one-by-one to respect Twitch rate limiting
        const handleQueue = (async () => {
            const input = this.#pendingSubscriptions.shift();
            if (input) {
                queueHeat = queueHeat + 1;

                const { type, condition, callback } = input;

                // If there was a connection_lost event, TesManager doesn't retain the callback from that subscription.  callback will be undefined.
                // But the event listener (from TES#on) hasn't been unregistered, so we don't need to add a second listener.
                if (typeof callback === "function") {
                    const wrappedCallback = this.#preventDuplicateEvents(callback);
                    this.#tes.on(type, wrappedCallback);
                }

                try {
                    const existingSubscription = this.#subscriptionByType[type];
                    if (existingSubscription) {
                        console.log(`Oh no! We already have a subscription for ${type}.  Heck whatever this is.  Repairing subscriptions just in case...`);
                        this.#repairSubscriptions();
                    }
                    else {
                        const subscription = await this.#tes.subscribe(type, condition);
                        console.log(`Subscription to event type ${type} successful`, subscription);
                        this.#subscriptionByType[subscription.type] = subscription;
                    }
                }
                catch (error) {
                    console.log(`Error subscribing to event type ${type}.  Will try again shortly.`, error);
                    this.#pendingSubscriptions.push(input);
                }
            }
            else {
                // There was no pending subscription.  The delay can cool down a bit.
                if (queueHeat > 0) {
                    // console.log("Subscription queue cooling down...");
                    queueHeat = queueHeat - 1;
                }
            }
            // The math is arbitrary, but generally queueHeat should provide some sort of exponential backoff
            setTimeout(handleQueue, 100 * Math.pow(1 + (queueHeat / 2), 2))
        });

        handleQueue();
    }

    /**
     * @see https://dev.twitch.tv/docs/eventsub/#handling-duplicate-events
     * 
     * @param {(event: Event, subscription: Subscription) => void} callback
     * @returns {(event: Event, subscription: Subscription) => void}
     */
    #preventDuplicateEvents(callback) {
        return (event, subscription) => {
            const uniqueEventIdentifier = this.#getUniqueEventIdentifier(event, subscription);
            if (uniqueEventIdentifier) {
                const timeout = this.#recentlySeenEventIdentifiers[uniqueEventIdentifier];
                if (!timeout) {
                    // The timeout does not exist.  This is the first time we've seen this event recently.
                    // Create a timeout for a few seconds to check for future duplicates, and then handle the event itself.

                    // We don't want to save every UEID we see for the entire lifetime of the bot (or beyond).  That's just leaking memory needlessly.
                    // This message receipt will self destruct in 5 seconds.
                    this.#recentlySeenEventIdentifiers[uniqueEventIdentifier] = setTimeout(() => delete this.#recentlySeenEventIdentifiers[uniqueEventIdentifier], 5000);

                    callback(event, subscription);
                }
                else {
                    // The timeout already exists.  The message is a duplicate.
                    // Don't handle this message, but restart the timeout.
                    console.log(`Deduping event ${subscription.type}`, uniqueEventIdentifier);
                    timeout.refresh();

                    // While we're at it, let's repair the subscriptions in case this is evidence of a duplicate subscription and not just a resent message
                    console.log(`Duplicate message detected; let's repair the subscriptions.`)
                    this.#repairSubscriptions();
                }
            }
            else {
                // https://dev.twitch.tv/docs/eventsub/#handling-duplicate-events says all messages contain a message_id to allow deduplication.
                // They are liars.  Many events do not contain a message_id.  Just pass through to the provided callback.
                callback(event, subscription);
            }
        };
    }

    /**
     * @param {(event: Event, subscription: Subscription) => void} callback
     * @returns {string | number | null}
     */
    #getUniqueEventIdentifier(event, subscription) {
        const type = subscription.type;

        // If we need to NOT deduplicate an event for some reason, we can return early here.  Maybe based on subscription type?
        const typesThatShouldNotBeDeduped = [
            // "channel.chat.message_from_jonid"
        ];
        if (typesThatShouldNotBeDeduped.includes(type)) {
            return null;
        }

        // Chat message events typically have a message_id field.  If it exists, we should probably use it.
        if (event.message_id) {
            return event.message_id;
        }

        // similar to message_id, many event types do have a single field we can use to deduplicate the occurrence.  See if that's a known case.
        const simpleFieldLookupsByType = {
            "channel.channel_points_custom_reward_redemption.add": "id",
        };
        const possiblyUniqueFieldName = simpleFieldLookupsByType[type];
        if (possiblyUniqueFieldName) {
            return event[possiblyUniqueFieldName];
        }

        // No idea how this event can be deduplicated.  Let's serialize the whole thing as JSON and hope Twitch is sending identical payloads.
        return JSON.stringify(event);
    }

    // https://dev.twitch.tv/docs/eventsub/manage-subscriptions/#getting-the-list-of-events-you-subscribe-to
    // Lot of assumptions around wanting at most one handler per type, and disregarding condition.  That's fine for Kiara today.
    // This method might also benefit from synchronization and/or a short debounce.
    async #repairSubscriptions() {
        console.log(`made it to before the repairSubscriptions try statement`);
        try {
            console.log(`Repairing EventSub subscriptions...`);
            const cachedSubs = Object.values(this.#subscriptionByType);
            const twitchSubs = (await this.#tes.getSubscriptions())?.data ?? [];
            // console.log(typeof twitchSubs, twitchSubs, JSON.stringify(twitchSubs));
            const subTypes = new Set([...cachedSubs, ...twitchSubs].map(sub => sub.type));
            console.log(`Repairing EventSub subscriptions with types ${[...subTypes].join(", ")}`);
            for (const type of subTypes) {
                console.log(`We are inside the 1st for statement`);
                console.log(type);
                try {
                    console.log(`We are inside the 2nd try statement`);
                    const allSubs = twitchSubs.filter(sub => sub.type == type);
                    console.log(allSubs);
                    const existingSub = allSubs.find(sub => sub.id === this.#subscriptionByType[type]?.id);
                    console.log(existingSub);
                    const potentialReplacementSub = allSubs.find(sub => sub.status == "enabled" && sub.id != existingSub?.id);
                    console.log(potentialReplacementSub);
                    const fallbackCondition = existingSub?.condition ?? potentialReplacementSub?.condition ?? allSubs.find(s => s.condition)?.condition;
                    console.log(fallbackCondition);

                    // Any subs that aren't existingSub or potentialReplacementSub can't possibly be useful. Unsubscribe them all first.
                    for (const otherSub of allSubs) {
                        console.log('We are inside the 2nd for statement');
                        try {
                            if (otherSub !== existingSub && otherSub !== potentialReplacementSub) {
                                console.log(`Repairing EventSub subscriptions: removing duplicate, ${type} ${otherSub.status} ${otherSub.created_at} ${otherSub.id}`);
                                await this.#tes.unsubscribe(otherSub.id);
                            }
                        }
                        catch (e) {
                            console.log(`Repairing EventSub subscriptions: failed to remove duplicate, ${type} ${otherSub.status} ${otherSub.created_at} ${otherSub.id}`, e);
                        }
                    }

                    // if existingSub thinks it's good, get rid of potentialReplacementSub also, and move on to the next type
                    if (existingSub?.status == "enabled") {
                        console.log('We are inside the 1st if statement');
                        if (potentialReplacementSub) {
                            try {
                                console.log(`Repairing EventSub subscriptions: removing duplicate, ${type} ${potentialReplacementSub.status} ${potentialReplacementSub.created_at} ${potentialReplacementSub.id}`);
                                await this.#tes.unsubscribe(potentialReplacementSub.id);
                            }
                            catch (e) {
                                console.log(`Repairing EventSub subscriptions: failed to remove duplicate, ${type} ${potentialReplacementSub.status} ${potentialReplacementSub.created_at} ${potentialReplacementSub.id}`, e);
                            }
                        }
                        continue; // next type
                    }

                    // if existingSub exists in a bad state, unsubscribe it and remove from cache
                    if (existingSub) {
                        console.log('We are inside the 2nd if statement');
                        try {
                            console.log(`Repairing EventSub subscriptions: removing stale, ${type} ${existingSub.status} ${existingSub.created_at} ${existingSub.id}`);
                            delete this.#subscriptionByType[type];
                            await this.#tes.unsubscribe(existingSub.id);
                        }
                        catch (e) {
                            console.log(`Repairing EventSub subscriptions: failed to remove stale, ${type} ${existingSub.status} ${existingSub.created_at} ${existingSub.id}`, e);
                        }
                    }

                    // if potentialReplacementSub exists (by definition in a good "enabled" state), put it in the cache
                    if (potentialReplacementSub) {
                        console.log(`Repairing EventSub subscriptions: replacing, ${type} ${potentialReplacementSub.status} ${potentialReplacementSub.created_at} ${potentialReplacementSub.id}`);
                        this.#subscriptionByType[type] = potentialReplacementSub;
                    }

                    // last thing - if we didn't wind up with a subscription in the cache of this type, try and make an entirely new one.
                    if (!this.#subscriptionByType[type]) {
                        console.log('We are inside the last if statement');
                        try {
                            console.log(`Repairing EventSub subscriptions: recreating ${type} with ${JSON.stringify(fallbackCondition)}`);
                            const hailMary = await this.#tes.subscribe(type, fallbackCondition);
                            this.#subscriptionByType[type] = hailMary;
                        }
                        catch (e) {
                            console.error(`Repairing EventSub subscriptions: failed to recreate ${type} with ${JSON.stringify(fallbackCondition)}:`, e.message);
                        }
                    }
                }
                catch (e) {
                    console.log(`Repairing EventSub subscriptions: completely failed to repair ${type}`, e);
                }
            }
        }
        catch (e) {
            console.log(`Repairing EventSub subscriptions: completely failed`, e);
        }
    }

    /**
     * @param {string} type
     * @param {object} condition
     * @param {TesEventHandler} callback
     * @returns void
     */
    queueSubscription(type, condition, callback) {
        this.#pendingSubscriptions.push({ type, condition, callback });
    }
}
const tesManager = new TesManager();
const subCondition = { broadcaster_user_id: broadcasterID};
const subCondition2 = { broadcaster_user_id: broadcasterID, user_id: broadcasterID};
const subConditionMod = { broadcaster_user_id: broadcasterID, moderator_user_id: broadcasterID};
let websockets = [];
// setup websocket server for chat widget
const socket = new WebSocketServer({ port: 8080 });
socket.on('connection', ws => {
    websockets.push(ws);
    console.log('Client connected');
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});
console.log('WebSocket server started on port 8080');

function sendToAllChatWidgets(data) {
    let serialized = data;
    try {
        serialized = JSON.stringify(data);
    }
    catch (error) {
        // If the data can't be serialized, it can't be sent to the websockets.
        // But let's not explode; just log the issue and return.  Nothing's wrong with the WebSocket connection after all, only the input for this one call.
        console.error("Failed to serialize chat widget data!", error);
        return;
    }
    for (const connection of websockets) {
        try {
            if (connection?.readyState === WebSocket.OPEN) {
                connection.send(serialized);
            }
        }
        catch (error) {
            console.error("Sending to chat widget failed!", serialized, error);
        }
    }
}

/***************************************
 *          Channel Updates             *
 ***************************************/
// tesManager.queueSubscription("channel.update", subCondition, event => {
//     //Handle received Channel Update events
//     console.log(`${event.broadcaster_user_name}'s new title is ${event.title}`);
//     console.log(event);
// });


/***************************************
 *          New Follower               *
 ***************************************/
/* tesManager.queueSubscription("channel.follow", subConditionMod, event => {
    // Handle received New Follower events
    // console.log(event);
    updateStreaksSafely(event?.user_id, event?.user_name);
}); */

/***************************************
 *          Cheer (Bits)               *
 ***************************************/
tesManager.queueSubscription("channel.cheer", subCondition, event => {
    //Handle received Cheer events
    incentiveAmount = incentiveData.read('incentive.amount');
    incentiveAmount = incentiveAmount + event.bits / 100
    if (event.bits === 999) {
        setTimeout(() => { serverBoop(`22587336`, 1800, 'TNT') }, 5000);
    }
    incentiveData.update('incentive.amount', incentiveAmount);
    //updateIncentiveFile();
    if (!event?.is_anonymous) { // anonymous cheers, well, don't come with user info
        updateStreaksSafely(event?.user_id, event?.user_name);
    }
});

/***************************************
 *          Channel Points             *
 ***************************************/
tesManager.queueSubscription('channel.channel_points_custom_reward_redemption.add', subCondition, event => {
    //Check for which redemption it was and do things based off of the redemption


    if (event?.reward?.title === "Stream Streak") {
        // if they redeemed the Streak reward, we DO want the bot to call it out in chat for them
        updateStreaksSafely(event?.user_id, event?.user_name, true);
    }
    else {
        // if they redeemed any other reward, we DO NOT want the bot to call it out in chat for them (but we want to update their streak regardless)
        updateStreaksSafely(event?.user_id, event?.user_name, false);
    }
});

/** @type {{[userId: string]: boolean}} */
const userIdsWhoAlreadyStreaked = {}

// Under no circumstances should a streak failure of any kind crash the bot.
function updateStreaksSafely(userId, userName, sayItOutLoud = false) {
    //first check if stream is online, if not, then exit function.
    return new Promise((resolve) => {
        apiGetRequest('streams', { user_id: broadcasterID, type: 'all', first: '1' })
            .then(data => {
                if (!data?.data || data.data[0] === undefined) {
                    console.info('[Streaks] Stream is offline, will not update streaks');
                    resolve(null);
                    return;
                }

                try {
                    if (userId && userName) {
                        console.info('[Streaks] Updating user streak!');
                        updateStreaks(userId, userName, sayItOutLoud);
                    } else {
                        // could have been something like an anonymous cheer
                        console.warn("[Streaks] No user given when updating a streak? That's probably okay once in a while.");
                    }
                    resolve(true);
                } catch (e) {
                    console.error("updateStreaks failed!", e);
                    resolve(false);
                }
            })
            .catch(error => {
                console.error('[Streaks] Failed to fetch stream info for streak update:', formatAxiosError(error));
                resolve(null);
            });
    });
}
//check the current stream start time
//compare against previous value of current stream time
//if the same, do nothing (bot was restarted or something)
//if 5 hours has passed since end of last stream (try first)
//if the same 24 hour period (set to 6 AM PDT converted to GMT so whatever the hell that is)/ , do not change the existing start time
//save to json
function updateStreaks(userID, userName, sayItOutLoud = false) {
    // if the user didn't redeem a channel point reward for it, then there's no need to do all the file manipulation if we've already seen them streak.
    if (!sayItOutLoud && userIdsWhoAlreadyStreaked[userID]) {
        return;
    }

    //read the json file
    let streak_List;
    try {
        streak_List = jsonfile.readFileSync(streak_Path);
    } catch (e) {
        console.error(`[Streaks] Failed to read streaks file from ${streak_Path}:`, e.message);
    }

    if (!streak_List) {
        console.log('something got messed up in streaks')
    }
    else {
        const say = msg => {
            if (sayItOutLoud) {
                postMessage(botID, msg);
            }
        }

        let lastStart = Date.parse(streak_List.Last_Stream.Start);
        let lastEnd = Date.parse(streak_List.Last_Stream.End);
        let currentStart = Date.parse(streak_List.Current_Stream.Start)
        let now = new Date();
        let userInfo = streak_List.Users[userID];

        //did not find user, add them to the database
        if (!userInfo) {
            streak_List.Users[userID] = { User_Name: `${userName}`, Streak: 1, Best_Streak: 1, Last_Updated: "" };
            streak_List.Users[userID].Last_Updated = now;
            say(`@${userName} has just started their watch streak!! this is just the beginning!!`);
        }
        //found user, update streak info
        else {

            //is there an End time specified form last stream? if not, use the backup calculation based on reset time
            if (!lastEnd) {
                //get the last reset point
                let lastReset = new Date();
                lastReset = Date.parse(lastReset);
                lastReset = lastReset - (24 * 60 * 60 * 1000);
                lastReset = new Date(lastReset);
                lastReset.setHours(13, 0, 0);
                lastReset = Date.parse(lastReset);

                //check if we are passed the last reset
                if (((lastStart < lastReset) && (currentStart >= lastReset))) {
                    const lastUpdated = Date.parse(userInfo.Last_Updated);

                    //streak is still alive!
                    if ((lastUpdated > lastStart && lastUpdated < currentStart)) {
                        userInfo.Streak = userInfo.Streak + 1;
                        if (userInfo.Best_Streak < userInfo.Streak) {
                            userInfo.Best_Streak = userInfo.Streak
                        }
                        userInfo.Last_Updated = now;
                        say(`@${userName} has watched ${userInfo.Streak} streams in a row!!`);
                    }
                    //streak is deadge :(
                    else if (lastUpdated < lastStart) {
                        userInfo.Last_Updated = now;
                        userInfo.Streak = 1
                        say(`@${userName} has just re-started their watch streak!! this is just the beginning you can do it this time!!`);
                    }
                    else {
                        say(`@${userName} is currently on a ${userInfo.Streak} stream streak!`);
                        if (userInfo.Best_Streak < userInfo.Streak) {
                            userInfo.Best_Streak = userInfo.Streak
                        }
                    }
                }
                else {
                    say(`@${userName} is currently on a ${userInfo.Streak} stream streak!`);
                    if (userInfo.Best_Streak < userInfo.Streak) {
                        userInfo.Best_Streak = userInfo.Streak
                    }
                }
            }
            //check if 5 hours since last stream or for the reset time
            else {
                if ((currentStart - lastEnd) > 5 * 60 * 60 * 1000) {
                    const lastUpdated = Date.parse(userInfo.Last_Updated);
                    //streak is still alive!
                    if ((lastUpdated > lastStart && lastUpdated < currentStart)) {
                        userInfo.Streak = userInfo.Streak + 1;
                        userInfo.Last_Updated = now;
                        say(`@${userName} has watched ${userInfo.Streak} streams in a row!!`);
                        if (userInfo.Best_Streak < userInfo.Streak) {
                            userInfo.Best_Streak = userInfo.Streak
                        }
                    }
                    //streak is deadge :(
                    else if (lastUpdated < lastStart) {
                        userInfo.Last_Updated = now;
                        userInfo.Streak = 1
                        say(`@${userName} has just re-started their watch streak!! this is just the beginning you can do it this time!!`);
                    }
                    else {
                        say(`@${userName} is currently on a ${userInfo.Streak} stream streak!`);
                        if (userInfo.Best_Streak < userInfo.Streak) {
                            userInfo.Best_Streak = userInfo.Streak
                        }
                    }
                }
                else {
                    say(`@${userName} is currently on a ${userInfo.Streak} stream streak!`);
                    if (userInfo.Best_Streak < userInfo.Streak) {
                        userInfo.Best_Streak = userInfo.Streak
                    }
                }
            }
        }

        //write the file
        writeAtomicSync(streak_Path, streak_List, { spaces: 2, EOL: "\n" });
        userIdsWhoAlreadyStreaked[userID] = true;
    }
}

function writeAtomicSync(filePath,data,options, retries=3,delay =100){
    console.log('writing to file')
    const tempName=`${Date.now()}`;
    const tempPath=`${path.dirname(filePath)}/.${tempName}.tmp`;
    jsonfile.writeFileSync(tempPath, data, options);
    try {
        fs.renameSync(tempPath,filePath);
        return;
    }
    catch (error) {
        if (retries>0) {
            console.log(`Error writing file ${filePath}, retrying`);
        }
        else{
            console.log(`Failed after maximum retry attempts. ${error.message}`)
        }
        try {
            fs.unlinkSync(tempPath);
            console.log('File deleted successfully');
        }
        catch (err) {
            console.error('Error deleting file:', err);
        }
    
        if (retries>0) {
            setTimeout(() => {writeAtomicSync(filePath,data,options,retries-1,delay+1000)},delay);
        }
    }
}
tesManager.queueSubscription('stream.online', subCondition, event => {
    console.log("stream online detected");
    processStreamStartStreak(streak_Path, event?.started_at, {
        readFn: jsonfile.readFileSync,
        writeFn: writeAtomicSync,
        onStreakReset: () => {
            Object.keys(userIdsWhoAlreadyStreaked).forEach(key => delete userIdsWhoAlreadyStreaked[key]);
        }
    });
});

tesManager.queueSubscription('stream.offline', subCondition, event => {
    let streak_List;
    try {
        streak_List = jsonfile.readFileSync(streak_Path);
    } catch (e) {
        console.error(`[Streaks] Failed to read streaks file on stream.offline from ${streak_Path}:`, e.message);
    }
    if (!streak_List || typeof streak_List !== 'object' || !streak_List.Last_Stream) {
        console.warn('[Streaks] Invalid or missing streaks data on stream.offline; skipping update');
        return;
    }
    //update stream times
    const now = new Date();
    streak_List.Last_Stream.Backup_End = now;
    writeAtomicSync(streak_Path, streak_List, { spaces: 2, EOL: "\n" })
    console.log('Stream Ended, logged to streaks')
});

tesManager.queueSubscription('channel.chat.message', subCondition2, tags => {
            // First, print the message to the program's console.
        messageHandler(tags);


});

let streamInfo = setTimeout(() => {
    getStreamInfo(broadcasterID, 'all', '1')
        .catch(err => console.error('[StreamInfo] Initial check failed:', formatAxiosError(err)));
}, 2000);

async function getStreamInfo(broadcaster_id, type, first) {
    console.info('[Stream] Updating Stream Start Time');
    try {
        const data = await apiGetRequest('streams', { user_id: broadcaster_id, type: type, first: first });
        const streamList = data?.data;
        if (!Array.isArray(streamList) || streamList.length === 0 || !streamList[0]) {
            console.info('[Stream] Stream is offline, will not update streaks');
            return { online: false, data: [] };
        }
        const startedAt = streamList[0]?.started_at;
        if (startedAt) {
            processStreamStartStreak(streak_Path, startedAt, {
                readFn: jsonfile.readFileSync,
                writeFn: writeAtomicSync,
                onStreakReset: () => {
                    Object.keys(userIdsWhoAlreadyStreaked).forEach(key => delete userIdsWhoAlreadyStreaked[key]);
                }
            });
        }
        return { online: true, data: streamList };
    } catch (error) {
        console.error('[StreamInfo] Failed to fetch stream info:', formatAxiosError(error));
        throw error;
    }
}



//

/***************************************
 *        New Subscriber               *
 ***************************************/
tesManager.queueSubscription("channel.subscribe", subCondition, event => {
    //Handle received New Subscriber events
    console.log(event);
    incentiveAmount = incentiveData.read('incentive.amount');
    updateStreaksSafely(event?.user_id, event?.user_name);
});

/***************************************
 *        Mod Action                   *
 ***************************************/
tesManager.queueSubscription("channel.chat.message_delete", { ...subCondition, user_id: broadcasterID }, messageDelete => {
    sendToAllChatWidgets({ kiawaAction: "Message_Delete", messageDelete });
});

tesManager.queueSubscription("channel.moderate", { ...subCondition, moderator_user_id: broadcasterID }, modAction => {
    sendToAllChatWidgets({ kiawaAction: "Mod_Action", modAction });
});

/***************************************
 *           Gift Sub(s)               *
 ***************************************/
//Gift Sub
tesManager.queueSubscription("channel.subscription.gift", subCondition, event => {
    //Handle received gift sub events
    console.log(event);
    incentiveAmount = incentiveData.read('incentive.amount');
    if (event.tier === '1000') {
        incentiveAmount = incentiveAmount + t1Value * event.total;
    }
    else if (event.tier === '2000') {
        incentiveAmount = incentiveAmount + t2Value * event.total;
    }
    else if (event.tier === '3000') {
        incentiveAmount = incentiveAmount + t3Value * event.total;
    }
    console.log(incentiveAmount);
    incentiveData.update('incentive.amount', incentiveAmount);
    //updateIncentiveFile();
    if (!event?.is_anonymous) { // anonymous gift subs, well, don't come with user info
        updateStreaksSafely(event?.user_id, event?.user_name);
    }
});

/***************************************
 *            Resub Message            *
 ***************************************/
//Resub
tesManager.queueSubscription("channel.subscription.message", subCondition, event => {
    //Handle received new sub in chat
    console.log(event);
    incentiveAmount = incentiveData.read('incentive.amount');
    if (event.tier === '1000') {
        incentiveAmount = incentiveAmount + t1Value;
    }
    else if (event.tier === '2000') {
        incentiveAmount = incentiveAmount + t2Value;
    }
    else if (event.tier === '3000') {
        incentiveAmount = incentiveAmount + t3Value;
    }
    else if (event.tier === '4000') {
        incentiveAmount = incentiveAmount + primeValue;
    }
    console.log(incentiveAmount);
    incentiveData.update('incentive.amount', incentiveAmount);
    //updateIncentiveFile();
    updateStreaksSafely(event?.user_id, event?.user_name);
});

/***************************************
 *         D D D D DUEL!!!!!!          *
 ***************************************/
let Duelers = [];
setInterval(() => {
    if (Duelers.length > 1) {
        let dueler1 = Duelers[0];
        let dueler2 = Duelers[1];
        postMessage(botID, `Attention Chat! @${dueler1.dueler} is about to duel @${dueler2.dueler}!!`);
        setTimeout(() => { postMessage(botID, `will ${dueler2.dueler}'s ${dueler2.weapon} be enough to defeat ${dueler1.dueler}'s ${dueler1.weapon}? Duelists take your places!`) }, 1000);
        setTimeout(() => { postMessage(botID, `Fire in 3!`) }, 3000);
        setTimeout(() => { postMessage(botID, `2!`) }, 4000);
        setTimeout(() => { postMessage(botID, `1!`) }, 5000);
        //blow up somebody
        setTimeout(() => {
            //coin flip for the winnter
            const coinFlip = crypto.randomInt(0, 2);
            //player 1 wins
            if (coinFlip === 1) {
                postMessage(botID, `@${dueler1.dueler} obliterated @${dueler2.dueler} with amazing use of their ${dueler1.weapon}`);
                serverBoop(`${dueler2.duelerID}`, 60 * 5, `Killed by ${dueler1.dueler}'s ${dueler1.weapon}`)
            }

            //player 2 wins
            else {
                postMessage(botID, `@${dueler2.dueler} obliterated @${dueler1.dueler} with amazing use of their ${dueler2.weapon}`);
                serverBoop(`${dueler1.duelerID}`, 60 * 5, `Killed by ${dueler2.dueler}'s ${dueler2.weapon}`)
            };
            //cleanup and remove contestants from array
            Duelers = Duelers.slice(2);
        }
            , 6000);
    }
}, 15 * 1000)

// function updateIncentiveFile() {

//     const content = incentiveData.read('incentive.command') + ' $' + Number(incentiveData.read('incentive.amount')).toFixed(2) + ' / $' + incentiveData.read('incentive.goal');
//     //const content = Number(incentiveData.read('incentive.amount')).toFixed(0) + '/' + incentiveData.read('incentive.goal');
//     fs.writeFile(INCENTIVEPATH, content, err => {
//         if (err) {
//             console.error(err);
//         } else {
//             // file written successfully
//         }
//     });
// }

//this function will search the command list file and if it finds a command, will send the response to chat
function postCommand(command) {
    jsonfile.readFile(command_Path, async function(err, command_List) {
        if (err) {
            console.error(err);
        }

        //Search the existing command file and see if the command exists
        var command_Info = command_List.find(
            (search) => {
                return search.Tag === command;
            }
        );
        //format all the bullshit and spit it out in the chat
        try {
            var command_Output = command_Info.Response
            postMessage(botID, command_Output);
        }
        catch (error) {
            console.error(err);
        }
    });
}
//these two variables track activity and which timed command we are currently at.
let activityDetection = false
let commandIndex = 0

//interval for timed chat commands that run automagically if chat activity has been recorded since last run
setInterval(() => {
    if (activityDetection === true) {
        //send the current command in the rotation to get posted
        postCommand(timedCommands[commandIndex]);
        //increment the array index, reset to 0 if past max
        commandIndex = (commandIndex + 1) % timedCommands.length;
        //reset activity detection so that timed messages do not get spammed without chat activity
        activityDetection = false;
    }
}, 1000*60*20)
// post first entry in array to postCommand
//increment to next array index, if at max loop back to start


//message handler
async function messageHandler(tags) {
            const user_id=tags["chatter_user_id"];
            const message=tags.message.text;
            const channel=tags["chatter_user_name"];
            //determine if chat activity in last ten minutes
            if (tags.chatter_user_login != "kiawa_bot") {
                activityDetection = true;
                updateStreaksSafely(tags.chatter_user_id, channel);
            }
            // resolve badges for this message
            const messageBadges = [];
            var ismod=false;
            var isvip=false;
            var isbroadcaster=false;
            if (tags.badges) {
                for (const {set_id, id} of tags.badges) {
                    //parse out the badges that are part of this message
                    const version = await getBadgeVersion(set_id, id);
                    if (version) {
                        messageBadges.push(version);
                    }
                    if(set_id==='moderator'){
                        ismod=true;
                    }

                    if(set_id==='broadcaster'){
                        ismod=true;
                        isbroadcaster=true;
                    }
                    if(set_id==='vip'){
                        isvip=true;
                    }
                }
            }

            //send to websocket
            sendToAllChatWidgets({ kiawaAction: "Message", tags, channel, message, messageBadges });

    ///////////////////////////////////
    //                               //
    //                               //
    //                               //
    //                               //
    //       SPECIAL COMMANDS        //
    //                               //
    //                               //
    //                               //
    //                               //
    ///////////////////////////////////
    // Ignore echoed messages.
    if (channel==="kiawa_bot") return;

    if (message.toLowerCase() === '!hello') {
        // "@alca, heya!"
        postMessage(botID, `@${channel}, heya!`);
    }

    //server
    if (message.toLowerCase() === '!server') {
        var pick = servers[Math.floor(Math.random() * servers.length)]
        postMessage(botID, `I am on ${pick} Server!`);


        //time for a timeout
        if (pick === 'the BOP') {
            //  setTimeout(() => {apiPostRequest('moderation/bans', 'broadcaster_id=37055465&moderator_id=37055465', `{"data": {"user_id":"${tags["user-id"]},"duration":"69","reason":"Boop"}}`)
            setTimeout(() => { serverBoop(`${user_id}`, 69, 'Boop') }, 5000);
        }
    }

    if (message.toLowerCase() === '!yabai') {
        var pick = Math.floor(Math.random() * 101)
        if (pick < 50) {
            postMessage(botID, `@${channel} is ${pick}% yabai kiawaLuck`);
        }
        if (pick > 50 && pick < 100) {
            postMessage(botID, `@${channel} is ${pick}% yabai kiawaS`);
        }
        if (pick === 50) {
            postMessage(botID, `@${channel} is ${pick}% yabai kiawaBlank`);
        }
        if (pick > 99) {
            postMessage(botID, `@${channel} is ${pick}% yabai kiawaBONK`);
        }
    }

    if (message.toLowerCase() === '!seiso') {
        var pick = Math.floor(Math.random() * 101)
        if (pick < 50) {
            postMessage(botID, `@${channel} is ${pick}% seiso kiawaS`);
        }
        if (pick > 50 && pick < 100) {
            postMessage(botID, `@${channel} is ${pick}% seiso kiawaAYAYA`);
        }
        if (pick === 50) {
            postMessage(botID, `@${channel} is ${pick}% seiso kiawaBlank`);
        }
        if (pick > 99) {
            postMessage(botID, `@${channel} is ${pick}% seiso kiawaPray`);
        }
    }
    //split the message to pull out the command from the first word
    //creates an array of space delimited entries
    const args = message.split(/\s+/);

    //take the first entry and convert to lowercase, this is to check for addquote or quote command
    var command = args[0].toLowerCase();
    ///////////////////////////////////
    //                               //
    //                               //
    //                               //
    //                               //
    //    CHAT COMMAND INTERFACE     //
    //                               //
    //                               //
    //                               //
    //                               //
    ///////////////////////////////////

    //add command
    if (command === '!addcommand') {

        //check if user is in the allow_List (AKA, is a MOD or approved person)
        if (allow_List.includes(channel) || ismod === true ) {


            //Grab the Current Command total
            jsonfile.readFile(command_Path, async function(err, command_List) {
                if (err) {
                    console.error(err)
                }

                //search the relevant field in the json
                var command_Count = command_List.find(
                    (search) => {
                        return search.Command_Count;
                    }
                );

                //the comparison needs a number and not a string, convert it here
                command_Count = Number(command_Count.Command_Count);
                command_Count = command_Count + 1;
                
                const parsed = validateCommandArguments(command, args);
                if (!parsed.valid) {
                    postMessage(botID, parsed.error || 'Usage: !addcommand <tag> <response>');
                    return;
                }
                const command_Tag = parsed.tag;
                const command_Text = parsed.text;

                //Generate json format data object to add to the file
                const command_Formatted = { Index: `${command_Count}`, Tag: `${command_Tag}`, Response: `${command_Text}`, Timer: 'No' }

                //Update the command count in the json file
                command_List[0].Command_Count = `${command_Count}`

                //add the new command to the json object
                command_List.push(command_Formatted)

                //dump out a new file
                try {
                    writeAtomicSync(command_Path, command_List, { spaces: 2 })
                    
                }
                catch (error) {
                    console.error('[Command] Failed to write command file:', error.message);
                    postMessage(botID, `Adding command failed, retrying...`);
                }
                //respond with success?
                postMessage(botID, `Added Command "!${command_Tag}"`);
            });
        }
    }
    //edit command
    if (command === '!editcommand') {

        //check if user is in the allow_List (AKA, is a MOD or approved person)
        if (allow_List.includes(channel) || ismod === true) {

            const parsed = validateCommandArguments(command, args);
            if (!parsed.valid) {
                postMessage(botID, parsed.error || 'Usage: !editcommand <tag> <response>');
                return;
            }
            const command_Tag = parsed.tag;
            const command_Text = parsed.text;

            //search the relevant field in the json

            jsonfile.readFile(command_Path, async function(err, command_List) {
                if (err) {
                    console.error('[Command] Failed to read command file:', err.message);
                    return;
                }
                //search for the command tag and get all the info
                var command_Info = command_List.find(
                    (search) => {
                        return search.Tag === command_Tag;
                    }
                );

                if (!command_Info) {
                    postMessage(botID, `Command "!${command_Tag}" not found.`);
                    return;
                }

                //update the command text
                command_List[Number(command_Info.Index)].Response = command_Text

                //dump out a new file
                writeAtomicSync(command_Path, command_List, { spaces: 2 })

                //respond with success?
                postMessage(botID, `Command "!${command_Tag}" Updated Successfully!`);
            });
        };
    };
    ///////////////////////////////////
    //                               //
    //                               //
    //                               //
    //                               //
    //        TIME FOR QUOTES        //
    //                               //
    //                               //
    //                               //
    //                               //
    ///////////////////////////////////

    if (command === "!quote") {
        
        //check and see if a specific number was requested
        const rawId = args.slice(1).join(" ");
        let id = castIdToNumber(rawId);
        
        /** @type Quote */
        let quote;
        if (id > 0) {
            quote = quoteData.findByIndex(id);
        }
        else {
            quote = quoteData.findRandom();
        }
        
        if (quote) {
            // format all the bullshit and spit it out in the chat
            const message = `Quote #${quote.Index}: ${quote.Quote_Text} [${quote.Category}] [${quote.Date}]`;
            postMessage(botID, message);
        }
        else {
            const maxIndex = quoteData.getMaxIndex();
            postMessage(botID, `Number Provided out of range! The highest number is ${maxIndex}`);
        }
    }
    
    if (command === "!addquote") {
        //check if user is a mod or VIP allow_List.includes(tags.username) ||
        if (allow_List.includes(channel) || ismod === true || isvip === true) {
            
            //the remainder of the text is separated from the command, this is the quote text
            const textToAdd = args.slice(1).join(" ");
            
            //Grab the category info
            let categoryToAdd = "Unknown";
            try {
                const broadcast_info = await getChannelInfo(broadcasterID);
                if (broadcast_info && broadcast_info[0]?.game_name) {
                    categoryToAdd = broadcast_info[0].game_name;
                }
            } catch (err) {
                console.error('[Quote] Failed to get category info for quote:', formatAxiosError(err));
            }
            
            const addedQuote = quoteData.add(textToAdd, channel, categoryToAdd);
            
            if (addedQuote) {
                postMessage(botID, `Added Quote #${addedQuote.Index} ${addedQuote.Quote_Text} [${addedQuote.Category}] [${addedQuote.Date}]`);
            }
            else {
                postMessage(botID, `Quote couldn't be added... check the bot logs. kiawaSad`);
            }
        }
    }
    
    if (command === "!removequote") {
        if (isbroadcaster === true) {
            if (args.length === 2 && /^\d+$/.test(args[1])) {
                const removedQuote = quoteData.remove(args[1]);
                if (removedQuote) {
                    postMessage(botID, `Removed Quote #${removedQuote.Index}: ${removedQuote.Quote_Text}`);
                } else {
                    postMessage(botID, `Could not find Quote #${args[1]} to remove.`);
                }
            } else {
                postMessage(botID, `Usage: !removequote <number>`);
            }
        }
    }
    
    if (command === "!editquote") {
        //check if user is in the allow_List (AKA, is a MOD or approved person)
        if (allow_List.includes(channel) || ismod === true || isvip === true) {
            
            //check and see if a specific number was requested
            const idToUpdate = args[1] ? args[1].toLowerCase() : undefined;
            
            //this takes everything after the quote number and recombines it to be the updated quote text to be written
            const textToUpdate = args.slice(2).join(" ");
            
            //update the quote
            const updatedQuote = quoteData.edit(idToUpdate, textToUpdate);
            
            if (updatedQuote) {
                postMessage(botID, `Updated Quote #${updatedQuote.Index} ${updatedQuote.Quote_Text}`);
            }
            else {
                //Grab the highest quote ID
                const maxIndex = quoteData.getMaxIndex();
                postMessage(botID, `Number Provided out of range! The highest number is ${maxIndex}`);
            }
            
        }
    }

    if (command === '!so')

        //check if user is allowed to use the command (VIP/mods/allow list only)
        if (allow_List.includes(channel) || ismod === true || isvip === true) {
 
            //get user id
            try {
                const user_Name = args.slice(1).join(' ').replaceAll('@', '');
                if (!user_Name){
                    postMessage(botID, `You need to give me someone to shoutout silly!`);
                }
                else{
                    const user_Info = await getUserInfo(user_Name);
                    if (!user_Info[0]){
                        postMessage(botID, `Sorry, no idea who that is kiawaDed`);
                    }
                    else{
                        const userID=user_Info[0].id;
                        //use the user id to get the game name if their last streamed game
                        const broadcast_info = await getChannelInfo(userID);
                        //const broadcast_info= await axios.get('https://api.twitch.tv/helix/channels?broadcaster_id=37055465', axiosConfig);
                        const category = broadcast_info[0].game_name;
                        postMessage(botID, `join us in following @${user_Name}! they were recently streaming ${category}, over at twitch.tv/${user_Name} that's neat! kiawaCheer`);
                    }
                }
            }
            catch (err) {
                console.log(err)
            }

            //I don't know how errors work so this just stops it from clogging the window
        }

    //update incentive goal and bot command id
    if (command === '!updateincentive') {
        //check if user is in the allow_List (AKA, is a MOD or approved person)
        if (allow_List.includes(channel) || ismod === true) {
            const parsed = validateCommandArguments(command, args);
            if (!parsed.valid) {
                postMessage(botID, parsed.error || 'Usage: !updateincentive <command> <goal>');
                return;
            }
            const currentGoal = Number(incentiveData.read('incentive.goal')) || 0;
            incentiveData.update('incentive.goal', parsed.goal);
            incentiveData.update('incentive.command', parsed.identifier);
            console.info('Incentive Goal Updated from $' + currentGoal + ' to $' + parsed.goal);
            postMessage(botID, 'Incentive Goal Updated from $' + currentGoal + ' to $' + parsed.goal);
        }
    }

    //command flow: person uses !duel
    //next person to use !duel will fight the initial person
    //bot easks each of them to select a weapon (it can be anything that they type)
    //determine a winner via coinflip, loser gets blasted for x amount of time
    //score added for number of duels won
    if (command === '!duel') {
        let dueler = `${channel}`;
        let duelerID = `${tags["chatter_user_id"]}`;
        let weapon = (args.slice(1).join(' ') ?? "").trim();
        if (!weapon) {
            weapon = 'fists';
        }

        if (Duelers.length > 20) {
            postMessage(botID, `@${channel} the duel queue is currently full! Please wait a moment and try again.`);
            return;
        }

        if (Duelers.length > 0 && Duelers[Duelers.length - 1].dueler === dueler) {
            postMessage(botID, `@${channel} is trying to duel themself and that's kind of sad...`)
        }
        else {
            Duelers.push({ dueler, weapon, duelerID })

            if (Duelers.length % 2 == 0) {

                postMessage(botID, `@${channel} has accepted ${Duelers[Duelers.length - 2].dueler}'s duel and will be fighting with their ${weapon}`)
            }
            else {
                postMessage(botID, `@${channel} wants to duel with their ${weapon}!! Type '!duel' to fight them!`);
            }
        }
    }
    if (command === '!addincentive') {
        //check if user is in the allow_List (AKA, is a MOD or approved person)
        if (allow_List.includes(channel) || ismod === true) {
            const parsed = validateCommandArguments(command, args);
            if (!parsed.valid) {
                postMessage(botID, parsed.error || 'Usage: !addincentive <amount>');
                return;
            }
            const currentAmount = Number(incentiveData.read('incentive.amount')) || 0;
            const new_Amount = currentAmount + parsed.amount;
            incentiveData.update('incentive.amount', new_Amount);
            console.info('Incentive Amount Updated from $' + currentAmount.toFixed(2) + ' to $' + new_Amount.toFixed(2));
            postMessage(botID, 'Incentive Amount Updated from $' + currentAmount.toFixed(2) + ' to $' + new_Amount.toFixed(2));
        }
    }

    ///////////////////////////////////
    //                               //
    //                               //
    //                               //
    //                               //
    //       CHAT COMMAND CALL       //
    //                               //
    //                               //
    //                               //
    //                               //
    ///////////////////////////////////

    //Check if the message has an "!" in it
    if (command.charAt(0) === '!') {
        //remove "!" from the search text
        command = command.slice(1);
        postCommand(command);
    }
}; //on message top level bracket
