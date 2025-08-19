import { getFileCache } from "./FileCacheService.js";
const db = getFileCache("duels.json");

let client; // from Kiara_bot.js
let apiPostRequest; // from Kiara_bot.js
let channel; // from Kiara_bot.js

/*
Fallback Weapons: one of these will be used at random if the duelist does not type anything along with their duel command.
*/
const fallbackWeapons = ["fists", "large trout", "wooden oar", "bokken"];

/*
Cursed Weapons: if the duelist's weapon contains any of these strings, they are disqualified from dueling and given a timeout immediately.
*/
const cursedWeapons = ["trump"];

/*
Rallying Cries: Different ways the bot can announce the contestants.
*/
const rallyingCries = [
  (competitor, opponent) => `Attention Chat! @${competitor.display_name} is about to duel @${opponent.display_name}!!`,
  (competitor, opponent) => `Chat of ${channel}, raise your eyes to the skies and observe! @${competitor.display_name} has thrown down the gauntlet, and @${opponent.display_name} has answered!`,
];

/*
Brandishing Cries: Different ways the bot can announce the weapons.
*/
const brandishingCries = [
  (competitor, opponent) => `Will @${opponent.display_name}'s ${opponent.weapon} be enough to defeat @${competitor.display_name}'s ${competitor.weapon}?`,
  (competitor, opponent) => `Has @${opponent.display_name}'s ${opponent.weapon} got what it takes to overthrow @${competitor.display_name}'s ${competitor.weapon}?`,
];

/*
Countdown Starts: Different ways the bot can begin the countdown.
*/
const countdownStarts = [
  (competitor, opponent, seconds) => `Duelists - take your places! Fire in ${seconds}!`,
  (competitor, opponent, seconds) => `The spectacle now unfolds, starting in ${seconds}!`,
  (competitor, opponent, seconds) => `@${competitor.display_name}! @${opponent.display_name}! On my mark in... ${seconds}!`,
]

/*
Victory Cries: Different ways the bot can proclaim the winner and loser.
*/
const victoryCries = [
  (winner, loser) => `@${winner.display_name} obliterated @${loser.display_name} with amazing use of their ${winner.weapon}.`,
  (winner, loser) => `@${loser.display_name} fell to the prowess of @${winner.display_name} with their ${winner.weapon}!`,
  (winner, loser) => `@${winner.display_name}'s skill with their ${winner.weapon} is clear as @${loser.display_name} falls!`,
]

function sample(array) {
  if (Array.isArray(array) && array.length > 0) {
    const randomIndex = Math.floor(Math.random() * array.length);
    return array[randomIndex];
  }
  return undefined;
}

let duelists = [];
let lastRegistrationOrDuel = new Date();

// Return true if this duelist is already in the queue, so we can avoid someone stacking up duels or dueling themselves.
// Do any response actions such as speaking or timeouts inside this function.
function checkForDuplicateDuelist(duelist) {
  if (duelists.find(existing => existing.user_id == duelist.user_id)) {
    afterSecondsDoSay(0, `@${duelist.display_name} is trying to duel themself and that's kind of sad...`)
    return true;
  }
}

// Return true if the duelist has chosen a cursed weapon.
// Do any response actions such as speaking or timeouts inside this function.
function checkForDisqualification(duelist) {
  if (cursedWeapons.find(cursed => duelist.weapon.includes(cursed))) {
    afterSecondsDoSay(0, `@${duelist.display_name} has been disqualified for bringing forbidden weaponry to the grounds!`);
    quietBoop(duelist.user_id, 5 * 60, "Caught by arena security").finally(() => afterSecondsDoSay(0, `kiawaBONK Begone, knave!`));
    return true;
  }
}

function quietBoop(user_id, duration, reason) {
  console.log(`Boopin' ${user_id} for ${duration}s because ${reason}`);
  // todo not hardcode Kiara's user_id
  return apiPostRequest("moderation/bans", { broadcaster_id: 37055465, moderator_id: 37055465 }, { "data": { user_id, duration, reason } })
    .then(response => undefined)
    .catch(error => console.log("Error when doin' a duel boop", error));
}

