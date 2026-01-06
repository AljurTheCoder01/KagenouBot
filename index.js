
  

/* @author Aljur Pogoy
 * @moderators: Kenneth Panio, Liane Cagara 
 * @admins: Aljur Pogoy, Kenneth Panio, GeoTeam.
 * @LastPatch Date: January 7, 2026. 12:01 UTC+
*/

require("tsconfig-paths").register();
require("ts-node").register();
require("./core/global");
const { MongoClient } = require("mongodb");
const fs = require("fs-extra");
const path = require("path");
const login = require("fbvibex");
const { handleAuroraCommand, loadAuroraCommands } = require("./core/aurora");
const chalk = require("chalk");
/*const chokidar = require("chokidar");*/
loadAuroraCommands();

/* @GlobalVar */
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
global.usageTracker = new Map();
global.userXP = new Map();
global.messageTracker = new Map();
global.nsfwEnabled = new Map();
/* @Notice false if you want use command to toggle maintenance mdoe. true, if no. */
global.maintenanceMode = false; 
process.once("unhandledRejection", console.error);
process.once("exit", () => {
  fs.writeFileSync(path.join(__dirname, "database", "globalData.json"), JSON.stringify([...global.globalData]));
});
global.userCooldowns = new Map();
const reloadCommands = () => {
  global.commands.clear();
  global.nonPrefixCommands.clear();
  global.eventCommands.length = 0;
  loadCommands();
};

global.threadConfigs = new Map();

/**
 * Get prefix for a specific thread
 * @param {string} threadID
 * @returns {string}
 */
global.getPrefix = function (threadID) {
  const config = global.threadConfigs.get(threadID);
  return (config && config.prefix) || global.config.Prefix[0];
};

/**
 * Set a custom prefix for a specific thread
 * @param {string} threadID 
 * @param {string} prefix 
 */
global.setPrefix = function (threadID, prefix) {
  let config = global.threadConfigs.get(threadID) || {};
  config.prefix = prefix;
  global.threadConfigs.set(threadID, config);
};


global.reloadCommands = reloadCommands;
const AuroraBetaStyler = require(path.join(__dirname, "core", "plugins", "aurora-beta-styler.js"));
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
  console.log(`[ROLE_DEBUG] Checking role for UID: ${uid}`);
  console.log(`[ROLE_DEBUG] Config Contents - Admins: ${JSON.stringify(global.config.admins)}, Moderators: ${JSON.stringify(global.config.moderators)}, Developers: ${JSON.stringify(global.config.developers)}`);
  if (!global.config || !global.config.developers || !global.config.moderators || !global.config.admins) {
    console.error(`[ROLE_DEBUG] Config is missing or incomplete! Config: ${JSON.stringify(global.config)}`);
    return 0;
  }
  const developers = global.config.developers.map(String);
  const moderators = global.config.moderators.map(String);
  const admins = global.config.admins.map(String);
global.config.vips.map(String);
  const vips = (global.config.vips || []).map(String);
  if (vips.includes(uid)) return 4;
  if (developers.includes(uid)) return 3;
  if (moderators.includes(uid)) return 2;
  if (admins.includes(uid)) return 1;
  return 0;
}

global.trackUsage = function (commandName) {
  const count = global.usageTracker.get(commandName) || 0;
  global.usageTracker.set(commandName, count + 1);
};
global.getUsageStats = function () {
  return Array.from(global.usageTracker.entries());
};

/**
 * Adds experience points (XP) to a user.
 * @param {string|number} userId 
 * @param {number} [amount=10]
 * @returns {number}
 */
global.addXP = function (userId, amount = 10) {
  const current = global.userXP.get(userId) || 0;
  const newXP = current + amount;
  global.userXP.set(userId, newXP);
  return newXP;
};

/**
 * Retrieves the current XP of a user
 * @param {string|number} userId
 * @returns {number}
 */
global.getXP = async (userID) => {
  if (global.usersData.has(userID)) return global.usersData.get(userID).xp || 0;
  if (global.db) {
    const user = await global.db.db("users").findOne({ userId: userID });
    return user?.data?.xp || 0;
  }
  return 0;
};

