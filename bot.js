require("dotenv").config();
const { Client, GatewayIntentBits, ActivityType, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const tmi    = require("tmi.js");
const fetch  = require("node-fetch");
const express = require("express");
const cors   = require("cors");
const https  = require("https");

// ─── Configuration (tout via variables d'environnement) ───────
const STREAM_OFF_IMAGE = process.env.STREAM_OFF_IMAGE || "";
const PLANNING_IMAGE   = process.env.PLANNING_IMAGE   || "";
const TWITCH_CHANNEL   = process.env.TWITCH_CHANNEL   || "";
const TWITCH_URL       = `https://www.twitch.tv/${TWITCH_CHANNEL}`;
const SUB_URL          = process.env.SUB_URL || `https://www.twitch.tv/subs/${TWITCH_CHANNEL}`;

const CHANNEL_ID       = process.env.CHANNEL_ID;       // salon pour /off, /delay, /message
const CHANNEL_LIVE_ID  = process.env.CHANNEL_LIVE_ID || CHANNEL_ID; // salon pour notification live

// Rôles à pinger (IDs séparés par des virgules), ex: "123456,789012"
const PING_ROLE_IDS = (process.env.PING_ROLE_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);
const DEFAULT_PING = PING_ROLE_IDS.map(id => `<@&${id}>`).join(" ");

// Whitelist — accès permanent aux commandes admin (IDs séparés par des virgules)
const WHITELIST = (process.env.WHITELIST_USER_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

// ─── 2e chaîne Twitch (relais / événement, optionnel) ─────────
const RELAY_CHANNEL       = process.env.RELAY_TWITCH_CHANNEL || "";
const RELAY_NOTIFICATIONS = process.env.RELAY_NOTIFICATIONS === "true";
const RELAY_DISCORD_ID    = process.env.RELAY_DISCORD_CHANNEL_ID || CHANNEL_LIVE_ID;
const RELAY_PING          = process.env.RELAY_PING || "";

// ─── Messages répétés (rotation toutes les 15 min, en live uniquement) ─
let autoMessages = (process.env.AUTO_MESSAGES || "")
  .split("|")
  .map(m => m.trim())
  .filter(Boolean);
let autoMsgIndex  = 0;
let autoMsgTimer  = null;
let isLiveActive  = false;

function startAutoMessages() {
  if (autoMsgTimer) return;
  console.log("⏱ Démarrage des messages automatiques Twitch");
  autoMsgTimer = setInterval(() => {
    if (!isLiveActive || autoMessages.length === 0) return;
    const msg = autoMessages[autoMsgIndex % autoMessages.length];
    twitchClient.say(TWITCH_CHANNEL, msg).catch(err => console.error("Auto-msg erreur :", err.message));
    autoMsgIndex++;
  }, 15 * 60 * 1000);
}

function stopAutoMessages() {
  if (autoMsgTimer) {
    clearInterval(autoMsgTimer);
    autoMsgTimer = null;
    console.log("⏹ Messages automatiques Twitch arrêtés");
  }
}

// ─── Slash Commands ────────────────────────────────────────────
const ADMIN_COMMANDS = ["off", "delay", "message", "twitch", "addmsg", "listmsg", "delmsg"];

const commands = [
  new SlashCommandBuilder()
    .setName("off")
    .setDescription("Poste le message Stream Off")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("delay")
    .setDescription("Annonce un live décalé")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName("15").setDescription("Live décalé de ~15 minutes"))
    .addSubcommand(sub => sub.setName("45").setDescription("Live décalé de ~45 minutes"))
    .addSubcommand(sub =>
      sub.setName("heure")
        .setDescription("Live décalé à une heure précise")
        .addStringOption(opt =>
          opt.setName("heure").setDescription("Heure (ex: 21:30)").setRequired(true))),
  new SlashCommandBuilder()
    .setName("message")
    .setDescription("Envoie un message custom dans Discord")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName("texte").setDescription("Le message à envoyer").setRequired(true)),
  // ── Commandes publiques ──
  new SlashCommandBuilder()
    .setName("sub")
    .setDescription("Reçois le lien pour s'abonner à la chaîne Twitch"),
  new SlashCommandBuilder()
    .setName("planning")
    .setDescription("Affiche le planning des streams"),
  // ── Commandes admin ──
  new SlashCommandBuilder()
    .setName("twitch")
    .setDescription("Envoie un message dans le chat Twitch")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName("message").setDescription("Message à envoyer dans le chat").setRequired(true)),
  new SlashCommandBuilder()
    .setName("addmsg")
    .setDescription("Ajoute un message automatique dans le chat Twitch")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName("message").setDescription("Message à ajouter à la rotation").setRequired(true)),
  new SlashCommandBuilder()
    .setName("listmsg")
    .setDescription("Affiche les messages automatiques Twitch")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("delmsg")
    .setDescription("Supprime un message automatique Twitch")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(opt =>
      opt.setName("numero").setDescription("Numéro du message (voir /listmsg)").setRequired(true)),
].map(cmd => cmd.toJSON());

