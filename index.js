
/*
* @Author Aljur Pogoy
* Bot Developed exact December 24 11:58 PM 2024
* @Moderators Aljur pogoy, Kenneth Panio, Liane Cagara
* Thanks to them
*/

require("tsconfig-paths/register");
require("ts-node").register();
require("./core/global");
const { MongoClient } = require("mongodb");
const fs = require("fs-extra");
const path = require("path");
const login = require("fbvibex");
const { handleAuroraCommand, loadAuroraCommands } = require("./core/auroraBoT");
loadAuroraCommands();

global.threadState = { active: new Map(), approved: new Map(), pending: new Map() };
global.client = { reactionListener: {}, globalData: new Map() };
global.Kagenou = { autodlEnabled: false, replies: {} };
global.db = null;
global.config = { admins: [], moderators: [], developers: [], Prefix: ["/"], botName: "Shadow Garden Bot", mongoUri: null };
global.globalData = new Map();
global.usersData = new Map();
global.disabledCommands = new Map();
global.userCooldowns = new Map();
global.commands = new Map();
global.nonPrefixCommands = new Map();
global.eventCommands = [];
global.appState = {};
global.reactionData = new Map();

process.on("unhandledRejection", console.error.bind(console));
process.on("exit", () => fs.writeFileSync(path.join(__dirname, "database", "globalData.json"), JSON.stringify([...global.globalData])));
global.userCooldowns = new Map();
const reloadCommands = () => {
  global.commands.clear();
  global.nonPrefixCommands.clear();
  global.eventCommands.length = 0;
  loadCommands();
};
global.reloadCommands = reloadCommands;

const commandsDir = path.join(__dirname, "commands");
const bannedUsersFile = path.join(__dirname, "database", "bannedUsers.json");
const configFile = path.join(__dirname, "config.json");
const globalDataFile = path.join(__dirname, "database", "globalData.json");
let bannedUsers = {};

if (fs.existsSync(globalDataFile)) {
  const data = JSON.parse(fs.readFileSync(globalDataFile));
  for (const [key, value] of Object.entries(data)) global.globalData.set(key, value);
}

const loadBannedUsers = () => {
  try {
    bannedUsers = JSON.parse(fs.readFileSync(bannedUsersFile, "utf8"));
  } catch {
    bannedUsers = {};
  }
};

function getUserRole(uid) {
  uid = String(uid);
  if (!global.config || !global.config.developers || !global.config.moderators || !global.config.admins) {
    return 0;
  }
  const developers = global.config.developers.map(String);
  const moderators = global.config.moderators.map(String);
  const admins = global.config.admins.map(String);
  if (developers.includes(uid)) return 3;
  if (moderators.includes(uid)) return 2;
  if (admins.includes(uid)) return 1;
  return 0;
}

async function handleReply(api, event) {
  const replyData = global.Kagenou.replies[event.messageReply?.messageID];
  if (!replyData) return;
  if (replyData.author && event.senderID !== replyData.author) {
    return api.sendMessage("Only the original sender can reply to this message.", event.threadID, event.messageID);
  }
  try {
    await replyData.callback({ ...event, event, api, attachments: event.attachments || [], data: replyData });
  } catch (err) {
    api.sendMessage(`An error occurred while processing your reply: ${err.message}`, event.threadID, event.messageID);
  }
}

const loadCommands = () => {
  const retroGradient = require("gradient-string").retro;
  const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith(".js") || file.endsWith(".ts"));
  for (const file of commandFiles) {
    try {
      const commandPath = path.join(commandsDir, file);
      delete require.cache[require.resolve(commandPath)];
      const commandModule = require(commandPath);
      const command = commandModule.default || commandModule;
      if (command.config && command.config.name && command.run) {
        global.commands.set(command.config.name.toLowerCase(), command);
        if (command.config.aliases) command.config.aliases.forEach(alias => global.commands.set(alias.toLowerCase(), command));
        if (command.config.nonPrefix) global.nonPrefixCommands.set(command.config.name.toLowerCase(), command);
      } else if (command.name) {
        global.commands.set(command.name.toLowerCase(), command);
        if (command.aliases) command.aliases.forEach(alias => global.commands.set(alias.toLowerCase(), command));
        if (command.nonPrefix) global.nonPrefixCommands.set(command.name.toLowerCase(), command);
      }
      if (command.handleEvent) global.eventCommands.push(command);
    } catch (error) {
    }
  }
};