global.addXP = async (userID, amount) => {
  const currentXP = await global.getXP(userID);
  const newXP = currentXP + amount;
  const newLevel = Math.floor(newXP / 200);
  const user = global.usersData.get(userID) || { balance: 0, bank: 0, xp: 0, level: 0 };
  user.xp = newXP;
  user.level = newLevel;
  global.usersData.set(userID, user);
  global.userXP.set(userID, newXP);
  if (global.db) {
    await global.db.db("users").updateOne(
      { userId: userID },
      { $set: { userId: userID, data: { ...user, xp: newXP, level: newLevel } } },
      { upsert: true }
    );
    global.log.success(`Added ${amount} XP for ${userID} in MongoDB: ${newXP} XP, Level ${newLevel}`);
  }
  return newXP;
};

global.getLevel = async (userID) => {
  if (global.usersData.has(userID)) return global.usersData.get(userID).level || 0;
  if (global.db) {
    const user = await global.db.db("users").findOne({ userId: userID });
    return user?.data?.level || 0;
  }
  return 0;
};
async function initProfanityFilter() {
  try {
    const { Filter } = await import("bad-words");
    global.profanityFilter = new Filter({
      placeHolder: "*",
      emptyList: false,
      regex: /\*|\.|$/gi
    });
    global.profanityEnabled = true; /* false if no need, not my decision bruh*/
    global.log.success("Profanity filter initialized with bad-words.");
  } catch (error) {
    global.log.error("Failed to initialize bad-words: " + error.message);
  }
}
initProfanityFilter();

global.log = {
  info: (msg) => console.log(chalk.blue("[INFO]"), msg),
  warn: (msg) => console.log(chalk.yellow("[WARN]"), msg),
  error: (msg) => console.log(chalk.red("[ERROR]"), msg),
  success: (msg) => console.log(chalk.green("[SUCCESS]"), msg), 
  event: (msg) => console.log(chalk.magenta("[EVENT]"), msg)
};
async function handleReply(api, event) {
  const replyData = global.Kagenou.replies[event.messageReply?.messageID];
  if (!replyData) return;
  if (replyData.author && event.senderID !== replyData.author) {
    return api.sendMessage("Only the original sender can reply to this message.", event.threadID, event.messageID);
  }
  try {
    await replyData.callback({ ...event, event, api, attachments: event.attachments || [], data: replyData });
    console.log(`[REPLY] Processed reply for messageID: ${event.messageReply?.messageID}, command: ${replyData.callback.name || "unknown"}`);
  } catch (err) {
    console.error(`[REPLY ERROR] Failed to process reply for messageID: ${event.messageReply?.messageID}:`, err);
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
      console.error(`Error loading command '${file}':`, error);
    }
  }
    
global.log.info(`[ MAIN SYSTEM COMMANDS ]: ${global.commands.size}`);
global.log.success(`Non-Prefix Commands: ${global.nonPrefixCommands.size}`);
global.log.warn(`Event Commands: ${global.eventCommands.length}`);
global.log.info("Setup Complete!");  
};


loadCommands();
let appState;

try {
  appState = JSON.parse(fs.readFileSync("./appstate.dev.json", "utf8"));
} catch (error) {
  console.error("Error loading appstate.json:", error);
}

try {
  const configData = JSON.parse(fs.readFileSync(configFile, "utf8"));
  global.log.success("Config Loaded!");

  global.config = {
    admins: configData.admins || [],
    moderators: configData.moderators || [],
    developers: configData.developers || [],
    Prefix: Array.isArray(configData.Prefix) && configData.Prefix.length > 0 ? configData.Prefix : ["/"],
    botName: configData.botName || "Shadow Garden Bot",
    mongoUri: configData.mongoUri || null,
    ...configData,
  };

  if (global.config.DiscordMode) {
    console.log("[BOOT] DiscordMode ON → starting Discord bot only…");
    require("./Discord/index");
    process.exit(0); // instead of return
  }

} catch (error) {
  console.error("[CONFIG] Error loading config.json:", error);
  global.config = {
    admins: [],
    moderators: [],
    developers: [],
    Prefix: ["/"],
    botName: "Shadow Garden Bot",
    mongoUri: null
  };
}

