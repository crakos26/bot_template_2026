require("dotenv").config();
const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const tmi    = require("tmi.js");
const fetch  = require("node-fetch");
const express = require("express");
const cors   = require("cors");
const https  = require("https");

// --------------constant ----  
const STREAM_OFF_IMAGE = "https://YOUR_IMAGE_off_URL";// image tht will be posted for exemlple a livestream is canceled
const TWITCH_URL       = "https://www.twitch.tv/YOUR_TWITCH";//the link of your twitch chanel
const SUB_URL          = "https://www.twitch.tv/subs/YOUR_TWITCHID";// this link follow the twitch.tv/subs/ path to direct to the sub page directly
const PLANNING_IMAGE   = "https://YOUR_IMAGE_planning_URL";// image for a set planign can be replaced with what you want 
const TWITCH_CHANNEL   = process.env.TWITCH_CHANNEL || "YOUR_TWITCH_ID";
const CHANNEL_LIVE_ID  = "12345678910";// replace with the chanell ID you want the bot to post when he detect your live 
const DEFAULT_PING     = `<@&123456789> <@&123456789>`;//put many id ROLE id you want be ping as a default 

// ------ cmd discord using / ---------

//--------BOT discord -------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`✅ Discord : connecté en tant que ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: "YOUR_TWITCH_USERNAME", type: ActivityType.Streaming, url: TWITCH_URL }],//will show your bot activy as playing to watch your chanel 
    status: "online",
  });
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ Slash commands enregistrées");
  } catch (err) { console.error("Erreur slash commands :", err.message); }
});