loadCommands();
let appState = {};

try {
  appState = JSON.parse(fs.readFileSync("./appstate.dev.json", "utf8"));
} catch (error) {
}
try {
  const configData = JSON.parse(fs.readFileSync(configFile, "utf8"));
  global.config = {
    admins: configData.admins || [],
    moderators: configData.moderators || [],
    developers: configData.developers || [],
    Prefix: Array.isArray(configData.Prefix) && configData.Prefix.length > 0 ? configData.Prefix : ["/"],
    botName: configData.botName || "Shadow Garden Bot",
    mongoUri: configData.mongoUri || null,
    ...configData,
  };
} catch (error) {
  global.config = { admins: [], moderators: [], developers: [], Prefix: ["/"], botName: "Shadow Garden Bot", mongoUri: null };
}
let db = null;
const uri = global.config.mongoUri || null;
if (uri) {
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  const cidkagenou = {
    db: function (collectionName) {
      return client.db("chatbot_db").collection(collectionName);
    },
  };
  async function connectDB() {
    try {
      await client.connect();
      db = cidkagenou;
      global.db = db;
      const usersCollection = db.db("users");
      const allUsers = await usersCollection.find({}).toArray();
      allUsers.forEach(user => global.usersData.set(user.userId, user.data));
    } catch (err) {
      db = null;
      global.db = null;
    }
  }
  connectDB();
} else {
  db = null;
  global.db = null;
}
loadBannedUsers();
const setCooldown = (userID, commandName, cooldown) => {
  const key = `${userID}:${commandName}`;
  global.userCooldowns.set(key, Date.now() + cooldown * 1000);
};
const checkCooldown = (userID, commandName, cooldown) => {
  const key = `${userID}:${commandName}`;
  const expiry = global.userCooldowns.get(key);
  if (expiry && Date.now() < expiry) {
    const remaining = Math.ceil((expiry - Date.now()) / 1000);
    return `Please wait ${remaining} second(s) before using '${commandName}' again.`;
  }
  return null;
};
const sendMessage = async (api, messageData) => {
  try {
    const { threadID, message, replyHandler, messageID, senderID, attachment } = messageData;
    if (!threadID || (typeof threadID !== "number" && typeof threadID !== "string" && !Array.isArray(threadID))) {
      throw new Error("ThreadID must be a number, string, or array and cannot be undefined.");
    }
    if (!message || message.trim() === "") return;
    return new Promise((resolve, reject) => {
      api.sendMessage({ body: message, attachment }, threadID, (err, info) => {
        if (err) {
          return reject(err);
        }
        if (replyHandler && typeof replyHandler === "function") {
          global.Kagenou.replies[info.messageID] = { callback: replyHandler, author: senderID };
          setTimeout(() => delete global.Kagenou.replies[info.messageID], 300000);
        }
        resolve(info);
      }, messageID || null);
    });
  } catch (error) {
    throw error;
  }
};
const handleMessage = async (api, event) => {
  const { threadID, senderID, body, messageReply, messageID, attachments } = event;
  if (!body && !attachments) return;
  const message = body ? body.trim() : "";
  const words = message.split(/ +/);
  let prefixes = global.config.Prefix;
  loadBannedUsers();
  if (messageReply && global.Kagenou.replies && global.Kagenou.replies[messageReply.messageID]) {
    return handleReply(api, event);
  }
  let commandName = words[0]?.toLowerCase() || "";
  let args = words.slice(1) || [];
  let command = null;
  let prefix = global.config.Prefix[0];
  let isCommandAttempt = false;
  for (const prefix of prefixes) {
    if (message.startsWith(prefix)) {
      commandName = message.slice(prefix.length).split(/ +/)[0].toLowerCase();
      args = message.slice(prefix.length).split(/ +/).slice(1);
      command = global.commands.get(commandName);
      isCommandAttempt = true;
      if (command && command.config?.nonPrefix && message === commandName) command = null;
      break;
    }
  }
  if (!command) {
    command = global.nonPrefixCommands.get(commandName);
    if (command) isCommandAttempt = true;
  }
  if (isCommandAttempt && bannedUsers[senderID]) {
    return api.sendMessage(`You are banned from using bot commands.\nReason: ${bannedUsers[senderID].reason}`, threadID, messageID);
  }
  if (command) {
    const userRole = getUserRole(senderID);
    const commandRole = command.config?.role ?? command.role ?? 0;
    if (userRole < commandRole) {
      return api.sendMessage(
        `🛡️ 𝙾𝚗𝚕𝚢 𝙼𝚘𝚍𝚎𝚛𝚊𝚝𝚘𝚛𝚜  𝚘𝚛  𝚑𝚒𝚐𝚑𝚎𝚛 𝚌𝚊𝚗 𝚞𝚜𝚎 𝚝𝚑𝚒𝚜 𝚌𝚘𝚖𝚖𝚊𝚗𝚍.`,
        threadID,
        messageID
      );
    }
    const disabledCommandsList = global.disabledCommands.get("disabled") || [];
    if (disabledCommandsList.includes(commandName)) {
      return api.sendMessage(`${commandName.charAt(0).toUpperCase() + commandName.slice(1)} Command is under maintenance please wait..`, threadID, messageID);
    }
    const cooldown = command.config?.cooldown ?? command.cooldown ?? 0;
    const cooldownMessage = checkCooldown(senderID, commandName, cooldown || 3);
    if (cooldownMessage) return sendMessage(api, { threadID, message: cooldownMessage, messageID });
    setCooldown(senderID, commandName, cooldown || 3);
    try {
      if (command.execute) {
        await command.execute(api, event, args, global.commands, prefix, global.config.admins, appState, sendMessage, usersData, global.globalData);
      } else if (command.run) {
        await command.run({ api, event, args, attachments, usersData: global.usersData, globalData: global.globalData, admins: global.config.admins, prefix: prefix, db: global.db, commands: global.commands });
      }
      if (global.db && global.usersData.has(senderID)) {
        const usersCollection = global.db.db("users");
        const userData = global.usersData.get(senderID) || {};
        await usersCollection.updateOne(
          { userId: senderID },
          { $set: { userId: senderID, data: userData } },
          { upsert: true }
        );
      }
    } catch (error) {
      sendMessage(api, { threadID, message: `Error executing command '${commandName}': ${error.message}` });
    }
  } else if (isCommandAttempt) {
    sendMessage(api, { threadID, message: `Invalid Command!, Use ${global.config.Prefix[0]}help for available commands.`, messageID });
  }
};