let db = null;
const uri = global.config.mongoUri || null;
console.log("[DB] MongoDB URI:", uri);
if (uri) {
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  const cidkagenou = {
    db: function (collectionName) {
      return client.db("chatbot_db").collection(collectionName);
    },
  };
  async function connectDB() {
    try {
      console.log("[DB] Attempting to connect to MongoDB...");
      await client.connect();
      console.log("[DB] Connected to MongoDB successfully with URI:", uri);
      db = cidkagenou;
      global.db = db;
      const usersCollection = db.db("users");
      const allUsers = await usersCollection.find({}).toArray();
      allUsers.forEach(user => global.usersData.set(user.userId, user.data));
      console.log("[DB] Synced usersData with MongoDB users.");
    } catch (err) {
      console.error("[DB] MongoDB connection error, falling back to JSON:", err);
      db = null;
      global.db = null;
    }
  }
  connectDB();
} else {
  console.log("[DB] No mongoUri in config.json, falling back to JSON storage. Config:", global.config);
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
    let finalMessage = message;
    if (global.profanityFilter && global.profanityEnabled) {
      try {
        finalMessage = global.profanityFilter.clean(message);
        if (finalMessage !== message) {
          global.log.warn(`[PROFANITY] Bot output censored in thread ${threadID}: ${message} -> ${finalMessage}`);
        }
      } catch (error) {
        global.log.error(`Profanity filter error in sendMessage: ${error.message}`);
      }
    }
    return new Promise((resolve, reject) => {
      api.sendMessage({ body: finalMessage, attachment }, threadID, (err, info) => {
        if (err) {
          console.error("Error sending message:", err);
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
    console.error("Error in sendMessage:", error);
    throw error;
  }
};
 
const handleMessage = async (api, event) => {
  const { threadID, senderID, body, messageReply, messageID, attachments } = event;
  if (!body && !attachments) return;
  let message = body ? body.trim() : "";
  if (global.profanityFilter && global.profanityEnabled) {
    try {
      const censoredMessage = global.profanityFilter.clean(message);
      if (censoredMessage !== message) {
        global.log.warn(`[PROFANITY] User ${senderID} in thread ${threadID}: ${message} -> ${censoredMessage}`);
        const userRole = getUserRole(senderID);
        if (userRole < 2) { 
          return;
        }
        event.body = censoredMessage;
        message = censoredMessage;
      }
    } catch (error) {
      global.log.error(`Profanity filter error: ${error.message}`);
    }
  }

  const words = message.split(/ +/);
  let prefixes = [global.getPrefix(threadID)]; 
  let prefix = prefixes[0]; 

  if (messageReply && global.Kagenou.replies && global.Kagenou.replies[messageReply.messageID]) {
    return handleReply(api, event);
  }

  let commandName = words[0]?.toLowerCase() || "";
  let args = words.slice(1) || [];
  let command = null;
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

  if (isCommandAttempt && global.db) {
    try {
      const bannedUsersCollection = global.db.db("bannedUsers");
      const bannedUser = await bannedUsersCollection.findOne({ userId: senderID.toString() });
      if (bannedUser) {
        console.log(`[BAN_DEBUG] Banned user ${senderID} attempted command: ${commandName}, Reason: ${bannedUser.reason}`);
        return api.sendMessage(
          `You are banned from using bot commands.\nReason: ${bannedUser.reason}`,
          threadID,
          messageID
        );
      }
    } catch (error) {
      console.error("[DB] Error checking banned user in MongoDB:", error);
      return api.sendMessage(
        "Error checking ban status. Please try again later.",
        threadID,
        messageID
      );
    }
  }  

  if (command && command.config?.nsfw) {
    const isEnabled = global.nsfwEnabled.get(threadID) || false;
    if (!isEnabled) {
      return api.sendMessage(
        "🚫 NSFW commands are disabled in this thread. An admin can enable them using nsfw on.",
        threadID,
        messageID
      );
    }
  }

  if (command) {
  const userRole = getUserRole(senderID);
  if (global.maintenanceMode && userRole === 0) {
    const styledMaintenance = AuroraBetaStyler.styleOutput({
      headerText: 'Bot Under Maintenance',
      headerSymbol: '🔧',
      headerStyle: 'bold',
      bodyText: 'Please try gain later, bot is under maintenance .',
      bodyStyle: 'sansSerif',
      footerText: '',
    });
    return api.sendMessage(styledMaintenance, threadID, messageID);
  }
  
  const commandRole = command.config?.role ?? command.role ?? 0;
  if (userRole < commandRole) {
    console.log(`[COMMAND_DEBUG] Permission denied for UserID: ${senderID}, Command: ${commandName}`);
    const denyMsg = AuroraBetaStyler.styleOutput({
      headerText: 'Permission Denied',
      headerSymbol: '🛡️',
      headerStyle: 'bold',
      bodyText: 'Only Moderators, VIPs, or higher can use this command.',
      bodyStyle: 'sansSerif',
      footerText: '',
    });
    return api.sendMessage(denyMsg, threadID, messageID);
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
      global.trackUsage(commandName);
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
      console.error(`Failed to execute command '${commandName}':`, error);
      sendMessage(api, { threadID, message: `Error executing command '${commandName}': ${error.message}` });
    }
  } else if (isCommandAttempt) {
    sendMessage(api, { threadID, message: `Invalid Command!, Use ${global.getPrefix(threadID)}help for available commands.`, messageID });
  }
};
/**
 * @typedef {Object} UserStats
 * @property {number} messages 
 * @property {number} reactions 
 */

/**
 * @typedef {Object} ReactionInfo
 * @property {number} count 
 * @property {Set<string>} users
 * @property {Function|null} callback 
 * @property {string|null} authorID - author Checking for sender
 * @property {string} threadID 
 */

/**
 * Handles a reaction event for a message, updating user and message reaction statistics,
 * saving data to the database
 * @async
 * @param {Object} api 
 * @param {Object} event 
 * @param {string} event.messageID
 * @param {string} event.reaction 
 * @param {string} event.threadID 
 * @param {string} event.senderID
 * @returns {Promise<void>}
 */
async function handleReaction(api, event) {
  const { messageID, reaction, threadID, senderID } = event;
  const retroGradient = require("gradient-string").retro;
  console.log(retroGradient(`[DEBUG] Reaction received: ${reaction} by ${senderID} for MessageID: ${messageID}`));
  console.log(`[DEBUG] Full event: ${JSON.stringify(event, null, 2)}`);

  /** Track user reactions */
  /** @type {Map<string, UserStats>} */
  if (!global.usersData.has(senderID)) {
    global.usersData.set(senderID, { messages: 0, reactions: 0 });
  }
  const userStats = global.usersData.get(senderID);
  userStats.reactions = (userStats.reactions || 0) + 1;
  global.usersData.set(senderID, userStats);

  /** Save to DB if connected 
  * @type {global}
  *
  */
  if (global.db) {
    try {
      const usersCollection = global.db.db("users");
      await usersCollection.updateOne(
        { userId: senderID },
        { $set: { userId: senderID, data: userStats } },
        { upsert: true }
      );
      console.log(retroGradient(`[DB] Updated user ${senderID} reaction stats in MongoDB`));
    } catch (error) {
      console.error(`[DB] Error updating user ${senderID} in MongoDB:`, error);
    }
  }

  /** Track reactions per message */
  /** @type {Map<string, ReactionInfo>} */
  if (!global.reactionData.has(messageID)) {
    console.log(retroGradient(`[DEBUG] No reaction data found for MessageID: ${messageID}, initializing with defaults`));
    global.reactionData.set(messageID, { count: 0, users: new Set(), callback: null, authorID: null, threadID });
  }
  const reactionInfo = global.reactionData.get(messageID);
  reactionInfo.count = (reactionInfo.count || 0) + 1;
  reactionInfo.users = reactionInfo.users || new Set();
  reactionInfo.users.add(senderID);
  global.reactionData.set(messageID, reactionInfo);
  console.log(retroGradient(`[REACTION_STATS] Message ${messageID} has ${reactionInfo.count} total reactions (${reactionInfo.users.size} unique users)`));
  if (!reactionInfo.callback) {
    console.log(retroGradient(`[DEBUG] No callback registered for MessageID: ${messageID}`));
    return;
  }

  /** Optional author check */
  if (reactionInfo.authorID && reactionInfo.authorID !== senderID) {
    console.log(`[DEBUG] Reaction ignored, senderID ${senderID} does not match authorID ${reactionInfo.authorID} - Proceeding for testing`);
  }

  try {
    console.log(retroGradient(`[DEBUG] Handling reaction: ${reaction} for MessageID: ${messageID}`));
    await reactionInfo.callback({ api, event, reaction, threadID, messageID, senderID });
    /** Delete reaction data to match the working function's behavior */
    global.reactionData.delete(messageID);
    console.log(retroGradient(`[DEBUG] Removed reaction data for MessageID: ${messageID}`));
  } catch (error) {
    console.error(`[CALLBACK ERROR] Failed to execute callback for MessageID: ${messageID}:`, error);
    await api.sendMessage(
      `An error occurred while processing your reaction: ${error.message}`,
      threadID,
      messageID
    );
  }
}
const handleEvent = async (api, event) => {
  for (const command of global.eventCommands) {
    try {
      if (command.handleEvent) await command.handleEvent({ api, event, db: global.db });
    } catch (error) {
      console.error(`Error in event command '${command.config?.name || command.name}':`, error);
    }
  }
};

const { preventBannedResponse } = require("./commands/thread");

let currentListener;


const startListeningForMessages = (api) => {
  return api.listenMqtt(async (err, event) => {
    if (err) {
      console.error("Error listening for messages:", err);
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
            } else {
              console.error("Callback is not a function for messageID:", replyMessageID);
            }
            return;
          }
        }
      if (["message", "message_reply"].includes(event.type)) {
        event.attachments = event.attachments || [];
        await handleMessage(api, event);
        handleAuroraCommand(api, event);
      }

      /* Handle reaction events */
      if (event.type === "message_reaction") {
        await handleReaction(api, event);
      }
      if (event.type === "event" && event.logMessageType === "log:subscribe") {
        const threadID = event.threadID;
        const addedUsers = event.logMessageData.addedParticipants || [];
        console.log(`[EVENT_DEBUG] log:subscribe - Added participants: ${JSON.stringify(addedUsers)}`);
        console.log(`[EVENT_DEBUG] Bot's user ID: ${api.getCurrentUserID()}`);
        const botWasAdded = addedUsers.some(user => user.userFbId === api.getCurrentUserID());
        if (botWasAdded) {
          console.log(`[EVENT_DEBUG] Bot was added to thread ${threadID}`);
          if (global.db) {
            try {
              const threadInfo = await api.getThreadInfo(threadID);
              const threadName = threadInfo.name || `Unnamed Thread (ID: ${threadID})`;
              await global.db.db("threads").updateOne(
                { threadID },
                { $set: { threadID, name: threadName } },
                { upsert: true }
              );
              console.log(`[ThreadList] Saved thread ${threadID}: ${threadName} to MongoDB`);
            } catch (error) {
              console.error(`[ThreadList] Failed to save thread ${threadID} to MongoDB:`, error);
            }
          } else {
            console.warn("[ThreadList] Database not initialized, cannot save thread info");
          }
          if (
            !global.threadState.active.has(threadID) &&
            !global.threadState.approved.has(threadID) &&
            !global.threadState.pending.has(threadID)
          ) {
            global.threadState.pending.set(threadID, { addedAt: new Date() });
            console.log(`[EVENT_DEBUG] Added thread ${threadID} to pending state`);
            api.sendMessage(`Thank you for inviting me here! ThreadID: ${threadID}`, threadID);
            try {
              await api.changeNickname(global.config.botName, threadID, api.getCurrentUserID());
              console.log(`[EVENT_DEBUG] Nickname changed to ${global.config.botName} in thread ${threadID}`);
            } catch (error) {
              console.error(`[EVENT_DEBUG] Failed to change nickname in thread ${threadID}:`, error);
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
                console.log(`[EVENT_DEBUG] Approved thread ${targetThreadID}`);
                api.sendMessage(`Thread ${targetThreadID} has been approved.`, event.threadID);
              } else if (!global.threadState.approved.has(targetThreadID)) {
                global.threadState.approved.set(targetThreadID, { approvedAt: new Date() });
                console.log(`[EVENT_DEBUG] Directly approved thread ${targetThreadID}`);
                api.sendMessage(`Thread ${targetThreadID} has been approved.`, event.threadID);
              }
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
    const restartListener = () => {
        console.log("Scheduled listener restart...");
        if (currentListener && typeof currentListener.stopListening === 'function') {
            currentListener.stopListening()
            console.log("Stopped previous listener.");
        }
        startListeningForMessages(api);
        console.log("Started new listener.");
    };
    startListeningForMessages(api);
    console.log("Started initial listener.");
    setInterval(restartListener, 3600000); 
    console.log("Scheduled listener restart every 1 hour.");
};
const startBot = async () => {
  login({ appState }, (err, api) => {
    if (err) {
      console.error("Fatal error during Facebook login:", err);
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
    startListeningForMessages(api);
});
};

const express = require("express");
const app = express();
app.get("/", (req, res) => {
  res.send(" Bot is running on Render!");
});

/** 
* Use 3000 or 4000 to reserved render hosting site.
* @Credits: Aljur Pogoy 
*/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[SERVER] Web server running on port ${PORT}`);
});

startBot();
