const axios = require('axios');
const querystring = require('qs');
const spawn = require('child_process').spawn;
const express = require("express");
const AuthDataHelper = require('../AuthDataHelper');

class TwitchAuth {
    constructor(clientId, clientSecret, botId, scopes) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.botId = botId;
        this.scopes = scopes;
        this.oAuthPort = 3000;
        this.redirectUri = 'http://localhost:' + this.oAuthPort;
        this.authData = AuthDataHelper;
        this.validationTicker = null;
        this.twitchAuthReady = false;

        this.setupAuthListener();
    }

    setupAuthListener() {
        const authListener = express();
        authListener.listen(this.oAuthPort);
        authListener.get("/", (req, res) => {
            this.exchangeCodeForAccessToken(req.query.code)
                .then(tokenData => {
                    res.send("You're now Authorized! You can close this tab and return to the bot");
                    this.authData.update('twitch.access_token', tokenData.access_token);
                    this.authData.update('twitch.refresh_token', tokenData.refresh_token);
                    this.validateAccessToken();
                    this.validationTicker = setInterval(() => { this.validateAccessToken(); }, 1000 * 600);
                })
                .catch(error => {
                    this.twitchAuthReady = false;
                    console.log(error);
                })
        });
    }

    async startAuth() {
        const authQueryString = querystring.stringify({
            response_type: 'code',
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            scope: this.scopes.join(' ')
        });
        const authUrl = "https://id.twitch.tv/oauth2/authorize?" + authQueryString.replace(/&/g, "^&");
        await spawn('cmd', ["/c", "start", authUrl]);
        console.log('made it to end of startauth')
    }

    exchangeCodeForAccessToken(code) {
        return new Promise((resolve, reject) => {
            const postData = {
                grant_type: 'authorization_code',
                client_id: this.clientId,
                client_secret: this.clientSecret,
                redirect_uri: this.redirectUri,
                code: code
            };
            axios.post("https://id.twitch.tv/oauth2/token", postData)
                .then(response => resolve(response.data))
                .catch(error => reject(error));
        });
    }

    refreshAccessToken() {
        const postData = {
            grant_type: 'refresh_token',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: this.authData.read('twitch.refresh_token'),
        };

        console.log('Attempting to refresh Access Token...');

        axios.post("https://id.twitch.tv/oauth2/token", postData)
            .then(response => {
                console.log('Access Token was successfully refreshed');
                this.authData.update('twitch.access_token', response.data.access_token);
                this.authData.update('twitch.refresh_token', response.data.refresh_token);
                this.validateAccessToken();
            })
            .catch(error => {
                if (error.response.status === 401 || error.response.status === 400) {
                    console.log('Unable to refresh Access Token, requesting new auth consent from user');
                    this.authData.update('twitch.access_token', '');
                    this.authData.update('twitch.refresh_token', '');
                    this.twitchAuthReady = false;
                    clearInterval(this.validationTicker);
                    this.startAuth();
                } else {
                    console.log(error);
                }
            });
    }

    validateAccessToken() {
        console.log('Attempting to validate Access Token...');

        axios.get("https://id.twitch.tv/oauth2/validate", {
            headers: { Authorization: 'Bearer ' + this.authData.read('twitch.access_token') }
        })
            .then(response => {
                console.log('Access Token was successfully validated');
                if (this.twitchAuthReady === false) {
                    this.twitchAuthReady = true;
                    if (this.onAuthReady) {
                        this.onAuthReady();
                    }
                }
            })
            .catch(error => {
                if (error?.response?.status === 401) {
                    console.log('Unable to validate Access Token, requesting a fully refreshed token');
                }
                else {
                    console.log('Unable to validate Access Token for an unexpected reason; requesting a fully refreshed token', error);
                }
                this.twitchAuthReady = false;
                this.refreshAccessToken();
            });
    }

    isReady() {
        return this.twitchAuthReady;
    }

    getAccessToken() {
        return this.authData.read('twitch.access_token');
    }

    setAuthReadyCallback(callback) {
        this.onAuthReady = callback;
    }
}

module.exports = TwitchAuth;