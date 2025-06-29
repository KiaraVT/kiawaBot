//load all the required crap
const tmi = require('tmi.js');
const TES = require("tesjs");
require('dotenv').config();
const axios = require('axios');
const jsonfile = require('jsonfile');
const quote_Path = './data/quotes.json';
const command_Path = './data/command_List.json';
//This is the included AuthDataHelper.js file
const AuthDataHelper = require('./AuthDataHelper');
const IncentiveHelper = require('./IncentiveHelper');
const WebSocket = require('ws');
//make sure you've installed axios and express into your project
const express = require("express");

//These come from things built into node.js
const querystring = require('qs');
const spawn = require('child_process').spawn;
//Include line reading module
const fs = require('fs');
//const { getFileCache } = require("./FileCacheService");
const t1Value = 3.60;
const t2Value = 6.00;
const t3Value = 17.50;
const primeValue = 2.50;
const broadcasterID=37055465;
const channelName='#kiara_tv';
//details for Twitch OAuth
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const botID = process.env.BOT_ID;
var incentiveAmount;
var incentiveGoal;
const timedCommands=['discord', 'kofi','socials2', 'socials1', 'links','patreon','youtube','archives'];
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
    'moderator:read:blocked_terms',
    'moderator:read:chat_settings',
    'moderator:read:unban_requests',
    'moderator:read:banned_users',
    'moderator:read:chat_messages',
    'moderator:read:moderators',
    'moderator:read:vips'
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
const redirectUri = 'http://localhost:' + oAuthPort
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
            authData.update('twitch.access_token', tokenData.access_token);
            authData.update('twitch.refresh_token', tokenData.refresh_token);
            validateAccessToken();
            validationTicker = setInterval(() => { validateAccessToken(); }, 1000 * 600);
        })
        .catch(error => {
            //res.send("Error during authorization");
            twitchAuthReady = false;
            console.log(error);
        })
});