export default new class DuelManager {
  setApiPostRequest(newApiPostRequest) {
    apiPostRequest = newApiPostRequest;
  }

  setChannel(newChannel) {
    channel = newChannel;
  }

  setTmiClient(newClient) {
    client = newClient;
  }
  
  registerDuelistFromTmiMessage(channel, tags, message, self) {
    const duelist = {};
    duelist.display_name = tags["display-name"];
    duelist.user_id = tags["user-id"];

    // first word is the command, everything after is the weapon
    let weapon = message.split(/\s+/).slice(1).join(" ").trim();
    if (!weapon) {
      weapon = sample(fallbackWeapons);
    }
    duelist.weapon = weapon;
    this.#registerDuelist(duelist);
  }
  
  registerDuelistFromTesMessage(event) {
    const duelist = {};
    duelist.display_name = event.chatter_user_name;
    duelist.user_id = event.chatter_user_id;

    // first word is the command, everything after is the weapon
    let weapon = event.message.text.split(/\s+/).slice(1).join(" ").trim();
    if (!weapon) {
      weapon = sample(fallbackWeapons);
    }
    duelist.weapon = weapon;
    this.#registerDuelist(duelist);
  }

  #registerDuelist(duelist) {
    if (checkForDuplicateDuelist(duelist)) {
      return;
    }
    if (checkForDisqualification(duelist)) {
      return;
    }
    
    duelists.push(duelist);
    lastRegistrationOrDuel = new Date();
    if (duelists.length % 2 == 0) {
      const opponent = duelists[duelists.length - 2];
      afterSecondsDoSay(0, `@${duelist.display_name} has accepted @${opponent.display_name}'s duel and will be fighting with their ${duelist.weapon}`)
    }
    else {
      afterSecondsDoSay(0, `@${duelist.display_name} wants to duel with their ${duelist.weapon}!! Type '!duel' to fight them!`);
    }
  }
}

const durationBetweenMatches = 15 * 1000; // 15 seconds

function afterSecondsDoSay(seconds, message) {
  if (client && channel && message && seconds >= 0) { // make sure all the inverted dependencies have been supplied by Kiara_bot.js
    setTimeout(() => client.say(channel, message), seconds * 1000);
  }
}

let interval = setInterval(() => {
  if (duelists.length > 1) {
    lastRegistrationOrDuel = new Date();
    
    // Pick our fighters
    const competitor = duelists[0];
    const opponent = duelists[1];

    // Perform the pageantry
    const rallyingCry = sample(rallyingCries)(competitor, opponent);
    afterSecondsDoSay(0, rallyingCry);
    const brandishingCry = sample(brandishingCries)(competitor, opponent);
    afterSecondsDoSay(2, brandishingCry);
    const countdownStart = sample(countdownStarts)(competitor, opponent, 3);
    afterSecondsDoSay(4, countdownStart);
    afterSecondsDoSay(5, `2!`);
    afterSecondsDoSay(6, `1!`);

    // Choose a winner, announce the results, and bonk the loser
    const waitToAnnounceForSeconds = 7;
    setTimeout(() => {
      // remove fighters from the queue
      duelists = duelists.slice(2);
      
      const [winner, loser] = Math.random() >= 0.5 ? [competitor, opponent] : [opponent, competitor];
      let boopSeconds = 5 * 60; // 5 minutes
      
      updateMatch(winner, true, loser);
      updateMatch(loser, false, winner);
      
      const winnerNewWinCount = getWins(winner);
      const victoryCry = sample(victoryCries)(winner, loser);
      // we already waited to say this
      afterSecondsDoSay(0, victoryCry + ` Congratulations on their ${getOrdinalFor(winnerNewWinCount)} win!`);
      quietBoop(loser.user_id, boopSeconds, `Defeated by @${winner.display_name}'s ${winner.weapon}`);
      
    }, waitToAnnounceForSeconds * 1000);
  }
  else if (duelists.length == 1 && millisSinceDate(lastRegistrationOrDuel) >= 60 * 1000) {
    const duelist = duelists[0];
    duelists = duelists.slice(1);
    afterSecondsDoSay(0, `Nobody dared to challenge @${duelist.display_name} and their mighty ${duelist.weapon}. They leave the arena in disappointment... for now.`)
  }
}, durationBetweenMatches);

function getStats(duelist) {
  if (!db.stats) { // first time recording stats ever
    db.stats = {};
  }
  if (!db.stats[duelist.user_id]) { // first time this person has dueled
    db.stats[duelist.user_id] = {
      user_id: duelist.user_id,
      display_name: duelist.display_name, // just easier to read when editing the database
      results: [],
    };
  }
  const stats = db.stats[duelist.user_id];
  stats.display_name = duelist.display_name; // in case their name changes over time
  return stats;
}

function getWins(duelist) {
  const results = getStats(duelist).results;
  const wins = results.filter(result => result.won).length;
  return wins;
}

function updateMatch(duelist, won, opponent) {
  const stats = getStats(duelist);
  stats.results.push({
    date: new Date().toISOString(),
    won,
    weapon: duelist.weapon,
    opponent,
  })
}

function getOrdinalFor(i) {
  const written = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  if (written[i]) {
    return written[i];
  }
  const lastTwoDigits = i % 100;
  if ([11, 12, 13].includes(lastTwoDigits)) {
    return i + "th";
  }
  const lastDigit = i % 10;
  const suffixes = [undefined, "st", "nd", "rd"];
  return `${i}${suffixes[lastDigit] ?? "th"}`;
}

function millisSinceDate(date) {
  return millisBetweenDates(new Date(), date);
}

function millisBetweenDates(date1, date2) {
  const time1 = date1?.getTime?.() ?? 0;
  const time2 = date2?.getTime?.() ?? 0;
  return Math.abs(time1 - time2);
}