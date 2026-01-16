const axios = require('axios');
const querystring = require('qs');

class TwitchAPI {
    constructor(clientId, authManager) {
        this.clientId = clientId;
        this.authManager = authManager;
    }

    apiGetRequest(method, parameters) {
        return new Promise((resolve, reject) => {
            if (!this.authManager.isReady()) {
                reject(new Error("twitch not yet authorized, wait a bit and try again"));
                return;
            }

            const requestQueryString = querystring.stringify(parameters);
            const axiosConfig = {
                headers: {
                    "Authorization": "Bearer " + this.authManager.getAccessToken(),
                    "Client-Id": this.clientId
                }
            }
            axios.get("https://api.twitch.tv/helix/" + method + "?" + requestQueryString, axiosConfig)
                .then(response => resolve(response.data))
                .catch(error => {
                    if (error.response.status === 401) {
                        console.log('Unable to validate Access Token, requesting a refreshed token');
                        this.authManager.refreshAccessToken();
                    }
                    reject(error);
                });
        });
    }

    apiPostRequest(method, parameters, data) {
        return new Promise((resolve, reject) => {
            if (!this.authManager.isReady()) {
                reject(new Error("twitch not yet authorized, wait a bit and try again"));
                return;
            }

            const requestQueryString = querystring.stringify(parameters);
            const axiosConfig = {
                headers: {
                    "Authorization": "Bearer " + this.authManager.getAccessToken(),
                    "Client-Id": this.clientId,
                    "Content-Type": 'application/json'
                }
            }
            
            axios.post("https://api.twitch.tv/helix/" + method + "?" + requestQueryString, data, axiosConfig)
                .then(response => resolve(response.data))
                .catch(error => {
                    if (error.response.status === 401) {
                        console.log('Unable to validate Access Token, requesting a refreshed token');
                        this.authManager.refreshAccessToken();
                    }
                    if (error.response.status === 400) {
                        console.log(error.response.data.message);
                    }
                    reject(error);
                });
        });
    }

    getChannelInfo(broadcaster_id) {
        return new Promise((resolve, reject) => {
            this.apiGetRequest('channels', { broadcaster_id: broadcaster_id })
                .then(data => resolve(data.data))
                .catch(error => reject(error))
        });
    }

    async serverBoop(userId, duration, reason) {
        try {
            await this.apiPostRequest('moderation/bans', 
                'broadcaster_id=37055465&moderator_id=37055465', 
                `{"data": {"user_id":"${userId}","duration":"${duration}","reason":"${reason}"}}`
            );
        } catch (error) {
            console.error('Failed to server boop:', error);
        }
    }

    async getBadges(broadcasterId) {
        try {
            const globalBadges = await this.apiGetRequest('chat/badges/global');
            const channelBadges = await this.apiGetRequest('chat/badges', { broadcaster_id: broadcasterId });
            
            const badgeMap = {};
            
            // Process global badges
            if (globalBadges.data) {
                globalBadges.data.forEach(badgeSet => {
                    badgeMap[badgeSet.set_id] = {};
                    badgeSet.versions.forEach(version => {
                        badgeMap[badgeSet.set_id][version.id] = version;
                    });
                });
            }
            
            // Process channel badges (these override global ones)
            if (channelBadges.data) {
                channelBadges.data.forEach(badgeSet => {
                    if (!badgeMap[badgeSet.set_id]) {
                        badgeMap[badgeSet.set_id] = {};
                    }
                    badgeSet.versions.forEach(version => {
                        badgeMap[badgeSet.set_id][version.id] = version;
                    });
                });
            }
            
            return badgeMap;
        } catch (error) {
            console.error('Failed to get badges:', error);
            return {};
        }
    }
}

module.exports = TwitchAPI;