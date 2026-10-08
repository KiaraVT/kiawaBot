//load all the required crap
import TES from "tesjs";
import axios from "axios";
import path from 'path';
//import open from "open";
import jsonfile from "jsonfile";
const quote_Path = './data/quotes.json';
const streak_Path = './data/streaks.json';
const command_Path = './data/command_List.json';
import AuthDataHelper from "./AuthDataHelper.js";
import IncentiveHelper from "./IncentiveHelper.js";
import QuoteHelper, {castIdToNumber} from "./QuoteHelper.js";
import { WebSocketServer } from "ws";
import express from "express"

import querystring from "qs"
import { spawn } from "child_process"
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
const redirectUri = 'http://127.0.0.1:' + oAuthPort
const yt_oAuthPort = 5000;
const yt_redirectUri = 'http://127.0.0.1:' + oAuthPort
//variables to store auth-related data
let validationTicker = null;
let twitchAuthReady = false;

//setup for server that will listen for OAuth stuff so we can get our Access Token when the user consents
const authListener = express();
authListener.listen(oAuthPort);
authListener.get("/", (req, res) => {

    exchangeCodeForAccessToken(req.query.code)
        .then(tokenData => {
            res.send("You're now Authorized!  You can close this tab and return to the bot");
            authData.update('twitchBroadcaster.access_token', tokenData.access_token);
            authData.update('twitchBroadcaster.refresh_token', tokenData.refresh_token);
            validateAccessToken();
            validationTicker = setInterval(() => { validateAccessToken(); }, 1000 * 600);
        })
        .catch(error => {
            //res.send("Error during authorization");
            twitchAuthReady = false;
            console.log(error);
        })
});
// Start executing the bot from here

//Begin the auth process by opening the user's browser to the consent screen
//await startAuth()
async function startAuth() {

    const authQueryString = querystring.stringify({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(' ')
    });
    const authUrl = 'https://id.twitch.tv/oauth2/authorize?' + authQueryString;
    //await open(authUrl);
    // switch (process.platform) {
    //     case 'win32':
    //         await spawn('cmd', ['/c', 'start', '""', `"${authUrl}"`])
    //         break;
    //     case 'linux':
    //         await spawn('xdg-open', [authUrl])
    //         break;
    //     case 'darwin':
    //         await spawn('open', [authUrl])
    //         break;
    //     case _:
    //         console.error(`${process.platform} isn't supported for authentication`)
    //         process.exit(1);
    // }
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

//attempt to refresh the Access Token using the Refresh Token
function refreshAccessToken() {
    const postDataBroadcaster = {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: authData.read('twitchBroadcaster.refresh_token'),
    };

    const postDataBot = {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: authData.read('twitchBot.refresh_token'),
    };

    console.log('Attempting to refresh Access Token for Broadcaster...');

    axios.post("https://id.twitch.tv/oauth2/token", postDataBroadcaster)
        .then(response => {
            console.log('Access Token was successfully refreshed');
            authData.update('twitchBroadcaster.access_token', response.data.access_token);
            authData.update('twitchBroadcaster.refresh_token', response.data.refresh_token);
            validateAccessToken();
        })
        .catch(error => {
            if (error.response.status === 401 || error.response.status === 400) {
                console.log('Unable to refresh Access Token, requesting new auth consent from user');
                authData.update('twitchBroadcaster.access_token', '');
                authData.update('twitchBroadcaster.refresh_token', '');
                twitchAuthReady = false;
                clearInterval(validationTicker)
                // clearInterval(accessRefresh)
                startAuth();
            } else {
                console.log(error);
            }
        });
        console.log('Attempting to refresh Access Token for Bot...')
            axios.post("https://id.twitch.tv/oauth2/token", postDataBot)
        .then(response => {
            console.log('Access Token was successfully refreshed');
            authData.update('twitchBot.access_token', response.data.access_token);
            authData.update('twitchBot.refresh_token', response.data.refresh_token);
            validateAccessToken();
        })
        .catch(error => {
            if (error.response.status === 401 || error.response.status === 400) {
                console.log('Unable to refresh Access Token, requesting new auth consent from user');
                authData.update('twitchBot.access_token', '');
                authData.update('twitchBot.refresh_token', '');
                twitchAuthReady = false;
                clearInterval(validationTicker)
                // clearInterval(accessRefresh)
                startAuth();
            } else {
                console.log(error);
            }
        });
}

//attempt to validate the Access Token to be sure it is still valid
function validateAccessToken() {
    console.log('Attempting to validate Access Token...');

    axios.get("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: 'Bearer ' + authData.read('twitchBroadcaster.access_token') }
    })
        .then(response => {
            console.log('Access Token for Broadcaster was successfully validated');
            if (twitchAuthReady === false) {
                twitchAuthReady = true;
                handleInitialAuthValidation();
            }
        })
        .catch(error => {
            if (error?.response?.status === 401) {
                console.log('Unable to validate Access Token, requesting a fully refreshed token');
            }
            else {
                console.log('Unable to validate Access Token for an unexpected reason; requesting a fully refreshed token', error);
            }
            // no matter what went wrong when validating, let's just refresh the token entirely to try and recover?
            twitchAuthReady = false;
            refreshAccessToken();
        })
    axios.get("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: 'Bearer ' + authData.read('twitchBot.access_token') }
    })
        .then(response => {
            console.log('Access Token for Broadcaster was successfully validated');
            if (twitchAuthReady === false) {
                twitchAuthReady = true;
                handleInitialAuthValidation();
            }
        })
        .catch(error => {
            if (error?.response?.status === 401) {
                console.log('Unable to validate Access Token, requesting a fully refreshed token');
            }
            else {
                console.log('Unable to validate Access Token for an unexpected reason; requesting a fully refreshed token', error);
            }
            // no matter what went wrong when validating, let's just refresh the token entirely to try and recover?
            twitchAuthReady = false;
            refreshAccessToken();
        })
}

