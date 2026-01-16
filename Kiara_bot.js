require('dotenv').config();
const tmi = require('tmi.js');
const fs = require('fs');
const jsonfile = require('jsonfile');

// Import our modular components
const TwitchAuth = require('./modules/TwitchAuth');
const TwitchAPI = require('./modules/TwitchAPI');
const EventSubManager = require('./modules/EventSubManager');
const CommandHandler = require('./modules/CommandHandler');
const QuoteManager = require('./modules/QuoteManager');
const StreakTracker = require('./modules/StreakTracker');
const BotUtils = require('./modules/BotUtils');

// Import existing helpers
const AuthDataHelper = require('./AuthDataHelper');
const IncentiveHelper = require('./IncentiveHelper');

// Initialize paths and constants
const quote_Path = './data/quotes.json';
const streak_Path = './data/streaks.json';
const command_Path = './data/command_List.json';
const dataDir = './data';

const config = BotUtils.getBotConfig();
const scopes = BotUtils.getTwitchScopes();
const allowList = BotUtils.getAllowList();
const subTierValues = BotUtils.getSubTierValues();

// Environment variables
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const botID = process.env.BOT_ID;
const broadcasterID = process.env.BROADCASTER_ID;

// Initialize data files
const defaultFiles = [
    { path: quote_Path, content: [] },
    { path: streak_Path, content: {} },
    { path: command_Path, content: [] }
];

BotUtils.ensureDataDirectory(dataDir, defaultFiles);

class KiaraBot {
    constructor() {
        this.incentiveAmount = 0;
        this.incentiveGoal = 0;
        
        // Initialize components
        this.setupAuth();
        this.setupIncentives();
    }

    setupAuth() {
        this.twitchAuth = new TwitchAuth(clientId, clientSecret, botID, scopes);
        this.api = new TwitchAPI(clientId, this.twitchAuth);
        
        // Set up auth callback
        this.twitchAuth.setAuthReadyCallback(() => {
            this.handleInitialAuthValidation();
        });

        this.authData = new AuthDataHelper();
        this.authData.statusCallback = this.handleAuthFileStatusChange.bind(this);
        this.authData.loadData();
        
        if (this.twitchAuth.getAccessToken()) {
            this.twitchAuth.validateAccessToken();
        }
    }

    setupIncentives() {
        this.incentiveData = new IncentiveHelper();
        this.incentiveData.statusCallback = this.handleIncentiveFileStatusChange.bind(this);
        this.incentiveData.loadData();
        
        if (!fs.existsSync('./data/incentives.txt')) {
            BotUtils.updateIncentiveFile(this.incentiveData, fs);
        }
    }

    setupBot() {
        // Initialize TMI client
        this.client = new tmi.Client({
            options: { debug: true },
            identity: {
                username: 'Kiawa_Bot',
                password: process.env.OAUTH
            },
            channels: ['Kiara_TV']
        });

        // Initialize bot components
        this.commandHandler = new CommandHandler(this.client, config.channelName, command_Path, allowList, this.api);
        this.quoteManager = new QuoteManager(this.client, config.channelName, quote_Path, allowList);
        this.streakTracker = new StreakTracker(this.client, config.channelName, streak_Path);
        this.botUtils = new BotUtils();

        // Initialize EventSub
        this.eventSubManager = new EventSubManager(clientId, clientSecret, this.twitchAuth);
        this.setupEventSubSubscriptions();

        // Set up badge management
        this.setupBadges();

        // Set up message handler
        this.setupMessageHandler();

        // Set up timed commands
        this.timedCommandsManager = BotUtils.createTimedCommandsManager(
            config.timedCommands, 
            (command) => this.commandHandler.postCommand(command),
            this.client,
            config.channelName
        );

        // Set up duel processing
        setInterval(() => {
            this.commandHandler.processDuels();
        }, 15000);

        // Connect to chat
        this.client.connect();
    }

    async setupBadges() {
        try {
            const badges = await this.api.getBadges(broadcasterID);
            this.botUtils.setBadgeMap(badges);
        } catch (error) {
            console.error('Failed to load badges:', error);
        }
    }