// ─── Bot Discord ───────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`✅ Discord : connecté en tant que ${client.user.tag}`);

  if (TWITCH_CHANNEL) {
    client.user.setPresence({
      activities: [{ name: TWITCH_CHANNEL, type: ActivityType.Streaming, url: TWITCH_URL }],
      status: "online",
    });
  }

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅ Slash commands enregistrées");
  } catch (err) { console.error("Erreur slash commands :", err.message); }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Vérification des accès pour les commandes admin
  if (ADMIN_COMMANDS.includes(interaction.commandName)) {
    const isWhitelisted = WHITELIST.includes(interaction.user.id);
    const isAdmin = interaction.guild && interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isWhitelisted && !isAdmin) {
      return await interaction.reply({
        content: "❌ Vous n'avez pas la permission d'utiliser cette commande.",
        ephemeral: true,
      });
    }

    if (!interaction.guild && !isWhitelisted) {
      return await interaction.reply({
        content: "❌ Cette commande ne peut pas être utilisée en message privé.",
        ephemeral: true,
      });
    }
  }

  const isPrivate = ["sub", "planning", "listmsg", "addmsg", "delmsg", "twitch"].includes(interaction.commandName);
  await interaction.deferReply({ ephemeral: isPrivate });

  try {
    // /sub
    if (interaction.commandName === "sub") {
      return await interaction.editReply({
        embeds: [{
          color: 0x9147ff,
          title: `💜 S'abonner à ${TWITCH_CHANNEL}`,
          description: `Soutiens la chaîne en t'abonnant sur Twitch !\n\n👉 ${SUB_URL}`,
          footer: { text: "Merci pour ton soutien !" },
        }],
      });
    }

    // /planning
    if (interaction.commandName === "planning") {
      if (!PLANNING_IMAGE) return await interaction.editReply("📅 Le planning n'est pas encore configuré.");
      return await interaction.editReply({
        embeds: [{
          color: 0x3b82f6,
          title: "📅 Planning des streams",
          image: { url: PLANNING_IMAGE },
          footer: { text: `${TWITCH_CHANNEL} — Twitch` },
        }],
      });
    }

    // /twitch
    if (interaction.commandName === "twitch") {
      const msg = interaction.options.getString("message");
      try {
        await twitchClient.say(TWITCH_CHANNEL, msg);
        return await interaction.editReply(`✅ Message envoyé dans le chat Twitch : **${msg}**`);
      } catch (err) {
        return await interaction.editReply(`❌ Erreur chat Twitch : ${err.message}`);
      }
    }

    // /addmsg
    if (interaction.commandName === "addmsg") {
      const msg = interaction.options.getString("message");
      autoMessages.push(msg);
      return await interaction.editReply(`✅ Message ajouté à la rotation !\n\n**Total :** ${autoMessages.length} message(s)`);
    }

    // /listmsg
    if (interaction.commandName === "listmsg") {
      if (autoMessages.length === 0) return await interaction.editReply("📭 Aucun message automatique configuré.");
      const list = autoMessages.map((m, i) => `**${i + 1}.** ${m}`).join("\n");
      return await interaction.editReply({
        embeds: [{
          color: 0x9147ff,
          title: "📋 Messages automatiques Twitch",
          description: list,
          footer: { text: `${autoMessages.length} message(s) — rotation toutes les 15 min` },
        }],
      });
    }

    // /delmsg
    if (interaction.commandName === "delmsg") {
      const num = interaction.options.getInteger("numero");
      if (num < 1 || num > autoMessages.length) {
        return await interaction.editReply(`❌ Numéro invalide. Il y a ${autoMessages.length} message(s).`);
      }
      const removed = autoMessages.splice(num - 1, 1)[0];
      return await interaction.editReply(`✅ Message supprimé : **${removed}**`);
    }

    // Commandes qui postent dans le salon Discord
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) return interaction.editReply("❌ Salon introuvable.");

    // /off
    if (interaction.commandName === "off") {
      const now = Math.floor(Date.now() / 1000);
      await channel.send({
        content: `${DEFAULT_PING}\n🔴 **Stream Off** — <t:${now}:F>`.trim(),
        embeds: [{
          color: 0x6441a5,
          title: "🔴 Stream Off",
          description: `Le stream est terminé.\n\n**Arrêté le** <t:${now}:F>\n*(Il y a <t:${now}:R>)*\n\n🎥 ${TWITCH_URL}`,
          image: STREAM_OFF_IMAGE ? { url: STREAM_OFF_IMAGE } : undefined,
          footer: { text: "À bientôt pour un prochain stream !" },
          timestamp: new Date().toISOString(),
        }],
      });
      return await interaction.editReply("✅ Stream Off posté !");
    }

    // /delay
    if (interaction.commandName === "delay") {
      const sub = interaction.options.getSubcommand();
      let minutes, delayLabel;
      if (sub === "15") { minutes = 15; delayLabel = `dans **~15 minutes**`; }
      else if (sub === "45") { minutes = 45; delayLabel = `dans **~45 minutes**`; }
      else {
        const val = interaction.options.getString("heure");
        const match = val.match(/^(\d{1,2})[h:](\d{2})$/);
        if (!match) return interaction.editReply("❌ Format invalide. Utilisez `21:30` ou `21h30`.");
        const [, h, m] = match;
        const now = new Date(), target = new Date();
        target.setHours(parseInt(h), parseInt(m), 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        minutes = Math.round((target - now) / 60000);
        delayLabel = `à **${val}**`;
      }
      const targetTimestamp = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
      await channel.send({
        content: DEFAULT_PING || undefined,
        embeds: [{
          color: 0xf97316,
          title: "🟠 Live Décalé",
          description: `Le live est décalé ${delayLabel}.\n\n**Nouveau départ prévu :** <t:${targetTimestamp}:F>\n*(Dans <t:${targetTimestamp}:R>)*\n\n🎥 ${TWITCH_URL}`,
          footer: { text: "Merci pour votre patience !" },
          timestamp: new Date().toISOString(),
        }],
      });
      return await interaction.editReply("✅ Live Décalé posté !");
    }

    // /message
    if (interaction.commandName === "message") {
      const texte = interaction.options.getString("texte");
      await channel.send({ content: `${DEFAULT_PING}\n${texte}\n\n🎥 ${TWITCH_URL}`.trim() });
      return await interaction.editReply("✅ Message posté !");
    }

  } catch (err) {
    console.error(err.message);
    await interaction.editReply(`❌ Erreur : ${err.message}`);
  }
});