//send a GET request to the Twitch API
function apiGetRequest(method, parameters) {
    return new Promise((resolve, reject) => {
        if (!twitchAuthReady) reject(new Error("twitch not yet authorized, wait a bit and try again"));

        const requestQueryString = querystring.stringify(parameters);
        const axiosConfig = {
            headers: {
                "Authorization": "Bearer " + authData.read('twitchBroadcaster.access_token'),
                "Client-Id": clientId
            }
        }
        axios.get("https://api.twitch.tv/helix/" + method + "?" + requestQueryString, axiosConfig)
            .then(response => resolve(response.data))
            .catch(error => {
                if (error.response.status === 401) {
                    console.log('Unable to validate Access Token, requesting a refreshed token');
                    refreshAccessToken();
                }
                reject(error);
            });
    });
}

//send a POST request to the Twitch API
function apiPostRequest(method, parameters, data) {
    return new Promise((resolve, reject) => {
        if (!twitchAuthReady) reject(new Error("twitch not yet authorized, wait a bit and try again"));
        const requestQueryString = querystring.stringify(parameters);
        const axiosConfig = {

            headers: {
                "Authorization": "Bearer " + authData.read('twitchBroadcaster.access_token'),
                "Client-Id": clientId,
                "Content-Type": 'application/json'
            }
        }
        axios.post("https://api.twitch.tv/helix/" + method + "?" + requestQueryString, data, axiosConfig)
            .then(response => resolve(response.data))
            .catch(error => {
                if (error.response.status === 401) {
                    console.log('Unable to validate Access Token, requesting a refreshed token');
                    refreshAccessToken();
                }
                if (error.response.status === 400) {
                    console.log(error.response.data.message);
                }
                reject(error);
            });
    });
}