    setupMessageHandler() {
        this.client.on('message', async (channel, tags, message, self) => {
            if (self) return;

            // Track activity for timed commands
            if (tags.username != "kiawa_bot") {
                this.timedCommandsManager.setActivity();
                this.streakTracker.updateStreaksSafely(tags["user-id"], tags.username);
            }

            // Resolve badges for websocket
            const messageBadges = await this.botUtils.resolveBadges(tags);
            this.eventSubManager.sendToAllChatWidgets({ 
                kiawaAction: "Message", 
                channel, 
                tags, 
                message, 
                messageBadges 
            });

            // Handle commands
            this.handleMessage(channel, tags, message);
        });
    }

    handleMessage(channel, tags, message) {
        const lowerMessage = message.toLowerCase();

        // Simple commands
        if (lowerMessage === '!hello') {
            this.commandHandler.handleHelloCommand(tags);
            return;
        }

        if (lowerMessage === '!server') {
            this.commandHandler.handleServerCommand(tags);
            return;
        }

        if (lowerMessage === '!yabai') {
            this.commandHandler.handleYabaiCommand(tags);
            return;
        }

        if (lowerMessage === '!seiso') {
            this.commandHandler.handleSeisoCommand(tags);
            return;
        }

        // Parse command and arguments
        const args = message.split(/\s+/);
        const command = args[0].toLowerCase();

        // Complex commands
        if (command === '!addcommand') {
            this.commandHandler.handleAddCommand(tags, args);
        } else if (command === '!editcommand') {
            this.commandHandler.handleEditCommand(tags, args);
        } else if (command === '!addquote') {
            this.quoteManager.handleAddQuote(tags, args);
        } else if (command === '!quote') {
            this.quoteManager.handleQuote(tags, args);
        } else if (command === '!editquote') {
            this.quoteManager.handleEditQuote(tags, args);
        } else if (command === '!duel') {
            this.commandHandler.handleDuelCommand(tags, args);
        } else if (command === '!updateincentive') {
            this.handleUpdateIncentive(tags, args);
        } else if (command === '!addincentive') {
            this.handleAddIncentive(tags, args);
        } else if (command.charAt(0) === '!') {
            // Try to find a custom command
            const commandName = command.slice(1);
            this.commandHandler.postCommand(commandName);
        }
    }

    handleUpdateIncentive(tags, args) {
        if (allowList.includes(tags.username) || tags.mod === true) {
            try {
                const newGoal = args.slice(1).join(' ');
                const goalAmount = Number(newGoal);
                
                if (typeof goalAmount === 'number' && !isNaN(goalAmount)) {
                    this.incentiveData.update('incentive.goal', goalAmount);
                    this.client.say(config.channelName, `Incentive Goal Updated from $${this.incentiveGoal.toFixed(2)} to $${goalAmount.toFixed(2)}`);
                    this.incentiveGoal = goalAmount;
                    BotUtils.updateIncentiveFile(this.incentiveData, fs);
                }
            } catch (err) {
                console.error('Error updating incentive goal:', err);
            }
        }
    }

    handleAddIncentive(tags, args) {
        if (allowList.includes(tags.username) || tags.mod === true) {
            try {
                const addAmount = args.slice(1).join(' ');
                const newAmount = Number(this.incentiveAmount) + Number(addAmount);
                
                if (typeof newAmount === 'number' && !isNaN(newAmount)) {
                    this.incentiveData.update('incentive.amount', newAmount);
                    this.client.say(config.channelName, `Incentive Amount Updated from $${this.incentiveAmount.toFixed(2)} to $${newAmount.toFixed(2)}`);
                    this.incentiveAmount = newAmount;
                    BotUtils.updateIncentiveFile(this.incentiveData, fs);
                }
            } catch (err) {
                console.error('Error adding incentive amount:', err);
            }
        }
    }

