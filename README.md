Kiara_Bot.js is the root file. it loads a .env (you need to provide)



CURRENT KNOWN BUGS
-if a twitch login is needed due to a scope change, the bot can't do this because it breaks before this action can be completed
-some badges that share in common names between global and channel specific badges require updates
-only one browser client can be connected to the websocket at once
-browser source currently points to a local file instead of a a host location (add hosting of the chat widget somewhere?)


TODO
Chat Widget
___________
-smooth animation for new chat messages popping in
-custom avatars as well as twitch avatar support
-highlighting for bit cheers
-support for FFZ/BTTV
-implementation to allow multiple browser sources in OBS with different CSS simultaneously
-add in events (like subs, raids, cheers, etc. etc.)
-fun things for events
-assign a random color that persists through multiple chat messages
-support for "!" and "?" modifiers to the avatar based on if those characters are detected in a message or not (must know to ignore first character so ! commands do not get flagged for this)

Chat Bot
___________
-Timers for bot commands
-magic 8 ball


THINGS TO TEST
-Do channel bands work?
-do global unicode emotes that you can put in twitch work?
