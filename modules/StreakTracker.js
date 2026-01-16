const jsonfile = require('jsonfile');

class StreakTracker {
    constructor(client, channelName, streakPath) {
        this.client = client;
        this.channelName = channelName;
        this.streakPath = streakPath;
        this.userIdsWhoAlreadyStreaked = {};
    }

    say(message) {
        this.client.say(this.channelName, message);
    }

    updateStreaksSafely(userID, userName) {
        try {
            this.updateStreaks(userID, userName);
        } catch (error) {
            console.error('Error updating streaks:', error);
        }
    }

    updateStreaks(userID, userName) {
        if (this.userIdsWhoAlreadyStreaked[userID]) {
            return;
        }

        let streak_List;
        try {
            streak_List = jsonfile.readFileSync(this.streakPath);
        } catch (e) {
            console.error('Error reading streak file:', e);
            return;
        }

        if (!streak_List || !streak_List.Users) {
            console.log("Streak file not properly initialized");
            return;
        }

        const now = new Date().toISOString();
        let userInfo = streak_List.Users[userID];

        if (!userInfo) {
            userInfo = {
                Name: userName,
                Streak: 1,
                Best_Streak: 1,
                Last_Updated: now
            };
            streak_List.Users[userID] = userInfo;
            this.say(`@${userName} has just started their watch streak!! this is just the beginning you can do it this time!!`);
        } else {
            const lastStart = Date.parse(streak_List.Last_Stream.Start);
            const currentStart = Date.parse(streak_List.Current_Stream.Start);
            const lastEnd = streak_List.Last_Stream.End ? Date.parse(streak_List.Last_Stream.End) : null;

            if (!lastEnd) {
                // Get the last reset point
                let lastReset = new Date();
                lastReset = Date.parse(lastReset);
                lastReset = lastReset - (24 * 60 * 60 * 1000);
                lastReset = new Date(lastReset);
                lastReset.setHours(13, 0, 0);
                lastReset = Date.parse(lastReset);

                // Check if we are passed the last reset
                if ((lastStart < lastReset) && (currentStart >= lastReset)) {
                    const lastUpdated = Date.parse(userInfo.Last_Updated);

                    // Streak is still alive!
                    if ((lastUpdated > lastStart && lastUpdated < currentStart)) {
                        userInfo.Streak = userInfo.Streak + 1;
                        if (userInfo.Best_Streak < userInfo.Streak) {
                            userInfo.Best_Streak = userInfo.Streak;
                        }
                        userInfo.Last_Updated = now;
                        this.say(`@${userName} has watched ${userInfo.Streak} streams in a row!!`);
                    }
                    // Streak is dead
                    else if (lastUpdated < lastStart) {
                        userInfo.Last_Updated = now;
                        userInfo.Streak = 1;
                        this.say(`@${userName} has just re-started their watch streak!! this is just the beginning you can do it this time!!`);
                    } else {
                        this.say(`@${userName} is currently on a ${userInfo.Streak} stream streak!`);
                        if (userInfo.Best_Streak < userInfo.Streak) {
                            userInfo.Best_Streak = userInfo.Streak;
                        }
                    }
                } else {
                    this.say(`@${userName} is currently on a ${userInfo.Streak} stream streak!`);
                    if (userInfo.Best_Streak < userInfo.Streak) {
                        userInfo.Best_Streak = userInfo.Streak;
                    }
                }
            }
            // Check if 5 hours since last stream or for the reset time
            else {
                if ((currentStart - lastEnd) > 5 * 60 * 60 * 1000) {
                    const lastUpdated = Date.parse(userInfo.Last_Updated);
                    // Streak is still alive!
                    if ((lastUpdated > lastStart && lastUpdated < currentStart)) {
                        userInfo.Streak = userInfo.Streak + 1;
                        userInfo.Last_Updated = now;
                        this.say(`@${userName} has watched ${userInfo.Streak} streams in a row!!`);
                        if (userInfo.Best_Streak < userInfo.Streak) {
                            userInfo.Best_Streak = userInfo.Streak;
                        }
                    }
                    // Streak is dead
                    else if (lastUpdated < lastStart) {
                        userInfo.Last_Updated = now;
                        userInfo.Streak = 1;
                        this.say(`@${userName} has just re-started their watch streak!! this is just the beginning you can do it this time!!`);
                    } else {
                        this.say(`@${userName} is currently on a ${userInfo.Streak} stream streak!`);
                        if (userInfo.Best_Streak < userInfo.Streak) {
                            userInfo.Best_Streak = userInfo.Streak;
                        }
                    }
                } else {
                    this.say(`@${userName} is currently on a ${userInfo.Streak} stream streak!`);
                    if (userInfo.Best_Streak < userInfo.Streak) {
                        userInfo.Best_Streak = userInfo.Streak;
                    }
                }
            }
        }

        // Write the file
        jsonfile.writeFileSync(this.streakPath, streak_List, { spaces: 2, EOL: "\n" });
        this.userIdsWhoAlreadyStreaked[userID] = true;
    }

    initializeStreakFile(startTime) {
        const initializeStreaks = {
            Last_Stream: { Start: startTime, End: '' },
            Current_Stream: { Start: startTime },
            Users: {}
        };
        jsonfile.writeFileSync(this.streakPath, initializeStreaks, { spaces: 2, EOL: "\n" });
    }

    updateCurrentStreamStart(startTime) {
        try {
            const streak_List = jsonfile.readFileSync(this.streakPath);
            if (streak_List) {
                streak_List.Current_Stream = { Start: startTime };
                jsonfile.writeFileSync(this.streakPath, streak_List, { spaces: 2, EOL: "\n" });
            }
        } catch (error) {
            console.error('Error updating current stream start:', error);
        }
    }

    updateStreamEnd(endTime) {
        try {
            const streak_List = jsonfile.readFileSync(this.streakPath);
            if (streak_List && streak_List.Current_Stream) {
                streak_List.Last_Stream = {
                    Start: streak_List.Current_Stream.Start,
                    End: endTime
                };
                delete streak_List.Current_Stream;
                jsonfile.writeFileSync(this.streakPath, streak_List, { spaces: 2, EOL: "\n" });
                
                // Reset the tracking array for the next stream
                this.userIdsWhoAlreadyStreaked = {};
            }
        } catch (error) {
            console.error('Error updating stream end:', error);
        }
    }
}

module.exports = StreakTracker;