async function handleReaction(api, event) {
  const { messageID, reaction, threadID, senderID } = event;
  const reactionInfo = global.reactionData.get(messageID);
  if (!reactionInfo) {
    return;
  }
  await reactionInfo.callback({ api, event, reaction, threadID, messageID, senderID });
  global.reactionData.delete(messageID);
}

const handleEvent = async (api, event) => {
  for (const command of global.eventCommands) {
    try {
      if (command.handleEvent) await command.handleEvent({ api, event, db: global.db });
    } catch (error) {
    }
  }
};

const { preventBannedResponse } = require("./commands/thread");

const startListeningForMessages = (api) => {
  return api.listenMqtt(async (err, event) => {
    if (err) {
      return;
    }
    try {
      let proceed = true;
      if (global.db) {
        const bannedThreadsCollection = global.db.db("bannedThreads");
        const result = await bannedThreadsCollection.findOne({ threadID: event.threadID.toString() });
        if (result) {
          proceed = false;
        }
      }
        if (proceed) {
          await handleEvent(api, event);
        if (event.type === "message_reply" && event.messageReply) {
          const replyMessageID = event.messageReply.messageID;
          if (global.Kagenou.replies[replyMessageID]) {
            await handleReply(api, event);
            return;
          }
          if (global.Kagenou.replyListeners && global.Kagenou.replyListeners.has(replyMessageID)) {
            const listener = global.Kagenou.replyListeners.get(replyMessageID);
            if (typeof listener.callback === "function") {
              await listener.callback({
                api,
                event,
                attachments: event.attachments || [],
                data: { senderID: event.senderID, threadID: event.threadID, messageID: event.messageID },
              });
              global.Kagenou.replyListeners.delete(replyMessageID);
            }
            return;
          }
        }
      if (["message", "message_reply"].includes(event.type)) {
        event.attachments = event.attachments || [];
        await handleMessage(api, event);
        handleAuroraCommand(api, event);
      }
      if (event.type === "message_reaction") {
        await handleReaction(api, event);
      }
      if (event.type === "event" && event.logMessageType === "log:subscribe") {
        const threadID = event.threadID;
        const addedUsers = event.logMessageData.addedParticipants || [];
        const botWasAdded = addedUsers.some(user => user.userFbId === api.getCurrentUserID());
        if (botWasAdded) {
          if (global.db) {
            try {
              const threadInfo = await api.getThreadInfo(threadID);
              const threadName = threadInfo.name || `Unnamed Thread (ID: ${threadID})`;
              await global.db.db("threads").updateOne(
                { threadID },
                { $set: { threadID, name: threadName } },
                { upsert: true }
              );
            } catch (error) {
            }
          }
          if (
            !global.threadState.active.has(threadID) &&
            !global.threadState.approved.has(threadID) &&
            !global.threadState.pending.has(threadID)
          ) {
            global.threadState.pending.set(threadID, { addedAt: new Date() });
            api.sendMessage(`Thank you for inviting me here! ThreadID: ${threadID}`, threadID);
            try {
              await api.changeNickname(global.config.botName, threadID, api.getCurrentUserID());
            } catch (error) {
            }
          }
        }
      }
      if (event.type === "message" && event.body && event.body.startsWith(global.config.Prefix[0])) {
        const words = event.body.trim().split(/ +/);
        const commandName = words[0].slice(global.config.Prefix[0].length).toLowerCase();
        const args = words.slice(1);
        if (commandName === "approve" && global.config.admins.includes(event.senderID)) {
          if (args[0] && args[0].toLowerCase() === "pending") return;
          if (args.length > 0) {
            const targetThreadID = args[0].trim();
            if (/^\d+$/.test(targetThreadID) || /^-?\d+$/.test(targetThreadID)) {
              if (global.threadState.pending.has(targetThreadID)) {
                global.threadState.pending.delete(targetThreadID);
                global.threadState.approved.set(targetThreadID, { approvedAt: new Date() });
                api.sendMessage(`Thread ${targetThreadID} has been approved.`, event.threadID);
              } else if (!global.threadState.approved.has(targetThreadID)) {
                global.threadState.approved.set(targetThreadID, { approvedAt: new Date() });
                api.sendMessage(`Thread ${targetThreadID} has been approved.`, event.threadID);
              }
              }
            }
          }
        }
    } catch (error) {
      console.error("Error in message listener:", error);
    }
  });
};
const startListeningWithAutoRestart = (api) => {
  let stopListener = null;
  const startListener = () => {
    if (stopListener) {
      stopListener();
    }
    try {
      stopListener = startListeningForMessages(api);
    } catch (err) {
      setTimeout(startListener, 5000);
    }
  };
  startListener();
  setInterval(() => {
    startListener();
  }, 3600000);
};

const express = require("express");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "dashboard", "public")));