client.login(process.env.DISCORD_TOKEN);

// ─── Bot Twitch (chat) ─────────────────────────────────────────
const twitchClient = new tmi.Client({
  identity: {
    username: process.env.TWITCH_BOT_USERNAME,
    password: `oauth:${process.env.TWITCH_BOT_TOKEN}`,
  },
  channels: [TWITCH_CHANNEL],
});

twitchClient.connect()
  .then(() => console.log(`✅ Twitch chat : connecté en tant que ${process.env.TWITCH_BOT_USERNAME}`))
  .catch(err => console.error("Erreur Twitch chat :", err.message));

// ─── Détection live Twitch (toutes les 5 min) ──────────────────
let twitchAccessToken = null;
let wasLive  = false;
let wasLive2 = false;

async function getTwitchToken() {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type:    "client_credentials",
    }),
  });
  const data = await res.json();
  twitchAccessToken = data.access_token;
  console.log("✅ Twitch API : token récupéré");
}

async function checkTwitchLive() {
  if (!TWITCH_CHANNEL) return;
  try {
    if (!twitchAccessToken) await getTwitchToken();

    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${TWITCH_CHANNEL}`, {
      headers: {
        "Client-ID":     process.env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${twitchAccessToken}`,
      },
    });

    if (res.status === 401) { await getTwitchToken(); return checkTwitchLive(); }

    const data = await res.json();
    const stream = data.data && data.data[0];
    const isLive = !!stream;

    if (isLive && !wasLive) {
      wasLive = true;
      isLiveActive = true;
      startAutoMessages();
      console.log(`🔴 Live détecté : ${stream.title}`);

      try {
        const liveChannel = await client.channels.fetch(CHANNEL_LIVE_ID);
        if (liveChannel) {
          await liveChannel.send({
            content: `${DEFAULT_PING}\n🔴 **Le stream est EN DIRECT !**`.trim(),
            embeds: [{
              color: 0x9147ff,
              title: `🔴 ${stream.title}`,
              description: `**Catégorie :** ${stream.game_name}\n**Viewers :** ${stream.viewer_count}\n\n👉 ${TWITCH_URL}`,
              thumbnail: { url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${TWITCH_CHANNEL}-320x180.jpg?t=${Date.now()}` },
              footer: { text: `${TWITCH_CHANNEL} est en live !` },
              timestamp: new Date(stream.started_at).toISOString(),
            }],
          });
        }
      } catch (err) { console.error("Erreur notification Discord :", err.message); }

      try {
        await twitchClient.say(TWITCH_CHANNEL, `🔴 Le stream vient de démarrer ! Bienvenue tout le monde ! 👋`);
      } catch (err) { console.error("Erreur message chat Twitch :", err.message); }

    } else if (!isLive && wasLive) {
      wasLive = false;
      isLiveActive = false;
      stopAutoMessages();
      console.log("⚫ Stream terminé — messages automatiques arrêtés");
    }

  } catch (err) { console.error("Erreur vérification Twitch :", err.message); }
}

// ─── Détection 2e chaîne Twitch (relais, optionnel) ────────────
async function checkRelayLive() {
  if (!RELAY_CHANNEL) return;

  try {
    if (!twitchAccessToken) await getTwitchToken();

    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${RELAY_CHANNEL}`, {
      headers: {
        "Client-ID":     process.env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${twitchAccessToken}`,
      },
    });

    if (res.status === 401) { await getTwitchToken(); return checkRelayLive(); }

    const data = await res.json();
    const stream = data.data && data.data[0];
    const isLive = !!stream;

    if (isLive && !wasLive2) {
      wasLive2 = true;
      console.log(`🔴 [RELAIS] Live détecté sur ${RELAY_CHANNEL} : ${stream.title}`);

      if (RELAY_NOTIFICATIONS) {
        try {
          const ch = await client.channels.fetch(RELAY_DISCORD_ID);
          if (ch) {
            await ch.send({
              content: RELAY_PING || undefined,
              embeds: [{
                color: 0x9147ff,
                title: `🔴 ${stream.title}`,
                description: `**Chaîne :** ${RELAY_CHANNEL}\n**Catégorie :** ${stream.game_name}\n**Viewers :** ${stream.viewer_count}\n\n👉 https://www.twitch.tv/${RELAY_CHANNEL}`,
                thumbnail: { url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${RELAY_CHANNEL}-320x180.jpg?t=${Date.now()}` },
                footer: { text: `${RELAY_CHANNEL} est en live !` },
                timestamp: new Date(stream.started_at).toISOString(),
              }],
            });
          }
        } catch (err) { console.error("Erreur notification relais :", err.message); }
      }

    } else if (!isLive && wasLive2) {
      wasLive2 = false;
      console.log(`⚫ [RELAIS] Stream ${RELAY_CHANNEL} terminé`);
    }

  } catch (err) { console.error("Erreur vérification relais :", err.message); }
}

setTimeout(() => {
  checkTwitchLive();
  checkRelayLive();
  setInterval(checkTwitchLive, 5 * 60 * 1000);
  setInterval(checkRelayLive, 5 * 60 * 1000);
}, 10000);

// ─── Express ──────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

async function getChannel() {
  const ch = await client.channels.fetch(CHANNEL_ID);
  if (!ch) throw new Error("Salon introuvable.");
  return ch;
}

app.get("/auto-messages", (req, res) => {
  res.json({ messages: autoMessages, isLive: isLiveActive });
});

app.post("/auto-messages/add", (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "Message vide." });
  autoMessages.push(message.trim());
  res.json({ success: true, messages: autoMessages });
});

app.post("/auto-messages/delete", (req, res) => {
  const { index } = req.body;
  if (index < 0 || index >= autoMessages.length) return res.status(400).json({ error: "Index invalide." });
  autoMessages.splice(index, 1);
  res.json({ success: true, messages: autoMessages });
});

app.post("/send-stream-off", async (req, res) => {
  try {
    const channel = await getChannel();
    const pings = req.body.pings || "";
    const now = Math.floor(Date.now() / 1000);
    await channel.send({
      content: `${pings}\n🔴 **Stream Off** — <t:${now}:F>`.trim(),
      embeds: [{
        color: 0x6441a5,
        title: "🔴 Stream Off",
        description: `Le stream est terminé.\n\n**Arrêté le** <t:${now}:F>\n*(Il y a <t:${now}:R>)*\n\n🎥 ${TWITCH_URL}`,
        image: STREAM_OFF_IMAGE ? { url: STREAM_OFF_IMAGE } : undefined,
        footer: { text: "À bientôt pour un prochain stream !" },
        timestamp: new Date().toISOString(),
      }],
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/send-delay", async (req, res) => {
  try {
    const channel = await getChannel();
    const { minutes, customTime, pings = "" } = req.body;
    const targetTimestamp = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);
    const delayLabel = customTime ? `à **${customTime}**` : `dans **~${minutes} minutes**`;
    await channel.send({
      content: pings || undefined,
      embeds: [{
        color: 0xf97316,
        title: "🟠 Live Décalé",
        description: `Le live est décalé ${delayLabel}.\n\n**Nouveau départ prévu :** <t:${targetTimestamp}:F>\n*(Dans <t:${targetTimestamp}:R>)*\n\n🎥 ${TWITCH_URL}`,
        footer: { text: "Merci pour votre patience !" },
        timestamp: new Date().toISOString(),
      }],
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/send-custom", async (req, res) => {
  try {
    const channel = await getChannel();
    const { type, title, body, color, pings = "" } = req.body;
    if (type === "text") {
      await channel.send({ content: `${pings}\n${body}\n\n🎥 ${TWITCH_URL}`.trim() });
    } else {
      const colorInt = parseInt((color || "#3b82f6").replace("#", ""), 16);
      await channel.send({
        content: pings || undefined,
        embeds: [{
          color: colorInt,
          title: title || undefined,
          description: body ? `${body}\n\n🎥 ${TWITCH_URL}` : `🎥 ${TWITCH_URL}`,
          timestamp: new Date().toISOString(),
        }],
      });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Serveur démarré sur http://localhost:${PORT}`));

const APP_URL = process.env.RENDER_EXTERNAL_URL;
if (APP_URL) {
  setInterval(() => {
    https.get(APP_URL, (res) => console.log(`🔁 Keep-alive : ${res.statusCode}`))
      .on("error", (err) => console.error("Keep-alive erreur :", err.message));
  }, 10 * 60 * 1000);
}