function apiPostRequestBot(method, parameters, data) {
    return new Promise((resolve, reject) => {
        if (!twitchAuthReady) reject(new Error("twitch not yet authorized, wait a bit and try again"));
        const requestQueryString = querystring.stringify(parameters);
        const axiosConfig = {

            headers: {
                "Authorization": "Bearer " + authData.read('twitchBot.access_token'),
                "Client-Id": clientId,
                "Content-Type": 'application/json'
            }
        }
        axios.post("https://api.twitch.tv/helix/" + method + "?" + requestQueryString, data, axiosConfig)
            .then(response => resolve(response.data))
            .catch(error => {
                if (error.response.status === 401) {
                    console.log('Unable to validate Access Token, requesting a refreshed token');
                    refreshAccessToken();
                }
                if (error.response.status === 400) {
                    console.log(error.response.data.message);
                }
                reject(error);
            });
    });
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
    return new Promise((resolve, reject) => {
        apiPostRequestBot('chat/messages', { broadcaster_id: broadcasterID, sender_id: user_id, message: message})
    })
}

//handle changes to the status of the auth-data file
function handleAuthFileStatusChange(status) {
    console.log('Auth File status changed: ' + status);
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
    console.log('Incentive File status changed: ' + status);
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
            console.log('Got channel data!', channel_data);
        })
        .catch(error => {
            console.log(error);
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
                            console.log(`Repairing EventSub subscriptions: failed to recreate ${type} with ${JSON.stringify(fallbackCondition)}`);
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
    //first check if stream is online, if not, then exit funcion.
        return new Promise((resolve, reject) => {
           apiGetRequest('streams', { user_id: broadcasterID, type: 'all', first: '1' })
                .then(data => {
                    resolve(data.data);
            if (data.data[0]===undefined) {
                console.log('stream is offline, will not update streaks');
                return;
            }
            else{
                try {
                    if (userId && userName) {
                        console.log('updating user streak!')
                        updateStreaks(userId, userName, sayItOutLoud);
                    }
                    else {
                        // could have been something like an anonymous cheer
                        console.log("No user given when updating a streak?  That's probably okay once in a while.");
                    }
                    return true;
                }
                catch (e) {
                    console.log("updateStreaks failed!", e);
                    return false;
                }
            }
            })
            
})
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
    let streak_List
    try { streak_List = jsonfile.readFileSync(streak_Path) }
    catch (e) { }

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
    let streak_List
    try { streak_List = jsonfile.readFileSync(streak_Path) }
    catch (e) { }
    //if file is empty then initialize it
    if (!streak_List) {
        console.log("No File, Creating New File");
        let lastStart = event.started_at;
        console.log(lastStart)
        let currentStart = event.started_at;
        const initializeStreaks = { Last_Stream: { Start: `${lastStart}`, End: '' }, Current_Stream: { Start: `${lastStart}` }, Users: {} }
        writeAtomicSync(streak_Path, initializeStreaks, { spaces: 2, EOL: "\n" })
    }

    //if file is not empty, update stream info
    else {
        console.log("Updating Current Stream Date");
        let currentStart = new Date(event.started_at);
        let currentStartISO = currentStart;
        let lastStart = new Date(streak_List.Last_Stream.Start); 
        let lastEnd = new Date(streak_List.Last_Stream.End);
        let backupEnd=new Date(streak_List.Last_Stream.Backup_End);
        let savedStart=new Date(streak_List.Current_Stream.Start);
        currentStart = Date.parse(currentStart);
        lastStart = Date.parse(lastStart);
        lastEnd = Date.parse(lastEnd);
        backupEnd=Date.parse(backupEnd);
        //update stream times
        //the end of stream was not detected last time, reset the end to a blank value
        if (!lastEnd) {
            console.log('End time was null');
                streak_List.Last_Stream.Start = streak_List.Current_Stream.Start;
                streak_List.Current_Stream.Start = currentStartISO;
                writeAtomicSync(streak_Path, streak_List, { spaces: 2, EOL: "\n" });

        }
        
        else if ((currentStart - backupEnd) < 5*60*60*1000) {
                //stream offline was detected, but new stream is within 5 hours of old stream, don't update anything
                console.log('Stream Started shortly after last stream, do not update times')
        }
        else if (backupEnd < lastStart) {
            console.log('stream end detection did not work last stream');
            streak_List.Last_Stream.End = "";
            streak_List.Last_Stream.Start = streak_List.Current_Stream.Start;
            streak_List.Current_Stream.Start = currentStartISO;
            writeAtomicSync(streak_Path, streak_List, { spaces: 2, EOL: "\n" })
        }
        //all is good, do standard procedure



        else {
            console.log('all is good on stream online check')
            streak_List.Last_Stream.Start = streak_List.Current_Stream.Start;
            streak_List.Current_Stream.Start = currentStartISO;
            streak_List.Last_Stream.End=streak_List.Last_Stream.Backup_End;
            Object.keys(userIdsWhoAlreadyStreaked).forEach(key => delete userIdsWhoAlreadyStreaked[key]);
            writeAtomicSync(streak_Path, streak_List, { spaces: 2, EOL: "\n" })
        }
        console.log(lastStart);
        console.log(lastEnd);
        console.log(currentStart);
    }
});

