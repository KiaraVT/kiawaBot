const TES = require("tesjs");
const WebSocket = require('ws');
const AuthDataHelper = require('../AuthDataHelper');

class EventSubManager {
    constructor(clientId, clientSecret, authManager) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.authManager = authManager;
        this.authData = AuthDataHelper;
        
        this.#pendingSubscriptions = [];
        this.#recentlySeenEventIdentifiers = {};
        this.#subscriptionByType = {};
        this.websockets = [];

        this.#tes = this.#buildTesInstance();
        
        if (this.#tes.on) {
            this.#initializeSubscriptionQueue();
        } else {
            console.log("TesManager can only auth at startup. Please restart the bot once Twitch auth is complete.");
        }

        this.setupWebSocketServer();
    }

    #buildTesInstance() {
        try {
            const tes = new TES({
                identity: {
                    id: this.clientId,
                    secret: this.clientSecret,
                    accessToken: this.authData.read('twitch.access_token'),
                    refreshToken: this.authData.read('twitch.refresh_token')
                },
                listener: { type: "websocket", port: 8082 },
            });
            
            const onRevocation = subscription => {
                console.error(`Subscription ${subscription.id} ${subscription.type} has been revoked.`);
            };
            tes.on("revocation", onRevocation);

            const onConnectionLost = subscriptionTypeAndConditionById => {
                const types = Object.values(subscriptionTypeAndConditionById).map(({type}) => type).sort().join(", ");
                console.log(`Connection lost for subscription types ${types}; let's repair them.`);
                this.#repairSubscriptions();
            };
            tes.on("connection_lost", onConnectionLost);

            return tes;
        } catch (error) {
            const warning = () => console.log("TES failed to initialize. Could just be an authentication error - try restarting the bot after you reauth.", error);
            warning();
            this.authManager.startAuth();
            return {queueSubscription: warning};
        }
    }

    #initializeSubscriptionQueue() {
        let queueHeat = 0;
        
        const handleQueue = (async () => {
            const input = this.#pendingSubscriptions.shift();
            if (input) {
                queueHeat = queueHeat + 1;
                
                const { type, condition, callback } = input;
                
                if (typeof callback === "function") {
                    const wrappedCallback = this.#preventDuplicateEvents(callback);
                    this.#tes.on(type, wrappedCallback);
                }
                
                try {
                    const existingSubscription = this.#subscriptionByType[type];
                    if (existingSubscription) {
                        console.log(`Oh no! We already have a subscription for ${type}. Heck whatever this is. Repairing subscriptions just in case...`);
                        this.#repairSubscriptions();
                    } else {
                        const subscription = await this.#tes.subscribe(type, condition);
                        console.log(`Subscription to event type ${type} successful`, subscription);
                        this.#subscriptionByType[subscription.type] = subscription;
                    }
                } catch (error) {
                    console.log(`Error subscribing to event type ${type}. Will try again shortly.`, error);
                    this.#pendingSubscriptions.push(input);
                }
            } else {
                if (queueHeat > 0) {
                    queueHeat = queueHeat - 1;
                }
            }
            setTimeout(handleQueue, 100 * Math.pow(1 + (queueHeat / 2), 2));
        });
        
        handleQueue();
    }
    
    #preventDuplicateEvents(callback) {
        return (event, subscription) => {
            const uniqueEventIdentifier = this.#getUniqueEventIdentifier(event, subscription);
            if (uniqueEventIdentifier) {
                const timeout = this.#recentlySeenEventIdentifiers[uniqueEventIdentifier];
                if (!timeout) {
                    this.#recentlySeenEventIdentifiers[uniqueEventIdentifier] = setTimeout(() => delete this.#recentlySeenEventIdentifiers[uniqueEventIdentifier], 5000);
                    callback(event, subscription);
                } else {
                    console.log(`Deduping event ${subscription.type}`, uniqueEventIdentifier);
                    timeout.refresh();
                    console.log(`Duplicate message detected; let's repair the subscriptions.`);
                    this.#repairSubscriptions();
                }
            } else {
                callback(event, subscription);
            }
        };
    }

    #getUniqueEventIdentifier(event, subscription) {
        const type = subscription.type;
        
        const typesThatShouldNotBeDeduped = [];
        if (typesThatShouldNotBeDeduped.includes(type)) {
            return null;
        }
        
        if (event.message_id) {
            return event.message_id;
        }
        
        const simpleFieldLookupsByType = {
            "channel.channel_points_custom_reward_redemption.add": "id",
        };
        const possiblyUniqueFieldName = simpleFieldLookupsByType[type];
        if (possiblyUniqueFieldName) {
            return event[possiblyUniqueFieldName];
        }
        
        return JSON.stringify(event);
    }
    
    async #repairSubscriptions() {
        try {
            console.log(`Repairing EventSub subscriptions...`);
            const cachedSubs = Object.values(this.#subscriptionByType);
            const twitchSubs = (await this.#tes.getSubscriptions())?.data ?? [];
            const subTypes = new Set([...cachedSubs, ...twitchSubs].map(sub => sub.type));
            console.log(`Repairing EventSub subscriptions with types ${[...subTypes].join(", ")}`);
            
            for (const type of subTypes) {
                try {
                    const allSubs = twitchSubs.filter(sub => sub.type == type);
                    const existingSub = allSubs.find(sub => sub.id === this.#subscriptionByType[type]?.id);
                    const potentialReplacementSub = allSubs.find(sub => sub.status == "enabled" && sub.id != existingSub?.id);
                    const fallbackCondition = existingSub?.condition ?? potentialReplacementSub?.condition ?? allSubs.find(s => s.condition)?.condition;

                    for (const otherSub of allSubs) {
                        try {
                            if (otherSub !== existingSub && otherSub !== potentialReplacementSub) {
                                console.log(`Repairing EventSub subscriptions: removing duplicate, ${type} ${otherSub.status} ${otherSub.created_at} ${otherSub.id}`);
                                await this.#tes.unsubscribe(otherSub.id);
                            }
                        } catch (e) {
                            console.log(`Repairing EventSub subscriptions: failed to remove duplicate, ${type} ${otherSub.status} ${otherSub.created_at} ${otherSub.id}`, e);
                        }
                    }

                    if (existingSub?.status == "enabled") {
                        if (potentialReplacementSub) {
                            try {
                                console.log(`Repairing EventSub subscriptions: removing duplicate, ${type} ${potentialReplacementSub.status} ${potentialReplacementSub.created_at} ${potentialReplacementSub.id}`);
                                await this.#tes.unsubscribe(potentialReplacementSub.id);
                            } catch (e) {
                                console.log(`Repairing EventSub subscriptions: failed to remove duplicate, ${type} ${potentialReplacementSub.status} ${potentialReplacementSub.created_at} ${potentialReplacementSub.id}`, e);
                            }
                        }
                        continue;
                    }

                    if (existingSub) {
                        try {
                            console.log(`Repairing EventSub subscriptions: removing stale, ${type} ${existingSub.status} ${existingSub.created_at} ${existingSub.id}`);
                            delete this.#subscriptionByType[type];
                            await this.#tes.unsubscribe(existingSub.id);
                        } catch (e) {
                            console.log(`Repairing EventSub subscriptions: failed to remove stale, ${type} ${existingSub.status} ${existingSub.created_at} ${existingSub.id}`, e);
                        }
                    }

                    if (potentialReplacementSub) {
                        console.log(`Repairing EventSub subscriptions: replacing, ${type} ${potentialReplacementSub.status} ${potentialReplacementSub.created_at} ${potentialReplacementSub.id}`);
                        this.#subscriptionByType[type] = potentialReplacementSub;
                    }

                    if (!this.#subscriptionByType[type]) {
                        try {
                            console.log(`Repairing EventSub subscriptions: recreating ${type} with ${JSON.stringify(fallbackCondition)}`);
                            const hailMary = await this.#tes.subscribe(type, fallbackCondition);
                            this.#subscriptionByType[type] = hailMary;
                        } catch (e) {
                            console.log(`Repairing EventSub subscriptions: failed to recreate ${type} with ${JSON.stringify(fallbackCondition)}`);
                        }
                    }
                } catch (e) {
                    console.log(`Repairing EventSub subscriptions: completely failed to repair ${type}`, e);
                }
            }
        } catch (e) {
            console.log(`Repairing EventSub subscriptions: completely failed`, e);
        }
    }

    queueSubscription(type, condition, callback) {
        this.#pendingSubscriptions.push({ type, condition, callback });
    }

    setupWebSocketServer() {
        const socket = new WebSocket.Server({ port: 8080 });
        socket.on('connection', ws => {
            this.websockets.push(ws);
            console.log('Client connected');
            ws.on('close', () => {
                console.log('Client disconnected');
                this.websockets = this.websockets.filter(client => client !== ws);
            });
        });
        console.log('WebSocket server started on port 8080');
    }

    sendToAllChatWidgets(data) {
        let serialized = data;
        try {
            serialized = JSON.stringify(data);
        } catch (error) {
            console.error("Failed to serialize chat widget data!", error);
            return;
        }
        
        for (const connection of this.websockets) {
            try {
                if (connection?.readyState === WebSocket.OPEN) {
                    connection.send(serialized);
                }
            } catch (error) {
                console.error("Sending to chat widget failed!", serialized, error);
            }
        }
    }
}

module.exports = EventSubManager;