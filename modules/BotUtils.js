const fs = require('fs');
const jsonfile = require('jsonfile');

class BotUtils {
    constructor() {
        this.badgeMap = {};
    }

    // Ensure data directory exists and initialize default files
    static ensureDataDirectory(dataDir, defaultFiles) {
        if (!fs.existsSync(dataDir)) {
            console.log('Creating data directory...');
            fs.mkdirSync(dataDir, { recursive: true });
        }

        defaultFiles.forEach(({ path, content }) => {
            if (!fs.existsSync(path)) {
                console.log(`Creating default ${path}...`);
                try {
                    jsonfile.writeFileSync(path, content, { spaces: 2, EOL: "\n" });
                } catch (error) {
                    console.error(`Failed to create ${path}:`, error);
                }
            }
        });
    }

    // Badge management functions
    setBadgeMap(badgeMap) {
        this.badgeMap = badgeMap;
    }

    async getBadgeVersion(setId, versionId) {
        try {
            return this.badgeMap[setId]?.[versionId] || null;
        } catch (error) {
            console.error('Error getting badge version:', error);
            return null;
        }
    }

    async resolveBadges(tags) {
        const messageBadges = [];
        if (tags.badges) {
            for (const [setId, versionId] of Object.entries(tags.badges)) {
                const version = await this.getBadgeVersion(setId, versionId);
                if (version) {
                    messageBadges.push(version);
                }
            }
        }
        return messageBadges;
    }

    // Incentive file management
    static updateIncentiveFile(incentiveData, fs) {
        const content = incentiveData.read('incentive.command') + ' $' + 
                      Number(incentiveData.read('incentive.amount')).toFixed(2) + 
                      ' / $' + incentiveData.read('incentive.goal');
        
        fs.writeFile('//KIARASTREAM/d/incentive.txt', content, err => {
            if (err) {
                console.error(err);
            } else {
                console.log('Incentive file updated successfully');
            }
        });
    }

    // Timed commands functionality
    static createTimedCommandsManager(timedCommands, postCommand, client, channelName) {
        let activityDetection = false;
        let commandIndex = 0;

        const setActivity = () => {
            activityDetection = true;
        };

        const processTimedCommands = () => {
            if (activityDetection === true) {
                const command = timedCommands[commandIndex];
                postCommand(command);
                commandIndex = (commandIndex + 1) % timedCommands.length;
                activityDetection = false;
            }
        };

        // Run every 20 minutes (1200000ms)
        const interval = setInterval(processTimedCommands, 1200000);

        return {
            setActivity,
            stop: () => clearInterval(interval)
        };
    }

    // Constants and configuration
    static getSubTierValues() {
        return {
            t1Value: 3.60,
            t2Value: 6.00,
            t3Value: 17.50,
            primeValue: 2.50
        };
    }

    static getBotConfig() {
        return {
            broadcasterID: 37055465,
            channelName: '#kiara_tv',
            timedCommands: ['discord', 'kofi', 'socials2', 'socials1', 'links', 'patreon', 'youtube', 'archives']
        };
    }

    static getTwitchScopes() {
        return [
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
    }

    static getAllowList() {
        return [
            "baeginning", "caeshura", "chocolatedave", "clockworkophelia",
            "drawize", "feff", "flockhead", "ghoststrike49",
            "ghoul02", "grimelios", "itsjustatank",
            "jayo_exe", "kirbymastah", "mayeginz", "neoashetaka",
            "notsonewby", "ogndrahcir", "orgran", "pancakeninjagames", "porkduckrice", "roosesr",
            "shadomagi", "sheepyamaya", "sigmasin", "kiara_tv", "smashysr", "sonicshadowsilver2",
            "spikevegeta", "stingerpa", "terra21", "thedragonfeeney", "trojandude12", "tsubasaakari",
            "vellhart", "vulajin", "woodenbarrel", "yagamoth", "billyboyrutherford", "violaxcore",
            "keizaron", "myriachan", "smulchypansie", "opheliaway", "sakoneko", "abelltronics17",
            "foung_shui", "eddie", "v0oid", "J_o_n_i_d_T_h_e_1_s_t_", "froggythighs", "lenaflieder", 
            "zoiteki", "shoujo", "justanyia", "shinobufujiko", "minikitty", "pofflecakey", "bobbeigh", "dangers"
        ];
    }
}

module.exports = BotUtils;