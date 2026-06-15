# bot_template_2026
Template for A discord bot connected to twitch api . 

## Requirement
- ` app on twitch` - creating your app on twitch appi . https://dev.twitch.tv
- `Application Discord` : creating you app on discord at https://discord.com/developers/applications . 
- `Render service` web hoster -> set in a a webservice environment


## Structure

- `public/index` : webpages de l'application
- `/bot.js` : bot code
- `/package.json` :


### Render Environment / varribale  

- `ADMIN_PASSWORD`: password of web acces
- `CHANNEL_ID`  : Discord chanel id for where bot will be posting
- `DISCORD_TOKEN` : your discord application tocken 
- `PANEL_PASSWORD`  : web pannel acces
- `TWITCH_BOT_TOKEN`  : Twitch Token Generator
- `TWITCH_BOT_USERNAME` : Twitch accounst username *if your using an acount to write in chat*
- `TWITCH_CHANNEL` : Twitch chanel your trying to watch , obtainable @ twitch.tv/**YOUR_ID**
- `TWITCH_CLIENT_ID` :  client Tw
- `TWITCH_CLIENT_SECRET` : your secret need to be generated on dev_twitch
- `RELAY_NOTIFICATIONS` : = true *if you want to also watch for later*
- `RELAY_TWITCH_CHANNEL`: 2nd channel to watch if you need back up or multi account *OPTIONAL*