    setupEventSubSubscriptions() {
        const subCondition = { broadcaster_user_id: broadcasterID };
        const subConditionMod = { broadcaster_user_id: broadcasterID, moderator_user_id: broadcasterID };

        // Stream online/offline events
        this.eventSubManager.queueSubscription('stream.online', subCondition, event => {
            console.log("Stream online detected");
            let streak_List;
            try {
                streak_List = jsonfile.readFileSync(streak_Path);
            } catch (e) {}

            if (!streak_List) {
                console.log("No File, Creating New File");
                this.streakTracker.initializeStreakFile(event.started_at);
            } else {
                console.log("Updating Current Stream Date");
                this.streakTracker.updateCurrentStreamStart(event.started_at);
            }
        });

        this.eventSubManager.queueSubscription('stream.offline', subCondition, event => {
            console.log("Stream offline detected");
            this.streakTracker.updateStreamEnd(new Date().toISOString());
        });

        // Subscription events
        this.eventSubManager.queueSubscription("channel.subscribe", subCondition, event => {
            console.log(event);
            this.incentiveAmount = this.incentiveData.read('incentive.amount');
            this.streakTracker.updateStreaksSafely(event?.user_id, event?.user_name);
        });

        this.eventSubManager.queueSubscription("channel.subscription.gift", subCondition, event => {
            console.log(event);
            this.incentiveAmount = this.incentiveData.read('incentive.amount');
            
            if (event.tier === '1000') {
                this.incentiveAmount += subTierValues.t1Value * event.total;
            } else if (event.tier === '2000') {
                this.incentiveAmount += subTierValues.t2Value * event.total;
            } else if (event.tier === '3000') {
                this.incentiveAmount += subTierValues.t3Value * event.total;
            }
            
            this.incentiveData.update('incentive.amount', this.incentiveAmount);
            BotUtils.updateIncentiveFile(this.incentiveData, fs);
            
            if (!event?.is_anonymous) {
                this.streakTracker.updateStreaksSafely(event?.user_id, event?.user_name);
            }
        });

        this.eventSubManager.queueSubscription("channel.subscription.message", subCondition, event => {
            console.log(event);
            this.incentiveAmount = this.incentiveData.read('incentive.amount');
            
            if (event.tier === '1000') {
                this.incentiveAmount += subTierValues.t1Value;
            } else if (event.tier === '2000') {
                this.incentiveAmount += subTierValues.t2Value;
            } else if (event.tier === '3000') {
                this.incentiveAmount += subTierValues.t3Value;
            } else if (event.tier === '4000') {
                this.incentiveAmount += subTierValues.primeValue;
            }
            
            this.incentiveData.update('incentive.amount', this.incentiveAmount);
            BotUtils.updateIncentiveFile(this.incentiveData, fs);
            this.streakTracker.updateStreaksSafely(event?.user_id, event?.user_name);
        });

        // Moderation events
        this.eventSubManager.queueSubscription("channel.chat.message_delete", subConditionMod, messageDelete => {
            this.eventSubManager.sendToAllChatWidgets({ kiawaAction: "Message_Delete", messageDelete });
        });

        this.eventSubManager.queueSubscription("channel.moderate", subConditionMod, modAction => {
            this.eventSubManager.sendToAllChatWidgets({ kiawaAction: "Mod_Action", modAction });
        });
    }

    handleAuthFileStatusChange(status) {
        console.log('Auth File status changed: ' + status);
        if (status === 'loaded') {
            // Auth data loaded, proceed with initialization
            this.setupBot();
        }
    }

    handleIncentiveFileStatusChange(status) {
        console.log('Incentive File status changed: ' + status);
        if (status === 'loaded') {
            this.initializeIncentive();
        }
    }

    initializeIncentive() {
        this.incentiveAmount = this.incentiveData.read('incentive.amount');
        this.incentiveGoal = this.incentiveData.read('incentive.goal');
    }

    async handleInitialAuthValidation() {
        try {
            const channel_data = await this.api.getChannelInfo(broadcasterID);
            console.log('Got channel data!', channel_data);
        } catch (error) {
            console.log(error);
        }
    }
}

// Start the bot
console.log('Starting Kiawa Bot with modular architecture...');
const bot = new KiaraBot();