//Begin the auth process by opening the user's browser to the consent screen
async function startAuth() {

    const authQueryString = querystring.stringify({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes.join(' ')
    });
    const authUrl = "https://id.twitch.tv/oauth2/authorize?" + authQueryString.replace(/&/g, "^&");
    await spawn('cmd', ["/c", "start", authUrl]);
    console.log('made it to end of startauth')
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
    const postData = {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: authData.read('twitch.refresh_token'),
    };

    console.log('Attempting to refresh Access Token...');

    axios.post("https://id.twitch.tv/oauth2/token", postData)
        .then(response => {
            console.log('Access Token was successfully refreshed');
            authData.update('twitch.access_token', response.data.access_token);
            authData.update('twitch.refresh_token', response.data.refresh_token);
            validateAccessToken();
        })
        .catch(error => {
            if (error.response.status === 401 || error.response.status === 400) {
                console.log('Unable to refresh Access Token, requesting new auth consent from user');
                authData.update('twitch.access_token', '');
                authData.update('twitch.refresh_token', '');
                twitchAuthReady = false;
                clearInterval(validationTicker)
                clearInterval(accessRefresh)
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
        headers: { Authorization: 'Bearer ' + authData.read('twitch.access_token') }
    })
        .then(response => {
            console.log('Access Token was successfully validated');
            if (twitchAuthReady === false) {
                twitchAuthReady = true;
                handleInitialAuthValidation();
            }
        })
        .catch(error => {
            if (error.response.status === 401) {
                console.log('Unable to validate Access Token, requesting a refreshed token');
                twitchAuthReady = false;
                refreshAccessToken();
            }
        })
}

//send a GET request to the Twitch API
function apiGetRequest(method, parameters) {
    return new Promise((resolve, reject) => {
        if (!twitchAuthReady) reject(new Error("twitch not yet authorized, wait a bit and try again"));

        const requestQueryString = querystring.stringify(parameters);
        const axiosConfig = {
            headers: {
                "Authorization": "Bearer " + authData.read('twitch.access_token'),
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
                "Authorization": "Bearer " + authData.read('twitch.access_token'),
                "Client-Id": clientId,
                "Content-Type": 'application/json'
            }
        }
        //axios.post("https://api.twitch.tv/helix/" + method + "?" + requestQueryString, axiosConfig)
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
        apiPostRequest('moderation/bans', { broadcaster_id: 37055465, moderator_id: 37055465 }, { "data": { "user_id": user_id, "duration": duration, "reason": reason } })
            .then(data => resolve(data.data))
            .catch(error => {
                console.log("Error when doin' a boop");
                setTimeout(() => { client.say('#kiara_tv', 'kiawaBONK kiawaBONK') }, 3000);
                setTimeout(() => { client.say('#kiara_tv', 'kiawaWat') }, 6000);
                setTimeout(() => { client.say('#kiara_tv', 'kiawaPuff') }, 8000);
                setTimeout(() => { client.say('#kiara_tv', 'kiawaBONK kiawaBONK kiawaBONK') }, 11000);
                setTimeout(() => { client.say('#kiara_tv', 'kiawaDed') }, 13000);

            });
        client.say('#kiara_tv', 'kiawaBONK');
    });
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
    console.log(incentiveAmount);
    console.log(incentiveGoal);
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
    getChannelInfo(37055465)
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
authData.statusCallback = handleAuthFileStatusChange;
authData.loadData();
validateAccessToken();
validationTicker = setInterval(() => { validateAccessToken(); }, 1000 * 600);
incentiveData.statusCallback = handleIncentiveFileStatusChange;
incentiveData.loadData();
if (!fs.existsSync('./data/incentives.txt')) {
    const content = incentiveData.read('incentive.command') + ' $' + Number(incentiveData.read('incentive.amount')).toFixed(2) + ' / $' + incentiveData.read('incentive.goal');

    fs.writeFile('./data/incentive.txt', content, err => {
        if (err) {
            console.error(err);
        } else {
            // file written successfully
        }
    });
}
if (this.statusCallback) this.statusCallback("loaded");

//LISTENING SECTION

class TesManager {
    // TES doesn't provide strong typing, so some of these could be more detailed if we wanted to put in the effort.
    /** @typedef {(event: Event) => any} TesEventHandler */
    /** @typedef {{type: string, condition: object, callback?: TesEventHandler}} TesSubscriptionParams */
    
    /** @type {TES} */
    #tes;

    /** @type {TesSubscriptionParams[]} */
    #pendingSubscriptions = [];

    /** @type {NodeJS.Timeout} */
    #intervalId;

    constructor() {
        this.#tes = this.#buildTesInstance();

        // Kiara had success with doing these faster, but Twitch docs say the limit is 20 subscriptions per 10 seconds.
        // May need to increase this delay if the number of subscriptions goes up.
        const subscriptionDelayMillis = 100;

        // Handle queued subscription requests one-by-one to respect Twitch rate limiting
        this.#intervalId = setInterval(async () => {
            const input = this.#pendingSubscriptions.shift();
            if (input) {
                const { type, condition, callback } = input;
                
                // If there was a connection_lost event, TesManager doesn't retain the callback from that subscription.  callback will be undefined.
                // But the event listener (from TES#on) hasn't been unregistered, so we don't need to add a second listener.
                if (typeof callback === "function") {
                    const wrappedCallback = preventDuplicateEvents(callback);
                    this.#tes.on(type, wrappedCallback);
                }
                
                try {
                    const subscription = await this.#tes.subscribe(type, condition);
                    console.log("Subscription to event channel successful", subscription);
                }
                catch (error) {
                    console.log("Error subscribing to event channel.  Will try again shortly.", error);
                    this.#pendingSubscriptions.push(input);
                }
            }
        }, subscriptionDelayMillis);
    }

    /** @returns {TES} */
    #buildTesInstance() {
        try {
            const tes = new TES({
                identity: {
                    id: process.env.CLIENT_ID,
                    secret: process.env.CLIENT_SECRET,
                    accessToken: authData.read('twitch.access_token'),
                    refreshToken: authData.read('twitch.refresh_token')
                },
                listener: { type: "websocket", port: 8082 },
            });
            
            /**
             * Twitch revoked an EventSub subscription.  Maybe something related to the user revoking auth for the bot in general?
             * Nothing to be done here - resubscribing won't work on the fly, and your access token may even be entirely revoked.
             * 
             * @param {{id: string | number, type: string, condition: object}} subscription
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
                for (const {type, condition} of Object.values(subscriptionTypeAndConditionById)) {
                    // Calling this.queueSubscription would be technically incorrect because 'callback' is a required parameter for the public surface.
                    this.#pendingSubscriptions.push({ type, condition });
                }
            };
            tes.on("connection_lost", onConnectionLost);

            return tes;
        } catch (error) {
            //let's assume any error here is due to a bad access token and re-auth
            const warning = () => console.log("TES failed to initialize.  Could just be an authentication error - try restarting the bot after you reauth.", error);
            warning();
            startAuth();
            return {queueSubscription: warning}; // calls to queueSubscription won't crash the bot entirely
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
const subCondition = { broadcaster_user_id: process.env.BROADCASTER_ID };

/** @type {{[messageId: string]: NodeJS.Timeout}} */
const recentlySeenMessageIds = {};
/**
 * @see https://dev.twitch.tv/docs/eventsub/#handling-duplicate-events
 * 
 * @param {(event: Event, subscription: any) => void} callback
 * @returns {(event: Event, subscription: any) => void}
 */
function preventDuplicateEvents(callback) {
    return (event, subscription) => {
        const messageId = event.message_id;
        if (messageId) {
            const timeout = recentlySeenMessageIds[messageId];
            if (!timeout) {
                // The timeout does not exist.  This is the first time we've seen this message recently.
                // Create a timeout for a few seconds to check for future duplicates, and then handle the message itself.
        
                // We don't want to save every messageId we see for the entire lifetime of the bot (or beyond).  That's just leaking memory needlessly.
                // This message receipt will self destruct in 5 seconds.
                recentlySeenMessageIds[messageId] = setTimeout(() => delete recentlySeenMessageIds[messageId], 5000);
        
                callback(event, subscription);
            }
            else {
                // The timeout already exists.  The message is a duplicate.
                // Don't handle this message, but restart the timeout.
                timeout.refresh();
            }
        }
        else {
            // https://dev.twitch.tv/docs/eventsub/#handling-duplicate-events says all messages contain a message_id to allow deduplication.
            // They are liars.  Many events do not contain a message_id.
        }
    };
}

let websockets=[];
// setup websocket server for chat widget
const socket = new WebSocket.Server({ port: 8080 });
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
// tesManager.queueSubscription("channel.follow", subCondition, event => {
//     //Handle received New Follower events
//     console.log(event);
// });

/***************************************
 *          Cheer (Bits)               *
 ***************************************/
tesManager.queueSubscription("channel.cheer", subCondition, event => {
    //Handle received Cheer events
    console.log(event);
    incentiveAmount = incentiveData.read('incentive.amount');
    incentiveAmount = incentiveAmount + event.bits / 100
    if (event.bits === 999) {
        setTimeout(() => { serverBoop(`22587336`, 1800, 'TNT') }, 5000);
    }
    console.log(incentiveAmount);
    incentiveData.update('incentive.amount', incentiveAmount);
    updateIncentiveFile();
});

/***************************************
 *        New Subscriber               *
 ***************************************/
tesManager.queueSubscription("channel.subscribe", subCondition, event => {
    //Handle received New Subscriber events
    console.log(event);
    incentiveAmount = incentiveData.read('incentive.amount');
});

/***************************************
 *        Mod Action                   *
 ***************************************/
tesManager.queueSubscription("channel.chat.message_delete", { ...subCondition, user_id: process.env.BROADCASTER_ID }, messageDelete => {
    sendToAllChatWidgets({ kiawaAction: "Message_Delete", messageDelete });
});

tesManager.queueSubscription("channel.moderate", { ...subCondition, moderator_user_id: process.env.BROADCASTER_ID }, modAction => {
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
    updateIncentiveFile();
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
    updateIncentiveFile();
});





//connect to twitch chat
const client = new tmi.Client({
    options: { debug: true },
    identity: {
        username: 'Kiawa_Bot',

        //put this into environment variables later
        password: process.env.OAUTH
    },
    channels: ['Kiara_TV']
});

function updateIncentiveFile() {

    const content = incentiveData.read('incentive.command') + ' $' + Number(incentiveData.read('incentive.amount')).toFixed(2) + ' / $' + incentiveData.read('incentive.goal');

    fs.writeFile('./data/incentive.txt', content, err => {
        if (err) {
            console.error(err);
        } else {
            // file written successfully
        }
    });
}

//this function will search the command list file and if it finds a command, will send the response to chat
function postCommand(command){
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
                client.say(channelName, command_Output);
            }
            catch (error) {
                console.error(err);
            }
        });
}
//these two variables track activity and which timed command we are currently at.
let activityDetection=false
let commandIndex=0