const startBot = async () => {
  login({ appState }, (err, api) => {
    if (err) {
      process.exit(1);
    }
    api.setOptions({
      forceLogin: true,
      listenEvents: true,
      logLevel: "silent",
      updatePresence: true,
      selfListen: false,
      bypassRegion: "pnb",
      userAgent:
        "ZmFjZWJvb2tleHRlcm5hbGhpdC8xLjEgKCtodHRwOi8vd3d3LmZhY2Vib29rLmNvbS9leHRlcm5hbGhpdF91YXRexHQucGhpKQ==",
      online: true,
      autoMarkDelivery: false,
      autoMarkRead: false,
    });

    global.api = api;
    startListeningWithAutoRestart(api);

    app.get("/", (req, res) => {
      const botUID = api.getCurrentUserID();
      const botName = global.config.botName || "KagenouBotV3";
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <title>KagenouBotV3 Portfolio</title>
            <meta name="description" content="Official portfolio for KagenouBotV3.">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    margin: 0;
                    font-family: 'Arial', sans-serif;
                    background: linear-gradient(135deg, #0a0f1c, #1a2a44);
                    color: #e0e0e0;
                    overflow-x: hidden;
                }
                .header {
                    background: #1a2a44;
                    padding: 20px;
                    text-align: center;
                    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
                }
                .header h1 {
                    margin: 0;
                    font-size: 2.5em;
                    color: #00ffcc;
                    text-transform: uppercase;
                }
                .nav {
                    display: flex;
                    justify-content: center;
                    gap: 20px;
                    margin: 20px 0;
                }
                .nav a {
                    color: #00ffcc;
                    text-decoration: none;
                    font-size: 1.2em;
                    padding: 10px 20px;
                    transition: color 0.3s;
                }
                .nav a:hover {
                    color: #ff4444;
                }
                .content {
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 40px 20px;
                    text-align: center;
                }
                .bot-card {
                    background: rgba(26, 42, 68, 0.9);
                    padding: 30px;
                    border-radius: 15px;
                    box-shadow: 0 0 20px rgba(0, 255, 204, 0.2);
                }
                .bot-card h2 {
                    color: #00ffcc;
                    margin-bottom: 20px;
                }
                .bot-card p {
                    font-size: 1.1em;
                    margin: 10px 0;
                    color: #b0b0b0;
                }
                .bot-card img {
                    max-width: 150px;
                    border: 3px solid #00ffcc;
                    border-radius: 10px;
                }
                .footer {
                    text-align: center;
                    padding: 20px;
                    background: #1a2a44;
                    position: fixed;
                    bottom: 0;
                    width: 100%;
                    color: #b0b0b0;
                }
                @media (max-width: 600px) {
                    .nav {
                        flex-direction: column;
                        align-items: center;
                    }
                    .content {
                        padding: 20px 10px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>KagenouBotV3 Portfolio</h1>
            </div>
            <div class="nav">
                <a href="/">Home</a>
                <a href="/terms">Terms</a>
            </div>
            <div class="content">
                <div class="bot-card">
                    <h2>${botName}</h2>
                    <p>UID: ${botUID}</p>
                    <p>Status: Active</p>
                    <p>Prefix: ${global.config.Prefix[0] || '/'}</p>
                    <img src="https://via.placeholder.com/150" alt="Bot Profile" class="mt-3">
                </div>
            </div>
            <div class="footer">
                <p>© 2025 Kaizenji | All rights reserved.</p>
                <p>Time: <span id="time"></span> | Ping: N/A</p>
            </div>
            <script>
                function updateTime() {
                    const now = new Date();
                    document.getElementById('time').textContent = now.toLocaleTimeString();
                }
                setInterval(updateTime, 1000);
                updateTime();
            </script>
        </body>
        </html>
      `);
    });

    const dashboardPort = 3000;
    app.listen(dashboardPort, () => {
    });
  });
};

startBot();