tesManager.queueSubscription('stream.offline', subCondition, event => {
    let streak_List
    try { streak_List = jsonfile.readFileSync(streak_Path) }
    catch (e) { }
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

let streamInfo = setTimeout(() => getStreamInfo(broadcasterID, 'all', '1'), 2000);

function getStreamInfo(broadcaster_id, type, first) {
    return new Promise((resolve, reject) => {
        console.log('Updating Stream Start Time')
        apiGetRequest('streams', { user_id: broadcaster_id, type: type, first: first })
            .then(data => {
                resolve(data.data);
                 let streak_List
        try { streak_List = jsonfile.readFileSync(streak_Path) }
        catch (e) { }
        if (data.data[0]===undefined) {
            console.log('stream is offline, will not update streaks');
            return;
        }
        //if file is empty then initialize it
        if (!streak_List) {
            console.log("No File, Creating New File");
            let lastStart = data.data[0].started_at;
            console.log(lastStart)
            const initializeStreaks = { Last_Stream: { Start: `${lastStart}`, End: '' }, Current_Stream: { Start: `${lastStart}` }, Users: {} }
            writeAtomicSync(streak_Path, initializeStreaks, { spaces: 2, EOL: "\n" })
        }
        else {
            let currentStart = new Date(data.data[0].started_at);
            let currentStartISO = currentStart;
            let sanityCheck = new Date(streak_List.Current_Stream.Start);
            currentStart = Date.parse(currentStart);
            sanityCheck = Date.parse(sanityCheck);
            if ((currentStart - sanityCheck) < 5*60*60*1000) {
                console.log('Bot Restarted, do not update times')
            }
            //if file is not empty, update stream info
            else {
                console.log("Updating Current Stream Date");
                console.log(data.data[0].started_at);
                let lastStart = new Date(streak_List.Last_Stream.Start);
                lastStart = Date.parse(lastStart);
                let lastEnd = new Date(streak_List.Last_Stream.End);
                let backupEnd=new Date(streak_List.Last_Stream.Backup_End);
                let savedStart=new Date(streak_List.Current_Stream.Start);
                lastEnd = Date.parse(lastEnd);
                backupEnd=Date.parse(backupEnd);
                console.log(currentStart - backupEnd)
                //update stream times
                //the end of stream was not detected last time, reset the end to a blank value
                if (!lastEnd) {
                    console.log('End time was null');
                    streak_List.Last_Stream.Start = streak_List.Current_Stream.Start;
                    streak_List.Current_Stream.Start = currentStartISO;
                    writeAtomicSync(streak_Path, streak_List, { spaces: 2, EOL: "\n" });

                }
                
                else if ((currentStart - backupEnd) < 5*60*60*1000) {
                    //stream offline was detected, but new stream is within 5 hours of old stream, don't update anything
                    console.log('Stream Started shortly after last stream, do not update times')
                }
                else if (backupEnd < lastStart) {
                    console.log('stream end detection did not work last stream');
                    streak_List.Last_Stream.End = "";
                    streak_List.Last_Stream.Start = streak_List.Current_Stream.Start;
                    streak_List.Current_Stream.Start = currentStartISO;
                    writeAtomicSync(streak_Path, streak_List, { spaces: 2, EOL: "\n" })
                }
                //all is good, do standard procedure
                else {
                    console.log('all is good on stream online check')
                    streak_List.Last_Stream.Start = streak_List.Current_Stream.Start;
                    streak_List.Current_Stream.Start = currentStartISO;
                    streak_List.Last_Stream.End=streak_List.Last_Stream.Backup_End;
                    Object.keys(userIdsWhoAlreadyStreaked).forEach(key => delete userIdsWhoAlreadyStreaked[key]);
                    writeAtomicSync(streak_Path, streak_List, { spaces: 2, EOL: "\n" })
                }
                console.log(lastStart);
                console.log(lastEnd);
                console.log(currentStart);
            }
        }
            })

            .catch(error => reject(error))
    });
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
                //check and make sure a command field was added
                try {
                    var command_Tag = args[1].toLowerCase();

                    //this takes everything after the command identifier and recombines it to be the new command text
                    var command_Text = args.slice(2).join(' ');
                }

                //check for a leading ! and remove it if it was Added

                //I don't know how errors work so this just stops it from clogging the window
                catch (err) {
                    console.log('hmm command error!')
                }

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

            //check and make sure a command field was added
            try {
                var command_Tag = args[1].toLowerCase();

                //this takes everything after the command identifier and recombines it to be the new command text
                var command_Text = args.slice(2).join(' ');
            }

            //I don't know how errors work so this just stops it from clogging the window
            catch (err) {
            }

            //search the relevant field in the json

            jsonfile.readFile(command_Path, async function(err, command_List) {
                if (err) {
                    console.error(err)
                }
                //search for the command tag and get all the info
                var command_Info = command_List.find(
                    (search) => {
                        return search.Tag === command_Tag;
                    }
                );

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
            const broadcast_info = await getChannelInfo(broadcasterID);
            const categoryToAdd = broadcast_info[0].game_name;
            
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
            //Grab the Current incentive goal
            incentiveGoal = incentiveData.read('incentive.goal');
            incentiveGoal = incentiveData.read('incentive.goal');
            //Check if a number was specified in the 2nd field
            //check and see if a specific number was requested
            try {
                var new_Identifier = '!' + args[1].toLowerCase()
                var new_Goal = args.slice(2).join(' ');
            }

            //I don't know how errors work so this just stops it from clogging the window
            catch (err) {
            }

            new_Goal = Number(new_Goal);
            console.log(new_Goal)
            if (Number.isFinite(new_Goal)) {
                incentiveData.update('incentive.goal', new_Goal);
                incentiveData.update('incentive.command', new_Identifier);
                console.log('Incentive Goal Updated from $' + incentiveGoal + ' to $' + new_Goal)
                postMessage(botID, 'Incentive Goal Updated from $' + incentiveGoal + ' to $' + new_Goal);
            }
            //updateIncentiveFile();
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
        console.log(weapon)
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
            //Grab the Current incentive goal
            incentiveAmount = incentiveData.read('incentive.amount');
            incentiveGoal = incentiveData.read('incentive.goal');

            //Check if a number was specified in the 2nd field
            try {
                var new_Amount = args.slice(1).join(' ');
            }

            //I don't know how errors work so this just stops it from clogging the window
            catch (err) {
            }

            new_Amount = Number(new_Amount) + Number(incentiveAmount);
            if (Number.isFinite(new_Amount)) {
                incentiveData.update('incentive.amount', new_Amount);
                console.log('Incentive Amount Updated from $' + incentiveData.read('incentive.amount').toFixed(2) + ' to $' + new_Amount.toFixed(2))
                postMessage(botID, 'Incentive Amount Updated from $' + incentiveAmount.toFixed(2) + ' to $' + new_Amount.toFixed(2));
            }
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