//interval for timed chat commands that run automagically if chat activity has been recorded since last run
setInterval(()=>{
if (activityDetection===true){    
        //send the current command in the rotation to get posted
        postCommand(timedCommands[commandIndex]);
        //increment the array index, reset to 0 if past max
        commandIndex=(commandIndex+1) % timedCommands.length;
        //resert activity detection so that timed messages do not get spammed without chat activity
        activityDetection=false;
    }
},1200000)
// post first entry in array to postCommand
//increment to next array index, if at max loop back to start

//connect to chat
client.connect();

//message handler
client.on('message', async (channel, tags, message, self) => {
    //determine if chat activity in last 10 minutes
    if (tags.username != "kiawa_bot"){
        activityDetection=true;
    }
    
    // resolve badges for this message
    const messageBadges = [];
    if (tags.badges) {
        for (const [setId, versionId] of Object.entries(tags.badges)) {
            //parse out the badges that are part of this message
            const version = await getBadgeVersion(setId, versionId);
            if (version) {
                messageBadges.push(version);
            }
        }
    }
    
    //send to websocket
    sendToAllChatWidgets({ kiawaAction: "Message", channel, tags, message, messageBadges });

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
    if (self) return;

    if (message.toLowerCase() === '!hello') {
        // "@alca, heya!"
        client.say(channel, `@${tags.username}, heya!`);
    }

    //server
    if (message.toLowerCase() === '!server') {
        var pick = servers[Math.floor(Math.random() * servers.length)]
        client.say(channel, `I am on ${pick} Server!`);


        //time for a timeout
        if (pick === 'the BOP') {
            //  setTimeout(() => {apiPostRequest('moderation/bans', 'broadcaster_id=37055465&moderator_id=37055465', `{"data": {"user_id":"${tags["user-id"]},"duration":"69","reason":"Boop"}}`)
            setTimeout(() => { serverBoop(`${tags["user-id"]}`, 69, 'Boop') }, 5000);
        }
    }

    if (message.toLowerCase() === '!yabai') {
        var pick = Math.floor(Math.random() * 101)
        if (pick < 50) {
            client.say(channel, `@${tags.username} is ${pick}% yabai kiawaLuck`);
        }
        if (pick > 50 && pick < 100) {
            client.say(channel, `@${tags.username} is ${pick}% yabai kiawaS`);
        }
        if (pick === 50) {
            client.say(channel, `@${tags.username} is ${pick}% yabai kiawaBlank`);
        }
        if (pick > 99) {
            client.say(channel, `@${tags.username} is ${pick}% yabai kiawaBONK`);
        }
    }

    if (message.toLowerCase() === '!seiso') {
        var pick = Math.floor(Math.random() * 101)
        if (pick < 50) {
            client.say(channel, `@${tags.username} is ${pick}% seiso kiawaS`);
        }
        if (pick > 50 && pick < 100) {
            client.say(channel, `@${tags.username} is ${pick}% seiso kiawaAYAYA`);
        }
        if (pick === 50) {
            client.say(channel, `@${tags.username} is ${pick}% seiso kiawaBlank`);
        }
        if (pick > 99) {
            client.say(channel, `@${tags.username} is ${pick}% seiso kiawaPray`);
        }
    }
    //split the message to pull out the command from the first word
    //creates an array of space delimited entries
    const args = message.split(' ');

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
        if (allow_List.includes(tags.username) || tags.mod===true) {


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
                }

                //Generate json format data object to add to the file
                const command_Formatted = { Index: `${command_Count}`, Tag: `${command_Tag}`, Response: `${command_Text}`, Timer: 'No' }

                //Update the command count in the json file
                command_List[0].Command_Count = `${command_Count}`

                //add the new command to the json object
                command_List.push(command_Formatted)

                //dump out a new file
                jsonfile.writeFile(command_Path, command_List, { spaces: 2 }, function(err) {
                    if (err) console.error(err)
                })
                //respond with success?
                client.say(channel, `Added Command "!${command_Tag}"`);
            });
        }
    }
    //edit command
    if (command === '!editcommand') {

        //check if user is in the allow_List (AKA, is a MOD or approved person)
        if (allow_List.includes(tags.username) || tags.mod===true) {

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

                console.log(command_List.find(
                    (search) => {
                        return search.Tag === command_Tag;
                    }))
                //update the command text
                console.log(command_List)
                command_List[Number(command_Info.Index)].Response = command_Text

                //dump out a new file
                jsonfile.writeFile(command_Path, command_List, { spaces: 2 }, function(err) {
                    if (err) console.error(err)
                })

                //respond with success?
                client.say(channel, `Command "!${command_Tag}" Updated Successfully!`);
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




    //check if it is an add quote command
    if (command === '!addquote') {
        //check if user is a mod or VIP allow_List.includes(tags.username) || 
        if (allow_List.includes(tags.username) || tags.mod===true || tags.vip===true) {


            //the remainder of the text is separated from the command, this is the quote text
            const quote_Text = args.slice(1).join(' ');

            //Grab the Current Quote total
            jsonfile.readFile(quote_Path, async function(err, quote_List) {
                if (err) {
                    console.error(err)
                }

                //search the relevant field in the json
                var quote_Count = quote_List.find(
                    (search) => {
                        return search.Quote_Count;
                    }
                );

                //increase the quote count by 1
                quote_Count = Number(quote_Count.Quote_Count) + 1;

                //grab the username
                const quote_Requestor = tags.username;

                //Grab the category info code
                const broadcast_info = await getChannelInfo(37055465);
                //const broadcast_info= await axios.get('https://api.twitch.tv/helix/channels?broadcaster_id=37055465', axiosConfig);
                const category = broadcast_info[0].game_name;


                //get current date and time
                const TOD = new Date()
                let minutes = TOD.getMinutes();

                //make sure there are always two digits for the minutes
                let formatted_Minutes = minutes.toString().padStart(2, "0")
                if (TOD.getHours() >= 12) {
                    var hour_Minutes = TOD.getHours() - 12 + ":" + formatted_Minutes + " PM"
                }

                else {
                    var hour_Minutes = TOD.getHours() + ":" + formatted_Minutes + " AM"
                }

                //Heck 0 indexed months
                const month = TOD.getMonth() + 1;

                //put all the crap together
                const day_Formatted = (TOD.getFullYear()) + "/" + month + "/" + (TOD.getDate()) + " " + hour_Minutes

                //Generate json format data object to add to the file
                const quote_Formatted = { Index: `${quote_Count}`, Quote_Text: `${quote_Text}`, Submitter: `${quote_Requestor}`, Category: `${category}`, Date: `${day_Formatted}` }

                //Update the quote count in the json file
                quote_List[0].Quote_Count = `${quote_Count}`

                //add the new quote to the json object
                quote_List.push(quote_Formatted)

                //dump out a new file
                jsonfile.writeFile(quote_Path, quote_List, { spaces: 2 }, function(err) {
                    if (err) console.error(err)
                })
                //respond with success?
                client.say(channel, `Added Quote #${quote_Count} ${quote_Text} [${category}] [${day_Formatted}]`);
            });
        }
    }
    if (command === '!quote') {

        //Grab the Current Quote total
        jsonfile.readFile(quote_Path, function(err, quote_List) {
            if (err) console.error(err)
            //console.log(quote_List)

            //search the relevant field in the json
            var quote_Count = quote_List.find(
                (search) => {
                    return search.Quote_Count;
                }
            );

            //the comparison needs a number and not a string, convert it here
            quote_Count = Number(quote_Count.Quote_Count);

            //check and see if a specific number was requested
            try {
                var quote_ID = args.slice(1).join(' ');
            }

            //I don't know how errors work so this just stops it from clogging the window
            catch (err) {
            }

            //generate a random quote if no number specified
            if (quote_ID === '') {
                var quote_ID = Math.floor(Math.random() * quote_Count + 1);
            }


            //check if the provided number is within the range
            if (quote_ID <= quote_Count) {

                //the find function needs a string and not a number, convert it here
                quote_ID = String(quote_ID)

                //search for the quote number and get all the info
                var quote_Info = quote_List.find(
                    (search) => {
                        return search.Index === quote_ID;
                    }
                );

                //format all the bullshit and spit it out in the chat
                var quote_Output = "Quote #" + quote_ID + ": " + quote_Info.Quote_Text + " [" + quote_Info.Category + "] " + "[" + quote_Info.Date + "]"
                client.say(channel, quote_Output);
                console.log(channel);
            }
            else {
                client.say(channel, `Number Provided out of range! The highest number is ${quote_Count}`);
            }
        })
    }

    //update incentive goal and bot command id
    if (command === '!updateincentive') {
        //check if user is in the allow_List (AKA, is a MOD or approved person)
        if (allow_List.includes(tags.username) || tags.mod===true) {
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
            if (Number.isInteger(new_Goal)) {
                incentiveData.update('incentive.goal', new_Goal);
                incentiveData.update('incentive.command', new_Identifier);
                console.log('Incentive Goal Updated from $' + incentiveGoal + ' to $' + new_Goal)
                client.say(channel, 'Incentive Goal Updated from $' + incentiveGoal + ' to $' + new_Goal);
            }
            updateIncentiveFile();
        }
    }

    if (command === '!addincentive') {
        //check if user is in the allow_List (AKA, is a MOD or approved person)
        if (allow_List.includes(tags.username) || tags.mod===true) {
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
            console.log(new_Goal)
            if (typeof new_Amount === 'number') {
                incentiveData.update('incentive.amount', new_Amount);
                console.log('Incentive Amount Updated from $' + incentiveData.read('incentive.amount').toFixed(2) + ' to $' + new_Amount.toFixed(2))
                client.say(channel, 'Incentive Amount Updated from $' + incentiveAmount.toFixed(2) + ' to $' + new_Amount.toFixed(2));
            }
            updateIncentiveFile();
        }
    }
    //Code to handle editing of existing quotes
    if (command === '!editquote') {
        //check if user is in the allow_List (AKA, is a MOD or approved person)
        if (allow_List.includes(tags.username) || tags.mod===true || tags.vip===true) {
            //Grab the Current Quote total
            jsonfile.readFile(quote_Path, function(err, quote_List) {
                if (err) console.error(err)

                //search the relevant field in the json
                var quote_Count = quote_List.find(
                    (search) => {
                        return search.Quote_Count;
                    }
                );

                //the comparison needs a number and not a string, convert it here
                quote_Count = Number(quote_Count.Quote_Count);

                //check and see if a specific number was requested
                try {
                    var quote_Request = args[1].toLowerCase();

                    //this takes everything after the quote number and recombines it to be the updated quote text to be written
                    var quote_Edited = args.slice(2).join(' ');
                }

                //I don't know how errors work so this just stops it from clogging the window
                catch (err) {
                }

                //check if the provided number is within the range and then write to the file
                if (Number(quote_Request) <= quote_Count) {

                    //update the quote_Text
                    quote_List[quote_Request].Quote_Text = quote_Edited

                    //dump out a new file
                    jsonfile.writeFile(quote_Path, quote_List, { spaces: 2 }, function(err) {
                        if (err) console.error(err)
                    })

                    //respond with success?
                    client.say(channel, `Updated Quote #${quote_Request} ${quote_Edited}`);
                }

                else {
                    client.say(channel, `Number Provided out of range! The highest number is ${quote_Count}`);
                }
            })
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
}); //on message top level bracket
