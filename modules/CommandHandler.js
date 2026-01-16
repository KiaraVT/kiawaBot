const jsonfile = require('jsonfile');

class CommandHandler {
    constructor(client, channelName, commandPath, allowList, api) {
        this.client = client;
        this.channelName = channelName;
        this.commandPath = commandPath;
        this.allowList = allowList;
        this.api = api;
        this.servers = ["the Hyrule", "the BOP", "the Eorzean", "the Aether",
            "Your Mom's ", "the Zebus", "the Adamantoise", "the Atlantis",
            "the South America", "the Greenland", "the Timber Hearth",
            "the Mars", "the US West", "the US East", "the Nibel",
            "the Australia", "the Europe", "the Antarctica"];
        this.Duelers = [];
    }

    handleHelloCommand(tags) {
        this.client.say(this.channelName, `@${tags.username}, heya!`);
    }

    handleServerCommand(tags) {
        const pick = this.servers[Math.floor(Math.random() * this.servers.length)];
        this.client.say(this.channelName, `I am on ${pick} Server!`);

        if (pick === 'the BOP') {
            setTimeout(() => {
                this.api.serverBoop(tags["user-id"], 69, 'Boop');
            }, 5000);
        }
    }

    handleYabaiCommand(tags) {
        const pick = Math.floor(Math.random() * 101);
        let message = `@${tags.username} is ${pick}% yabai `;
        
        if (pick < 50) {
            message += 'kiawaLuck';
        } else if (pick > 50 && pick < 100) {
            message += 'kiawaS';
        } else if (pick === 50) {
            message += 'kiawaBlank';
        } else if (pick > 99) {
            message += 'kiawaBONK';
        }
        
        this.client.say(this.channelName, message);
    }

    handleSeisoCommand(tags) {
        const pick = Math.floor(Math.random() * 101);
        let message = `@${tags.username} is ${pick}% seiso `;
        
        if (pick < 50) {
            message += 'kiawaS';
        } else if (pick > 50 && pick < 100) {
            message += 'kiawaAYAYA';
        } else if (pick === 50) {
            message += 'kiawaBlank';
        } else if (pick > 99) {
            message += 'kiawaPray';
        }
        
        this.client.say(this.channelName, message);
    }

    handleAddCommand(tags, args) {
        if (this.allowList.includes(tags.username) || tags.mod === true) {
            jsonfile.readFile(this.commandPath, async (err, command_List) => {
                if (err) {
                    console.error(err);
                    return;
                }

                const command_Count = command_List.find(search => search.Command_Count);
                const tag = args[1].toLowerCase();
                const response = args.slice(2).join(' ');

                const existingCommand = command_List.find(search => search.Tag === tag);
                
                if (existingCommand) {
                    this.client.say(this.channelName, `Command already exists!`);
                    return;
                }

                const newCommand = {
                    "Tag": tag,
                    "Response": response
                };

                command_List.push(newCommand);
                command_Count.Command_Count = Number(command_Count.Command_Count) + 1;

                jsonfile.writeFile(this.commandPath, command_List, { spaces: 2 }, (err) => {
                    if (err) console.error(err);
                });

                this.client.say(this.channelName, `Added new command: !${tag}`);
            });
        }
    }

    handleEditCommand(tags, args) {
        if (this.allowList.includes(tags.username) || tags.mod === true) {
            jsonfile.readFile(this.commandPath, async (err, command_List) => {
                if (err) {
                    console.error(err);
                    return;
                }

                const tag = args[1].toLowerCase();
                const newResponse = args.slice(2).join(' ');

                const existingCommand = command_List.find(search => search.Tag === tag);
                
                if (!existingCommand) {
                    this.client.say(this.channelName, `Command does not exist!`);
                    return;
                }

                existingCommand.Response = newResponse;

                jsonfile.writeFile(this.commandPath, command_List, { spaces: 2 }, (err) => {
                    if (err) console.error(err);
                });

                this.client.say(this.channelName, `Updated command: !${tag}`);
            });
        }
    }

    handleDuelCommand(tags, args) {
        const weapon = args.slice(1).join(' ') || 'bare hands';
        const dueler = {
            dueler: tags.username,
            duelerID: tags["user-id"],
            weapon: weapon
        };
        
        this.Duelers.push(dueler);
        this.client.say(this.channelName, `${tags.username} has entered the duel with ${weapon}! Waiting for an opponent...`);
    }

    processDuels() {
        if (this.Duelers.length > 1) {
            const dueler1 = this.Duelers[0];
            const dueler2 = this.Duelers[1];
            
            this.client.say(this.channelName, `Attention Chat! @${dueler1.dueler} is about to duel @${dueler2.dueler}!!`);
            
            setTimeout(() => {
                this.client.say(this.channelName, `will ${dueler2.dueler}'s ${dueler2.weapon} be enough to defeat ${dueler1.dueler}'s ${dueler1.weapon}? Duelists take your places!`);
            }, 1000);
            
            setTimeout(() => { this.client.say(this.channelName, `Fire in 3!`); }, 3000);
            setTimeout(() => { this.client.say(this.channelName, `2!`); }, 4000);
            setTimeout(() => { this.client.say(this.channelName, `1!`); }, 5000);
            
            setTimeout(() => {
                const coinFlip = Math.random();
                
                if (coinFlip >= 0.5) {
                    this.client.say(this.channelName, `@${dueler1.dueler} obliterated @${dueler2.dueler} with amazing use of their ${dueler1.weapon}`);
                    this.api.serverBoop(dueler2.duelerID, 60 * 5, `Killed by ${dueler1.dueler}'s ${dueler1.weapon}`);
                } else {
                    this.client.say(this.channelName, `@${dueler2.dueler} obliterated @${dueler1.dueler} with amazing use of their ${dueler2.weapon}`);
                    this.api.serverBoop(dueler1.duelerID, 60 * 5, `Killed by ${dueler2.dueler}'s ${dueler2.weapon}`);
                }
                
                this.Duelers = this.Duelers.slice(2);
            }, 6000);
        }
    }

    postCommand(command) {
        jsonfile.readFile(this.commandPath, async (err, command_List) => {
            if (err) {
                console.error(err);
                return;
            }

            const command_Info = command_List.find(search => search.Tag === command);
            
            try {
                if (command_Info) {
                    const command_Output = command_Info.Response;
                    this.client.say(this.channelName, command_Output);
                }
            } catch (error) {
                console.error(error);
            }
        });
    }
}

module.exports = CommandHandler;