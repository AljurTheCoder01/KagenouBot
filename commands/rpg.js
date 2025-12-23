const { format, UNIRedux } = require("cassidy-styler");

class RPGManager {
  constructor(db, usersData) {
    this.db = db;
    this.usersData = usersData;
  }

  async getPlayer(userId) {
    let userData = this.usersData.get(userId) || {};
    if (this.db) {
      try {
        const userDoc = await this.db.db("users").findOne({ userId });
        userData = userDoc?.data || {};
      } catch (error) {
        console.warn(`[RPGManager] DB access failed for user ${userId}: ${error.message}`);
      }
    }

    // === DEFAULT VALUES (safe initialization) ===
    if (!userData.inventory) userData.inventory = {};
    if (!userData.registered) userData.registered = false;
    if (!userData.balance) userData.balance = 0;
    if (!userData.exp) userData.exp = 0;

    // New fields used by many subcommands
    if (!userData.lastDaily) userData.lastDaily = null;
    if (!userData.lastClaim) userData.lastClaim = null;
    if (!userData.lastSpin) userData.lastSpin = null;
    if (!userData.lastWork) userData.lastWork = null;
    if (!userData.lastQuest) userData.lastQuest = null;

    // Optional: for future stamina/energy system
    if (!userData.energy) userData.energy = 100;
    if (!userData.maxEnergy) userData.maxEnergy = 100;
    if (!userData.lastEnergyRestore) userData.lastEnergyRestore = null;

    // For pet/farm/garden systems
    if (!userData.pets) userData.pets = {};
    if (!userData.farm) userData.farm = {};
    if (!userData.garden) userData.garden = {};

    // Achievement / streak tracking
    if (!userData.dailyStreak) userData.dailyStreak = 0;
    if (!userData.lastStreakDate) userData.lastStreakDate = null;

    return userData;
  }

  async registerPlayer(userId) {
    let userData = await this.getPlayer(userId);
    if (userData.registered) {
      return { success: false, error: `You are already registered!` };
    }
    userData = {
      balance: 100,
      exp: 0,
      inventory: {},
      registered: true,
      lastDaily: null,
      lastClaim: null,
      lastSpin: null,
      lastWork: null,
      energy: 100,
      maxEnergy: 100,
      dailyStreak: 0,
      pets: {},
      farm: {},
      garden: {}
    };
    this.usersData.set(userId, userData);
    if (this.db) {
      try {
        await this.db.db("users").updateOne(
          { userId },
          { $set: { userId, data: userData } },
          { upsert: true }
        );
      } catch (error) {
        console.warn(`[RPGManager] DB update failed for user ${userId}: ${error.message}`);
      }
    }
    return { success: true };
  }

  async updatePlayer(userId, updates) {
    let userData = await this.getPlayer(userId);
    userData = { ...userData, ...updates };
    this.usersData.set(userId, userData);
    if (this.db) {
      try {
        await this.db.db("users").updateOne(
          { userId },
          { $set: { userId, data: userData } },
          { upsert: true }
        );
      } catch (error) {
        console.warn(`[RPGManager] DB update failed for user ${userId}: ${error.message}`);
      }
    }
  }

  async addBalance(userId, amount) {
    let userData = await this.getPlayer(userId);
    userData.balance = (userData.balance || 0) + amount;
    await this.updatePlayer(userId, { balance: userData.balance });
    return userData.balance;
  }

  async removeBalance(userId, amount) {
    let userData = await this.getPlayer(userId);
    if ((userData.balance || 0) < amount) {
      throw new Error("Insufficient balance");
    }
    userData.balance -= amount;
    await this.updatePlayer(userId, { balance: userData.balance });
    return userData.balance;
  }

  async addExp(userId, amount) {
    let userData = await this.getPlayer(userId);
    userData.exp = (userData.exp || 0) + amount;
    await this.updatePlayer(userId, { exp: userData.exp });
    return userData.exp;
  }

  async addItem(userId, itemName, quantity = 1) {
    let userData = await this.getPlayer(userId);
    userData.inventory[itemName] = (userData.inventory[itemName] || 0) + quantity;
    if (userData.inventory[itemName] <= 0) delete userData.inventory[itemName];
    await this.updatePlayer(userId, { inventory: userData.inventory });
  }

  async removeItem(userId, itemName, quantity = 1) {
    let userData = await this.getPlayer(userId);
    if ((userData.inventory[itemName] || 0) < quantity) {
      throw new Error(`Not enough ${itemName} in inventory`);
    }
    userData.inventory[itemName] -= quantity;
    if (userData.inventory[itemName] <= 0) delete userData.inventory[itemName];
    await this.updatePlayer(userId, { inventory: userData.inventory });
  }

  async transferBalance(fromUserId, toUserId, amount) {
    let fromData = await this.getPlayer(fromUserId);
    let toData = await this.getPlayer(toUserId);
    if ((fromData.balance || 0) < amount) {
      throw new Error("Insufficient balance");
    }
    fromData.balance -= amount;
    toData.balance = (toData.balance || 0) + amount;
    await this.updatePlayer(fromUserId, { balance: fromData.balance });
    await this.updatePlayer(toUserId, { balance: toData.balance });
    return { fromBalance: fromData.balance, toBalance: toData.balance };
  }

  async getLeaderboard(limit = 10) {
    let leaderboard = [];
    if (this.db) {
      try {
        leaderboard = await this.db.db("users")
          .find({ "data.registered": true })
          .sort({ "data.balance": -1 })
          .limit(limit)
          .toArray();
        leaderboard = leaderboard.map(doc => ({
          userId: doc.userId,
          balance: doc.data.balance || 0,
          exp: doc.data.exp || 0
        }));
      } catch (error) {
        console.warn(`[RPGManager] Leaderboard fetch failed: ${error.message}`);
      }
    }

    if (leaderboard.length === 0) {
      leaderboard = Array.from(this.usersData.entries())
        .filter(([_, data]) => data.registered)
        .map(([userId, data]) => ({
          userId,
          balance: data.balance || 0,
          exp: data.exp || 0
        }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, limit);
    }

    return leaderboard;
  }
}
module.exports = {
  name: "rpg",
  description: "Manage your RPG character with #rpg <subcommand>",
  usage: "#rpg register",
  async run({ api, event, args, db, usersData }) {
    const { threadID, messageID, senderID } = event;

    if (!usersData) {
      console.error("[RPG] usersData is undefined");
      return api.sendMessage(
        format({
          title: "RPG",
          titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
          titleFont: "double_struck",
          emojis: "🏹",
          content: `Internal error: Data cache not initialized. Contact bot admin.`
        }),
        threadID,
        messageID
      );
    }

    const rpgManager = new RPGManager(db, usersData);
    const subcommand = args[0]?.toLowerCase();
    const player = await rpgManager.getPlayer(senderID);

    if (subcommand !== "register" && !player.registered) {
      return api.sendMessage(
        format({
          title: "RPG",
          titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
          titleFont: "double_struck",
          emojis: "🏹",
          content: `You're not registered!\nUse #rpg register`
        }),
        threadID,
        messageID
      );
    }

    switch (subcommand) {
      case "register":
        const result = await rpgManager.registerPlayer(senderID);
        if (!result.success) {
          return api.sendMessage(
            format({
              title: "RPG",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🏹",
              content: `${result.error}`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "RPG",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏹",
            content: `Registered! Start with #rpg battle or #rpg shop`
          }),
          threadID,
          messageID
        );

      case "stats":
        return api.sendMessage(
          format({
            title: "Stats",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📊",
            content: `Level: ${Math.floor(player.exp / 100) || 1}\nExperience: ${player.exp} XP\nBalance: $${player.balance.toLocaleString()}`
          }),
          threadID,
          messageID
        );

      case "earn":
        const earnAmount = Math.floor(Math.random() * 50) + 10;
        await rpgManager.addBalance(senderID, earnAmount);
        return api.sendMessage(
          format({
            title: "Earn",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💰",
            content: `You earned $${earnAmount.toLocaleString()}! New balance: $${((player.balance || 0) + earnAmount).toLocaleString()}`
          }),
          threadID,
          messageID
        );

      case "level":
        const level = Math.floor(player.exp / 100) || 1;
        const requiredExp = level * 100;
        return api.sendMessage(
          format({
            title: "Level",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📈",
            content: `Level: ${level}\nExperience: ${player.exp} XP\nRequired for next level: ${requiredExp - player.exp} XP`
          }),
          threadID,
          messageID
        );

      case "battle":
        const enemies = [
          { name: "Goblin", health: 50, strength: 10, exp: Math.floor(Math.random() * 20) + 20, loot: "Health Potion" },
          { name: "Wolf", health: 70, strength: 15, exp: Math.floor(Math.random() * 30) + 30, loot: "Wolf Pelt" },
          { name: "Troll", health: 100, strength: 20, exp: Math.floor(Math.random() * 40) + 40, loot: "Troll Club" }
        ];
        const enemy = enemies[Math.floor(Math.random() * enemies.length)];
        const playerStrength = (Math.floor(player.exp / 100) || 1) * 10;
        const battleChance = Math.random() * (playerStrength / (playerStrength + enemy.strength));
        if (battleChance > 0.3) {
          player.inventory[enemy.loot] = (player.inventory[enemy.loot] || 0) + 1;
          await rpgManager.updatePlayer(senderID, {
            exp: (player.exp || 0) + enemy.exp,
            inventory: player.inventory
          });
          return api.sendMessage(
            format({
              title: "Battle",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🗡️",
              content: `You defeated a ${enemy.name}! Gained ${enemy.exp} XP and ${enemy.loot} x1. New XP: ${(player.exp || 0) + enemy.exp}`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Battle",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🛡️",
            content: `You were defeated by a ${enemy.name}! Try again later.`
          }),
          threadID,
          messageID
        );

      case "inventory":
        return api.sendMessage(
          format({
            title: "Inventory",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎒",
            content: Object.keys(player.inventory).length > 0
              ? `Items: ${Object.entries(player.inventory).map(([item, qty]) => `${item}: ${qty}`).join(", ")}`
              : "Your inventory is empty!"
          }),
          threadID,
          messageID
        );

      case "shop":
        return api.sendMessage(
          format({
            title: "Shop",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏪",
            content: `Available items:\n- Sword ($200)\n- Shield ($150)\n- Health Potion ($50)\nUse: #rpg buy <item>`
          }),
          threadID,
          messageID
        );

      case "buy":
        const item = args[1]?.toLowerCase();
        const items = { sword: 200, shield: 150, "health potion": 50 };
        if (!item || !items[item]) {
          return api.sendMessage(
            format({
              title: "Buy",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Invalid item! Available: ${Object.keys(items).join(", ")}`
            }),
            threadID,
            messageID
          );
        }
        if (player.balance < items[item]) {
          return api.sendMessage(
            format({
              title: "Buy",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `You need $${items[item]} to buy ${item}!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory[item] = (player.inventory[item] || 0) + 1;
        await rpgManager.removeBalance(senderID, items[item]);
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Buy",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "✅",
            content: `You bought a ${item} for $${items[item]}!`
          }),
          threadID,
          messageID
        );
         case "quest":
        const questReward = Math.floor(Math.random() * 100) + 50;
        await rpgManager.updatePlayer(senderID, {
          balance: (player.balance || 0) + questReward,
          exp: (player.exp || 0) + 20
        });
        return api.sendMessage(
          format({
            title: "Quest",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📜",
            content: `You completed a quest! Earned $${questReward} and 20 XP.`
          }),
          threadID,
          messageID
        );

      case "train":
        const trainExp = Math.floor(Math.random() * 15) + 10;
        await rpgManager.updatePlayer(senderID, {
          exp: (player.exp || 0) + trainExp
        });
        return api.sendMessage(
          format({
            title: "Train",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💪",
            content: `You trained and gained ${trainExp} XP! New XP: ${(player.exp || 0) + trainExp}`
          }),
          threadID,
          messageID
        );

      case "heal":
        if (!player.inventory["health potion"]) {
          return api.sendMessage(
            format({
              title: "Heal",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `You need a Health Potion to heal!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["health potion"] -= 1;
        if (player.inventory["health potion"] === 0) {
          delete player.inventory["health potion"];
        }
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Heal",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🩺",
            content: `You used a Health Potion to heal!`
          }),
          threadID,
          messageID
        );

      case "upgrade":
        const upgradeCost = (Math.floor(player.exp / 100) || 1) * 50;
        if (player.balance < upgradeCost) {
          return api.sendMessage(
            format({
              title: "Upgrade",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `You need $${upgradeCost} to upgrade!`
            }),
            threadID,
            messageID
          );
        }
        await rpgManager.removeBalance(senderID, upgradeCost);
        await rpgManager.updatePlayer(senderID, {
          exp: (player.exp || 0) + 50
        });
        return api.sendMessage(
          format({
            title: "Upgrade",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📈",
            content: `You upgraded your skills for $${upgradeCost}! Gained 50 XP.`
          }),
          threadID,
          messageID
        );

      case "gift":
        const giftAmount = parseInt(args[1]);
        const targetID = args[2];
        if (!giftAmount || giftAmount <= 0 || !targetID) {
          return api.sendMessage(
            format({
              title: "Gift",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Usage: #rpg gift <amount> <userID>`
            }),
            threadID,
            messageID
          );
        }
        if (player.balance < giftAmount) {
          return api.sendMessage(
            format({
              title: "Gift",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `You need $${giftAmount} to gift!`
            }),
            threadID,
            messageID
          );
        }
        await rpgManager.transferBalance(senderID, targetID, giftAmount);
        return api.sendMessage(
          format({
            title: "Gift",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎁",
            content: `You gifted $${giftAmount} to user ${targetID}!`
          }),
          threadID,
          messageID
        );

      case "leaderboard":
        const leaderboard = await rpgManager.getLeaderboard(5);
        return api.sendMessage(
          format({
            title: "Leaderboard",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏆",
            content: leaderboard.length > 0
              ? leaderboard.map((entry, i) => `${i + 1}. User ${entry.userId}: $${entry.balance.toLocaleString()}`).join("\n")
              : "No players on the leaderboard!"
          }),
          threadID,
          messageID
        );

      case "reset":
        await rpgManager.updatePlayer(senderID, { balance: 0, exp: 0, inventory: {}, registered: true });
        return api.sendMessage(
          format({
            title: "Reset",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔄",
            content: `Your stats have been reset!`
          }),
          threadID,
          messageID
        );

      case "trade":
        const tradeItem = args[1]?.toLowerCase();
        const tradeQuantity = parseInt(args[2]) || 1;
        const tradeTargetID = args[3];
        if (!tradeItem || !player.inventory[tradeItem] || tradeQuantity <= 0 || !tradeTargetID) {
          return api.sendMessage(
            format({
              title: "Trade",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Usage: #rpg trade <item> <quantity> <userID>`
            }),
            threadID,
            messageID
          );
        }
        if (player.inventory[tradeItem] < tradeQuantity) {
          return api.sendMessage(
            format({
              title: "Trade",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `You don't have enough ${tradeItem}!`
            }),
            threadID,
            messageID
          );
        }
        const targetData = await rpgManager.getPlayer(tradeTargetID);
        if (!targetData.registered) {
          return api.sendMessage(
            format({
              title: "Trade",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Target user is not registered!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory[tradeItem] -= tradeQuantity;
        if (player.inventory[tradeItem] === 0) {
          delete player.inventory[tradeItem];
        }
        targetData.inventory[tradeItem] = (targetData.inventory[tradeItem] || 0) + tradeQuantity;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        await rpgManager.updatePlayer(tradeTargetID, { inventory: targetData.inventory });
        return api.sendMessage(
          format({
            title: "Trade",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🤝",
            content: `You traded ${tradeItem} x${tradeQuantity} to user ${tradeTargetID}!`
          }),
          threadID,
          messageID
        );

      // New Subcommands (50 additional)
      case "explore":
        const exploreExp = Math.floor(Math.random() * 30) + 10;
        const lootChance = Math.random();
        let exploreContent = `You explored and gained ${exploreExp} XP! New XP: ${(player.exp || 0) + exploreExp}`;
        if (lootChance > 0.4) {
          const loot = ["Gold Coin", "Gem"][Math.floor(Math.random() * 2)];
          player.inventory[loot] = (player.inventory[loot] || 0) + 1;
          exploreContent += `\nFound ${loot} x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + exploreExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "Explore",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🗺️",
            content: exploreContent
          }),
          threadID,
          messageID
        );

      case "fish":
        const fishExp = 15;
        const fishLootChance = Math.random();
        let fishContent = `You fished and gained ${fishExp} XP! New XP: ${(player.exp || 0) + fishExp}`;
        if (fishLootChance > 0.6) {
          player.inventory["Fish"] = (player.inventory["Fish"] || 0) + 1;
          fishContent += `\nCaught a Fish x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + fishExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "Fish",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎣",
            content: fishContent
          }),
          threadID,
          messageID
        );

      case "mine":
        const mineExp = 20;
        const mineLootChance = Math.random();
        let mineContent = `You mined and gained ${mineExp} XP! New XP: ${(player.exp || 0) + mineExp}`;
        if (mineLootChance > 0.5) {
          player.inventory["Ore"] = (player.inventory["Ore"] || 0) + 1;
          mineContent += `\nMined an Ore x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + mineExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "Mine",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "⛏️",
            content: mineContent
          }),
          threadID,
          messageID
        );
       case "craft":
        const recipes = { "Iron Sword": { materials: { "Ore": 2 }, cost: 50 } };
        const craftItem = args[1]?.toLowerCase();
        if (!craftItem || !recipes[craftItem]) {
          return api.sendMessage(
            format({
              title: "Craft",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🔨",
              content: `Available: ${Object.keys(recipes).join(", ")}\nUse: #rpg craft <item>`
            }),
            threadID,
            messageID
          );
        }
        if (player.inventory[recipes[craftItem].materials["Ore"]] < 2 || player.balance < recipes[craftItem].cost) {
          return api.sendMessage(
            format({
              title: "Craft",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 2 Ore and $${recipes[craftItem].cost}!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Ore"] -= 2;
        player.inventory[craftItem] = (player.inventory[craftItem] || 0) + 1;
        await rpgManager.removeBalance(senderID, recipes[craftItem].cost);
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Craft",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "✅",
            content: `Crafted ${craftItem}!`
          }),
          threadID,
          messageID
        );

      case "sell":
        const sellItem = args[1]?.toLowerCase();
        if (!sellItem || !player.inventory[sellItem]) {
          return api.sendMessage(
            format({
              title: "Sell",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "💸",
              content: `Use: #rpg sell <item>`
            }),
            threadID,
            messageID
          );
        }
        const sellValue = Math.floor({ "sword": 150, "shield": 100, "health potion": 30, "fish": 10, "ore": 20, "gold coin": 50, "gem": 75 }[sellItem] * 0.8) || 5;
        player.inventory[sellItem] -= 1;
        if (player.inventory[sellItem] === 0) delete player.inventory[sellItem];
        await rpgManager.addBalance(senderID, sellValue);
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Sell",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💰",
            content: `Sold ${sellItem} for $${sellValue}!`
          }),
          threadID,
          messageID
        );

      case "pet":
        const petType = args[1]?.toLowerCase();
        const petCosts = { dog: 50, cat: 30, dragon: 200 };
        if (!petType || !petCosts[petType]) {
          return api.sendMessage(
            format({
              title: "Pet",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🐾",
              content: `Available: ${Object.keys(petCosts).join(", ")}\nUse: #rpg pet <type>`
            }),
            threadID,
            messageID
          );
        }
        if (player.balance < petCosts[petType]) {
          return api.sendMessage(
            format({
              title: "Pet",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need $${petCosts[petType]}!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory[`${petType} Pet`] = (player.inventory[`${petType} Pet`] || 0) + 1;
        await rpgManager.removeBalance(senderID, petCosts[petType]);
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Pet",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "✅",
            content: `Bought a ${petType} Pet for $${petCosts[petType]}!`
          }),
          threadID,
          messageID
        );

      case "feed":
        if (!player.inventory["Fish"] && !player.inventory["Ore"]) {
          return api.sendMessage(
            format({
              title: "Feed",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need Fish or Ore to feed your pet!`
            }),
            threadID,
            messageID
          );
        }
        const feedItem = player.inventory["Fish"] ? "Fish" : "Ore";
        player.inventory[feedItem] -= 1;
        if (player.inventory[feedItem] === 0) delete player.inventory[feedItem];
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Feed",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🍖",
            content: `Fed your pet with ${feedItem}!`
          }),
          threadID,
          messageID
        );

      case "guild":
        if (!args[1]) {
          return api.sendMessage(
            format({
              title: "Guild",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🏰",
              content: `Join a guild: #rpg guild <name>`
            }),
            threadID,
            messageID
          );
        }
        player.guild = args.slice(1).join(" ");
        await rpgManager.updatePlayer(senderID, { guild: player.guild });
        return api.sendMessage(
          format({
            title: "Guild",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "✅",
            content: `Joined guild: ${player.guild}`
          }),
          threadID,
          messageID
        );

      case "arena":
        const opponentID = args[1];
        if (!opponentID) {
          return api.sendMessage(
            format({
              title: "Arena",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "⚔️",
              content: `Challenge: #rpg arena <userID>`
            }),
            threadID,
            messageID
          );
        }
        const opponent = await rpgManager.getPlayer(opponentID);
        if (!opponent.registered) {
          return api.sendMessage(
            format({
              title: "Arena",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Opponent not registered!`
            }),
            threadID,
            messageID
          );
        }
        const arenaChance = Math.random();
        if (arenaChance > 0.5) {
          const arenaReward = Math.floor(Math.random() * 100) + 50;
          await rpgManager.addBalance(senderID, arenaReward);
          return api.sendMessage(
            format({
              title: "Arena",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🏆",
              content: `Won against ${opponentID}! Earned $${arenaReward}.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Arena",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Lost to ${opponentID}!`
          }),
          threadID,
          messageID
        );

      case "tournament":
        const tourReward = Math.floor(Math.random() * 200) + 100;
        await rpgManager.addBalance(senderID, tourReward);
        return api.sendMessage(
          format({
            title: "Tournament",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏟️",
            content: `Won tournament! Earned $${tourReward}.`
          }),
          threadID,
          messageID
        );

      case "rest":
        const restExp = Math.floor(Math.random() * 10) + 5;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + restExp });
        return api.sendMessage(
          format({
            title: "Rest",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "😴",
            content: `Rested and gained ${restExp} XP!`
          }),
          threadID,
          messageID
        );

      case "journey":
        const journeyExp = Math.floor(Math.random() * 50) + 25;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + journeyExp });
        return api.sendMessage(
          format({
            title: "Journey",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌍",
            content: `Completed journey! Gained ${journeyExp} XP.`
          }),
          threadID,
          messageID
        );

      case "hunt":
        const huntExp = Math.floor(Math.random() * 40) + 15;
        const huntLootChance = Math.random();
        let huntContent = `You hunted and gained ${huntExp} XP! New XP: ${(player.exp || 0) + huntExp}`;
        if (huntLootChance > 0.5) {
          player.inventory["Deer Hide"] = (player.inventory["Deer Hide"] || 0) + 1;
          huntContent += `\nFound Deer Hide x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + huntExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "Hunt",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏹",
            content: huntContent
          }),
          threadID,
          messageID
        );

      case "forge":
        if (player.inventory["Ore"] < 3) {
          return api.sendMessage(
            format({
              title: "Forge",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 3 Ore to forge!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Ore"] -= 3;
        player.inventory["Steel Blade"] = (player.inventory["Steel Blade"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Forge",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔥",
            content: `Forged a Steel Blade!`
          }),
          threadID,
          messageID
        );

      case "alchemy":
        if (player.inventory["Gem"] < 1 || player.inventory["Health Potion"] < 2) {
          return api.sendMessage(
            format({
              title: "Alchemy",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Gem and 2 Health Potions!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Gem"] -= 1;
        player.inventory["Health Potion"] -= 2;
        player.inventory["Elixir"] = (player.inventory["Elixir"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Alchemy",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "⚗️",
            content: `Crafted an Elixir!`
          }),
          threadID,
          messageID
        );

      case "tame":
        if (player.inventory["Deer Hide"] < 1) {
          return api.sendMessage(
            format({
              title: "Tame",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Deer Hide to tame!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Deer Hide"] -= 1;
        player.inventory["Tamed Deer"] = (player.inventory["Tamed Deer"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Tame",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🐴",
            content: `Tamed a Deer!`
          }),
          threadID,
          messageID
        );
case "ride":
        if (!player.inventory["Tamed Deer"] && !player.inventory["dragon Pet"]) {
          return api.sendMessage(
            format({
              title: "Ride",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need a Tamed Deer or Dragon Pet!`
            }),
            threadID,
            messageID
          );
        }
        const rideExp = 30;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + rideExp });
        return api.sendMessage(
          format({
            title: "Ride",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏇",
            content: `Rode your mount! Gained ${rideExp} XP.`
          }),
          threadID,
          messageID
        );

      case "camp":
        const campExp = 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + campExp });
        return api.sendMessage(
          format({
            title: "Camp",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "⛺",
            content: `Camped and gained ${campExp} XP!`
          }),
          threadID,
          messageID
        );

      case "scout":
        const scoutExp = Math.floor(Math.random() * 25) + 10;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + scoutExp });
        return api.sendMessage(
          format({
            title: "Scout",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔭",
            content: `Scouted the area! Gained ${scoutExp} XP.`
          }),
          threadID,
          messageID
        );

      case "gather":
        const gatherExp = 10;
        player.inventory["Herb"] = (player.inventory["Herb"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + gatherExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Gather",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌿",
            content: `Gathered Herbs! Gained ${gatherExp} XP.`
          }),
          threadID,
          messageID
        );

      case "build":
        if (player.inventory["Wood"] < 5) {
          return api.sendMessage(
            format({
              title: "Build",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 5 Wood to build!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Wood"] -= 5;
        player.inventory["House"] = (player.inventory["House"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Build",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏠",
            content: `Built a House!`
          }),
          threadID,
          messageID
        );

      case "tradeup":
        if (player.inventory["Gold Coin"] < 10) {
          return api.sendMessage(
            format({
              title: "TradeUp",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 10 Gold Coins!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Gold Coin"] -= 10;
        player.inventory["Ruby"] = (player.inventory["Ruby"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "TradeUp",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💎",
            content: `Traded for a Ruby!`
          }),
          threadID,
          messageID
        );

      case "enchant":
        if (player.inventory["Elixir"] < 1 || player.inventory["Sword"] < 1) {
          return api.sendMessage(
            format({
              title: "Enchant",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Elixir and 1 Sword!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Elixir"] -= 1;
        player.inventory["Sword"] -= 1;
        player.inventory["Enchanted Sword"] = (player.inventory["Enchanted Sword"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Enchant",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "✨",
            content: `Enchanted a Sword!`
          }),
          threadID,
          messageID
        );

      case "questlist":
        return api.sendMessage(
          format({
            title: "QuestList",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📜",
            content: `Quests: Hunt, Gather, Explore\nUse: #rpg quest`
          }),
          threadID,
          messageID
        );

      case "profile":
        return api.sendMessage(
          format({
            title: "Profile",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "👤",
            content: `Level: ${Math.floor(player.exp / 100) || 1}\nBalance: $${player.balance.toLocaleString()}\nGuild: ${player.guild || "None"}`
          }),
          threadID,
          messageID
        );

      case "event":
        const eventReward = Math.floor(Math.random() * 150) + 50;
        await rpgManager.addBalance(senderID, eventReward);
        return api.sendMessage(
          format({
            title: "Event",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎉",
            content: `Won event! Earned $${eventReward}.`
          }),
          threadID,
          messageID
        );

      case "duel":
        const duelOpponent = args[1];
        if (!duelOpponent) {
          return api.sendMessage(
            format({
              title: "Duel",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "⚔️",
              content: `Duel: #rpg duel <userID>`
            }),
            threadID,
            messageID
          );
        }
        const duelChance = Math.random();
        if (duelChance > 0.5) {
          const duelReward = 75;
          await rpgManager.addBalance(senderID, duelReward);
          return api.sendMessage(
            format({
              title: "Duel",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🏆",
              content: `Won duel vs ${duelOpponent}! Earned $${duelReward}.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Duel",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Lost duel vs ${duelOpponent}!`
          }),
          threadID,
          messageID
        );

      case "bounty":
        const bountyReward = Math.floor(Math.random() * 300) + 100;
        await rpgManager.addBalance(senderID, bountyReward);
        return api.sendMessage(
          format({
            title: "Bounty",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔫",
            content: `Completed bounty! Earned $${bountyReward}.`
          }),
          threadID,
          messageID
        );

      case "steal":
        const stealTarget = args[1];
        if (!stealTarget) {
          return api.sendMessage(
            format({
              title: "Steal",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Steal: #rpg steal <userID>`
            }),
            threadID,
            messageID
          );
        }
        const stealChance = Math.random();
        if (stealChance > 0.7) {
          const stealAmount = Math.floor(Math.random() * 50) + 10;
          await rpgManager.transferBalance(stealTarget, senderID, stealAmount);
          return api.sendMessage(
            format({
              title: "Steal",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "💰",
              content: `Stole $${stealAmount} from ${stealTarget}!`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Steal",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🚨",
            content: `Failed to steal from ${stealTarget}!`
          }),
          threadID,
          messageID
        );

      case "raid":
        const raidReward = Math.floor(Math.random() * 400) + 200;
        await rpgManager.addBalance(senderID, raidReward);
        return api.sendMessage(
          format({
            title: "Raid",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💣",
            content: `Raided successfully! Earned $${raidReward}.`
          }),
          threadID,
          messageID
        );

      case "defend":
        const defendExp = 25;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + defendExp });
        return api.sendMessage(
          format({
            title: "Defend",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🛡️",
            content: `Defended your base! Gained ${defendExp} XP.`
          }),
          threadID,
          messageID
        );

      case "repair":
        if (player.inventory["Ore"] < 2) {
          return api.sendMessage(
            format({
              title: "Repair",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 2 Ore to repair!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Ore"] -= 2;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Repair",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔧",
            content: `Repaired your gear!`
          }),
          threadID,
          messageID
        );

      case "upgradeweapon":
        if (player.inventory["Steel Blade"] < 1) {
          return api.sendMessage(
            format({
              title: "UpgradeWeapon",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Steel Blade!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Steel Blade"] -= 1;
        player.inventory["Upgraded Blade"] = (player.inventory["Upgraded Blade"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "UpgradeWeapon",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "⚔️",
            content: `Upgraded to Upgraded Blade!`
          }),
          threadID,
          messageID
        );

      case "summon":
        if (player.inventory["Ruby"] < 1) {
          return api.sendMessage(
            format({
              title: "Summon",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Ruby to summon!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Ruby"] -= 1;
        player.inventory["Summoned Spirit"] = (player.inventory["Summoned Spirit"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Summon",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "👻",
            content: `Summoned a Spirit!`
          }),
          threadID,
          messageID
        );
case "harvest":
        const harvestExp = 12;
        player.inventory["Wheat"] = (player.inventory["Wheat"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + harvestExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Harvest",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌾",
            content: `Harvested Wheat! Gained ${harvestExp} XP.`
          }),
          threadID,
          messageID
        );

      case "cook":
        if (player.inventory["Wheat"] < 2 || player.inventory["Fish"] < 1) {
          return api.sendMessage(
            format({
              title: "Cook",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 2 Wheat and 1 Fish!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Wheat"] -= 2;
        player.inventory["Fish"] -= 1;
        player.inventory["Cooked Meal"] = (player.inventory["Cooked Meal"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Cook",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🍲",
            content: `Cooked a Meal!`
          }),
          threadID,
          messageID
        );

      case "tradeall":
        const tradeAllTarget = args[1];
        if (!tradeAllTarget) {
          return api.sendMessage(
            format({
              title: "TradeAll",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Trade all: #rpg tradeall <userID>`
            }),
            threadID,
            messageID
          );
        }
        const targetAllData = await rpgManager.getPlayer(tradeAllTarget);
        if (!targetAllData.registered) {
          return api.sendMessage(
            format({
              title: "TradeAll",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Target not registered!`
            }),
            threadID,
            messageID
          );
        }
        for (let item in player.inventory) {
          targetAllData.inventory[item] = (targetAllData.inventory[item] || 0) + player.inventory[item];
          delete player.inventory[item];
        }
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        await rpgManager.updatePlayer(tradeAllTarget, { inventory: targetAllData.inventory });
        return api.sendMessage(
          format({
            title: "TradeAll",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🤝",
            content: `Traded all items to ${tradeAllTarget}!`
          }),
          threadID,
          messageID
        );

      case "auction":
        if (Object.keys(player.inventory).length === 0) {
          return api.sendMessage(
            format({
              title: "Auction",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `No items to auction!`
            }),
            threadID,
            messageID
          );
        }
        const auctionItem = Object.keys(player.inventory)[0];
        const auctionValue = Math.floor({ "sword": 150, "shield": 100, "health potion": 30, "fish": 10, "ore": 20, "gold coin": 50, "gem": 75 }[auctionItem] * 1.2) || 5;
        delete player.inventory[auctionItem];
        await rpgManager.addBalance(senderID, auctionValue);
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Auction",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📢",
            content: `Auctioned ${auctionItem} for $${auctionValue}!`
          }),
          threadID,
          messageID
        );

      case "meditate":
        const meditateExp = Math.floor(Math.random() * 20) + 10;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + meditateExp });
        return api.sendMessage(
          format({
            title: "Meditate",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🧘",
            content: `Meditated! Gained ${meditateExp} XP.`
          }),
          threadID,
          messageID
        );

      case "bargain":
        const bargainTarget = args[1];
        if (!bargainTarget) {
          return api.sendMessage(
            format({
              title: "Bargain",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Bargain: #rpg bargain <userID>`
            }),
            threadID,
            messageID
          );
        }
        const bargainChance = Math.random();
        if (bargainChance > 0.6) {
          const bargainAmount = Math.floor(Math.random() * 30) + 10;
          await rpgManager.transferBalance(bargainTarget, senderID, bargainAmount);
          return api.sendMessage(
            format({
              title: "Bargain",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "💬",
              content: `Bargained $${bargainAmount} from ${bargainTarget}!`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Bargain",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "❌",
            content: `Failed to bargain with ${bargainTarget}!`
          }),
          threadID,
          messageID
        );

      case "sacrifice":
        if (player.inventory["Gem"] < 3) {
          return api.sendMessage(
            format({
              title: "Sacrifice",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 3 Gems to sacrifice!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Gem"] -= 3;
        const sacrificeExp = 100;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + sacrificeExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Sacrifice",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🙏",
            content: `Sacrificed 3 Gems! Gained ${sacrificeExp} XP.`
          }),
          threadID,
          messageID
        );

      case "exploredeep":
        const deepExp = Math.floor(Math.random() * 50) + 25;
        const deepLootChance = Math.random();
        let deepContent = `Explored deep! Gained ${deepExp} XP. New XP: ${(player.exp || 0) + deepExp}`;
        if (deepLootChance > 0.3) {
          player.inventory["Rare Crystal"] = (player.inventory["Rare Crystal"] || 0) + 1;
          deepContent += `\nFound Rare Crystal x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + deepExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "ExploreDeep",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌌",
            content: deepContent
          }),
          threadID,
          messageID
        );

      case "trainhard":
        const hardExp = Math.floor(Math.random() * 30) + 20;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + hardExp });
        return api.sendMessage(
          format({
            title: "TrainHard",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💪",
            content: `Trained hard! Gained ${hardExp} XP.`
          }),
          threadID,
          messageID
        );

      case "questelite":
        const eliteReward = Math.floor(Math.random() * 250) + 100;
        await rpgManager.addBalance(senderID, eliteReward);
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 50 });
        return api.sendMessage(
          format({
            title: "QuestElite",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌟",
            content: `Completed elite quest! Earned $${eliteReward} and 50 XP.`
          }),
          threadID,
          messageID
        );

      case "guildwar":
        const warReward = Math.floor(Math.random() * 300) + 150;
        await rpgManager.addBalance(senderID, warReward);
        return api.sendMessage(
          format({
            title: "GuildWar",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "⚔️",
            content: `Won guild war! Earned $${warReward}.`
          }),
          threadID,
          messageID
        );

      case "collect":
        const collectExp = 15;
        player.inventory["Coin"] = (player.inventory["Coin"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + collectExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Collect",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💰",
            content: `Collected a Coin! Gained ${collectExp} XP.`
          }),
          threadID,
          messageID
        );

      case "barter":
        const barterItem = args[1]?.toLowerCase();
        if (!barterItem || !player.inventory[barterItem]) {
          return api.sendMessage(
            format({
              title: "Barter",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Barter: #rpg barter <item>`
            }),
            threadID,
            messageID
          );
        }
        const barterValue = Math.floor({ "sword": 150, "shield": 100, "health potion": 30 }[barterItem] * 0.9) || 5;
        player.inventory[barterItem] -= 1;
        if (player.inventory[barterItem] === 0) delete player.inventory[barterItem];
        await rpgManager.addBalance(senderID, barterValue);
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Barter",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🤝",
            content: `Bartered ${barterItem} for $${barterValue}!`
          }),
          threadID,
          messageID
        );

      case "questdaily":
        const dailyReward = Math.floor(Math.random() * 100) + 40;
        await rpgManager.addBalance(senderID, dailyReward);
        return api.sendMessage(
          format({
            title: "QuestDaily",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📅",
            content: `Completed daily quest! Earned $${dailyReward}.`
          }),
          threadID,
          messageID
        );

      case "adventure":
        const adventureExp = Math.floor(Math.random() * 60) + 30;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + adventureExp });
        return api.sendMessage(
          format({
            title: "Adventure",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌄",
            content: `Went on adventure! Gained ${adventureExp} XP.`
          }),
          threadID,
          messageID
        );

      case "treasure":
        const treasureChance = Math.random();
        let treasureContent = `Searched for treasure!`;
        if (treasureChance > 0.4) {
          const treasureReward = Math.floor(Math.random() * 200) + 100;
          await rpgManager.addBalance(senderID, treasureReward);
          treasureContent += `\nFound $${treasureReward}!`;
        }
        return api.sendMessage(
          format({
            title: "Treasure",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏴‍☠️",
            content: treasureContent
          }),
          threadID,
          messageID
        );

      case "bless":
        if (player.inventory["Elixir"] < 1) {
          return api.sendMessage(
            format({
              title: "Bless",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Elixir to bless!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Elixir"] -= 1;
        const blessExp = 40;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + blessExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Bless",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🙌",
            content: `Blessed yourself! Gained ${blessExp} XP.`
          }),
          threadID,
          messageID
        );
      case "challenge":
        const challengeReward = Math.floor(Math.random() * 150) + 75;
        await rpgManager.addBalance(senderID, challengeReward);
        return api.sendMessage(
          format({
            title: "Challenge",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎯",
            content: `Completed challenge! Earned $${challengeReward}.`
          }),
          threadID,
          messageID
        );

      case "guard":
        const guardExp = 20;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + guardExp });
        return api.sendMessage(
          format({
            title: "Guard",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🛡️",
            content: `Guarded the village! Gained ${guardExp} XP.`
          }),
          threadID,
          messageID
        );

      case "explorecave":
        const caveExp = Math.floor(Math.random() * 40) + 20;
        const caveLootChance = Math.random();
        let caveContent = `Explored cave! Gained ${caveExp} XP. New XP: ${(player.exp || 0) + caveExp}`;
        if (caveLootChance > 0.35) {
          player.inventory["Cave Gem"] = (player.inventory["Cave Gem"] || 0) + 1;
          caveContent += `\nFound Cave Gem x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + caveExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "ExploreCave",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🕳️",
            content: caveContent
          }),
          threadID,
          messageID
        );

        case "farm":
        const farmExp = 10;
        player.inventory["Wheat"] = (player.inventory["Wheat"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + farmExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Farm",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌾",
            content: `Farmed Wheat! Gained ${farmExp} XP.`
          }),
          threadID,
          messageID
        );

      case "brew":
        if (player.inventory["Herb"] < 2) {
          return api.sendMessage(
            format({
              title: "Brew",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 2 Herbs!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Herb"] -= 2;
        player.inventory["Potion"] = (player.inventory["Potion"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Brew",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🍵",
            content: `Brewed a Potion!`
          }),
          threadID,
          messageID
        );

      case "excavate":
        const excavateExp = Math.floor(Math.random() * 35) + 15;
        const excavateLootChance = Math.random();
        let excavateContent = `Excavated! Gained ${excavateExp} XP.`;
        if (excavateLootChance > 0.4) {
          player.inventory["Ancient Artifact"] = (player.inventory["Ancient Artifact"] || 0) + 1;
          excavateContent += `\nFound Ancient Artifact x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + excavateExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "Excavate",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "⛏️",
            content: excavateContent
          }),
          threadID,
          messageID
        );

      case "dance":
        const danceExp = 10;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + danceExp });
        return api.sendMessage(
          format({
            title: "Dance",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💃",
            content: `Danced for fun! Gained ${danceExp} XP.`
          }),
          threadID,
          messageID
        );

      case "pray":
        const prayExp = Math.floor(Math.random() * 25) + 10;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + prayExp });
        return api.sendMessage(
          format({
            title: "Pray",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🙏",
            content: `Prayed for blessings! Gained ${prayExp} XP.`
          }),
          threadID,
          messageID
        );

      case "forgearmor":
        if (player.inventory["Ore"] < 4) {
          return api.sendMessage(
            format({
              title: "ForgeArmor",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 4 Ore!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Ore"] -= 4;
        player.inventory["Steel Armor"] = (player.inventory["Steel Armor"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "ForgeArmor",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🛡️",
            content: `Forged Steel Armor!`
          }),
          threadID,
          messageID
        );

      case "rescue":
        const rescueExp = 30;
        const rescueChance = Math.random();
        if (rescueChance > 0.5) {
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + rescueExp });
          return api.sendMessage(
            format({
              title: "Rescue",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚑",
              content: `Rescued someone! Gained ${rescueExp} XP.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Rescue",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Failed to rescue!`
          }),
          threadID,
          messageID
        );

      case "navigate":
        const navigateExp = Math.floor(Math.random() * 40) + 20;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + navigateExp });
        return api.sendMessage(
          format({
            title: "Navigate",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🧭",
            content: `Navigated successfully! Gained ${navigateExp} XP.`
          }),
          threadID,
          messageID
        );

      case "barricade":
        if (player.inventory["Wood"] < 3) {
          return api.sendMessage(
            format({
              title: "Barricade",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 3 Wood!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Wood"] -= 3;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Barricade",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🛡️",
            content: `Built a barricade!`
          }),
          threadID,
          messageID
        );

      case "study":
        const studyExp = Math.floor(Math.random() * 20) + 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + studyExp });
        return api.sendMessage(
          format({
            title: "Study",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📚",
            content: `Studied ancient texts! Gained ${studyExp} XP.`
          }),
          threadID,
          messageID
        );

      case "bribe":
        const bribeTarget = args[1];
        if (!bribeTarget) {
          return api.sendMessage(
            format({
              title: "Bribe",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Bribe: #rpg bribe <userID>`
            }),
            threadID,
            messageID
          );
        }
        if (player.balance < 100) {
          return api.sendMessage(
            format({
              title: "Bribe",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 100 coins!`
            }),
            threadID,
            messageID
          );
        }
        await rpgManager.removeBalance(senderID, 100);
        const bribeChance = Math.random();
        if (bribeChance > 0.6) {
          await rpgManager.addBalance(senderID, 50);
          return api.sendMessage(
            format({
              title: "Bribe",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "💰",
              content: `Bribed ${bribeTarget} successfully! Gained 50 coins.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Bribe",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "❌",
            content: `Bribe failed with ${bribeTarget}!`
          }),
          threadID,
          messageID
        );

      case "disguise":
        if (player.inventory["Deer Hide"] < 1) {
          return api.sendMessage(
            format({
              title: "Disguise",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Deer Hide!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Deer Hide"] -= 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Disguise",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎭",
            content: `Disguised successfully!`
          }),
          threadID,
          messageID
        );

      case "sneak":
        const sneakChance = Math.random();
        if (sneakChance > 0.7) {
          const sneakExp = 25;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + sneakExp });
          return api.sendMessage(
            format({
              title: "Sneak",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🥷",
              content: `Sneaked past guards! Gained ${sneakExp} XP.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Sneak",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Caught sneaking!`
          }),
          threadID,
          messageID
        );

      case "ambush":
        const ambushTarget = args[1];
        if (!ambushTarget) {
          return api.sendMessage(
            format({
              title: "Ambush",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Ambush: #rpg ambush <userID>`
            }),
            threadID,
            messageID
          );
        }
        const ambushChance = Math.random();
        if (ambushChance > 0.6) {
          const ambushReward = Math.floor(Math.random() * 80) + 20;
          await rpgManager.addBalance(senderID, ambushReward);
          return api.sendMessage(
            format({
              title: "Ambush",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🏹",
              content: `Ambushed ${ambushTarget}! Gained $${ambushReward}.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Ambush",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Ambush on ${ambushTarget} failed!`
          }),
          threadID,
          messageID
        );

      case "escape":
        const escapeChance = Math.random();
        if (escapeChance > 0.5) {
          const escapeExp = 20;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + escapeExp });
          return api.sendMessage(
            format({
              title: "Escape",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🏃",
              content: `Escaped danger! Gained ${escapeExp} XP.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Escape",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Failed to escape!`
          }),
          threadID,
          messageID
        );

      case "patrol":
        const patrolExp = 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + patrolExp });
        return api.sendMessage(
          format({
            title: "Patrol",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "👮",
            content: `Patrolled the area! Gained ${patrolExp} XP.`
          }),
          threadID,
          messageID
        );

      case "investigate":
        const investigateExp = Math.floor(Math.random() * 30) + 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + investigateExp });
        return api.sendMessage(
          format({
            title: "Investigate",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔎",
            content: `Investigated clues! Gained ${investigateExp} XP.`
          }),
          threadID,
          messageID
        );

      case "bountyhunt":
        const bountyHuntReward = Math.floor(Math.random() * 350) + 150;
        await rpgManager.addBalance(senderID, bountyHuntReward);
        return api.sendMessage(
          format({
            title: "BountyHunt",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔫",
            content: `Completed bounty hunt! Earned $${bountyHuntReward}.`
          }),
          threadID,
          messageID
        );

      case "rally":
        const rallyExp = 25;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + rallyExp });
        return api.sendMessage(
          format({
            title: "Rally",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📣",
            content: `Rallied allies! Gained ${rallyExp} XP.`
          }),
          threadID,
          messageID
        );

        case "forage":
        const forageExp = 12;
        player.inventory["Berry"] = (player.inventory["Berry"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + forageExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Forage",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🍇",
            content: `Foraged Berries! Gained ${forageExp} XP.`
          }),
          threadID,
          messageID
        );

      case "carve":
        if (player.inventory["Wood"] < 1) {
          return api.sendMessage(
            format({
              title: "Carve",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Wood!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Wood"] -= 1;
        player.inventory["Wooden Statue"] = (player.inventory["Wooden Statue"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Carve",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🗿",
            content: `Carved a Wooden Statue!`
          }),
          threadID,
          messageID
        );

      case "scavenge":
        const scavengeExp = Math.floor(Math.random() * 25) + 10;
        const scavengeLootChance = Math.random();
        let scavengeContent = `Scavenged! Gained ${scavengeExp} XP.`;
        if (scavengeLootChance > 0.45) {
          player.inventory["Scrap Metal"] = (player.inventory["Scrap Metal"] || 0) + 1;
          scavengeContent += `\nFound Scrap Metal x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + scavengeExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "Scavenge",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔍",
            content: scavengeContent
          }),
          threadID,
          messageID
        );

      case "chant":
        const chantExp = Math.floor(Math.random() * 20) + 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + chantExp });
        return api.sendMessage(
          format({
            title: "Chant",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎶",
            content: `Chanted a spell! Gained ${chantExp} XP.`
          }),
          threadID,
          messageID
        );

      case "plunder":
        const plunderReward = Math.floor(Math.random() * 250) + 100;
        await rpgManager.addBalance(senderID, plunderReward);
        return api.sendMessage(
          format({
            title: "Plunder",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏴‍☠️",
            content: `Plundered a village! Earned $${plunderReward}.`
          }),
          threadID,
          messageID
        );

      case "construct":
        if (player.inventory["Wood"] < 5 || player.inventory["Ore"] < 2) {
          return api.sendMessage(
            format({
              title: "Construct",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 5 Wood and 2 Ore!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Wood"] -= 5;
        player.inventory["Ore"] -= 2;
        player.inventory["Fortress"] = (player.inventory["Fortress"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Construct",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏯",
            content: `Constructed a Fortress!`
          }),
          threadID,
          messageID
        );

      case "bountytrack":
        const trackReward = Math.floor(Math.random() * 200) + 80;
        await rpgManager.addBalance(senderID, trackReward);
        return api.sendMessage(
          format({
            title: "BountyTrack",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔍",
            content: `Tracked a bounty! Earned $${trackReward}.`
          }),
          threadID,
          messageID
        );

      case "celebrate":
        const celebrateExp = 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + celebrateExp });
        return api.sendMessage(
          format({
            title: "Celebrate",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎉",
            content: `Celebrated a victory! Gained ${celebrateExp} XP.`
          }),
          threadID,
          messageID
        );

      case "disarm":
        const disarmChance = Math.random();
        if (disarmChance > 0.6) {
          const disarmExp = 25;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + disarmExp });
          return api.sendMessage(
            format({
              title: "Disarm",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🛡️",
              content: `Disarmed a trap! Gained ${disarmExp} XP.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Disarm",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Failed to disarm!`
          }),
          threadID,
          messageID
        );

      case "exploreforest":
        const forestExp = Math.floor(Math.random() * 30) + 15;
        const forestLootChance = Math.random();
        let forestContent = `Explored forest! Gained ${forestExp} XP.`;
        if (forestLootChance > 0.4) {
          player.inventory["Forest Leaf"] = (player.inventory["Forest Leaf"] || 0) + 1;
          forestContent += `\nFound Forest Leaf x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + forestExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "ExploreForest",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌳",
            content: forestContent
          }),
          threadID,
          messageID
        );

      case "haggle":
        const haggleTarget = args[1];
        if (!haggleTarget) {
          return api.sendMessage(
            format({
              title: "Haggle",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Haggle: #rpg haggle <userID>`
            }),
            threadID,
            messageID
          );
        }
        const haggleChance = Math.random();
        if (haggleChance > 0.65) {
          const haggleAmount = Math.floor(Math.random() * 40) + 15;
          await rpgManager.transferBalance(haggleTarget, senderID, haggleAmount);
          return api.sendMessage(
            format({
              title: "Haggle",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "💬",
              content: `Haggled $${haggleAmount} from ${haggleTarget}!`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Haggle",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "❌",
            content: `Haggle failed with ${haggleTarget}!`
          }),
          threadID,
          messageID
        );

      case "reinforce":
        if (player.inventory["Steel Armor"] < 1) {
          return api.sendMessage(
            format({
              title: "Reinforce",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Steel Armor!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Steel Armor"] -= 1;
        player.inventory["Reinforced Armor"] = (player.inventory["Reinforced Armor"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Reinforce",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🛡️",
            content: `Reinforced your Armor!`
          }),
          threadID,
          messageID
        );

      case "scry":
        const scryExp = Math.floor(Math.random() * 30) + 20;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + scryExp });
        return api.sendMessage(
          format({
            title: "Scry",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔮",
            content: `Scryed the future! Gained ${scryExp} XP.`
          }),
          threadID,
          messageID
        );

      case "smuggle":
        const smuggleChance = Math.random();
        if (smuggleChance > 0.7) {
          const smuggleReward = Math.floor(Math.random() * 120) + 50;
          await rpgManager.addBalance(senderID, smuggleReward);
          return api.sendMessage(
            format({
              title: "Smuggle",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚢",
              content: `Smuggled goods! Earned $${smuggleReward}.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Smuggle",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Smuggling failed!`
          }),
          threadID,
          messageID
        );

      case "tinker":
        if (player.inventory["Scrap Metal"] < 2) {
          return api.sendMessage(
            format({
              title: "Tinker",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 2 Scrap Metal!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Scrap Metal"] -= 2;
        player.inventory["Gadget"] = (player.inventory["Gadget"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Tinker",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔧",
            content: `Tinkered a Gadget!`
          }),
          threadID,
          messageID
        );

      case "voyage":
        const voyageExp = Math.floor(Math.random() * 50) + 25;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + voyageExp });
        return api.sendMessage(
          format({
            title: "Voyage",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "⛵",
            content: `Set sail! Gained ${voyageExp} XP.`
          }),
          threadID,
          messageID
        );

      case "bountycollect":
        const bountyCollectReward = Math.floor(Math.random() * 400) + 200;
        await rpgManager.addBalance(senderID, bountyCollectReward);
        return api.sendMessage(
          format({
            title: "BountyCollect",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💰",
            content: `Collected bounty! Earned $${bountyCollectReward}.`
          }),
          threadID,
          messageID
        );

      case "rallytroops":
        const rallyTroopsExp = 30;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + rallyTroopsExp });
        return api.sendMessage(
          format({
            title: "RallyTroops",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏰",
            content: `Rallied troops! Gained ${rallyTroopsExp} XP.`
          }),
          threadID,
          messageID
        );

      case "decode":
        const decodeExp = Math.floor(Math.random() * 35) + 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + decodeExp });
        return api.sendMessage(
          format({
            title: "Decode",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔑",
            content: `Decoded a message! Gained ${decodeExp} XP.`
          }),
          threadID,
          messageID
        );

      case "bountyescape":
        const escapeBountyChance = Math.random();
        if (escapeBountyChance > 0.6) {
          const escapeBountyExp = 40;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + escapeBountyExp });
          return api.sendMessage(
            format({
              title: "BountyEscape",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🏃",
              content: `Escaped bounty hunters! Gained ${escapeBountyExp} XP.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "BountyEscape",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Caught by bounty hunters!`
          }),
          threadID,
          messageID
        );

      case "ritual":
        if (player.inventory["Herb"] < 3) {
          return api.sendMessage(
            format({
              title: "Ritual",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 3 Herbs!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Herb"] -= 3;
        const ritualExp = 50;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + ritualExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Ritual",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🕉️",
            content: `Performed a ritual! Gained ${ritualExp} XP.`
          }),
          threadID,
          messageID
        );

      case "survey":
        const surveyExp = Math.floor(Math.random() * 20) + 10;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + surveyExp });
        return api.sendMessage(
          format({
            title: "Survey",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📏",
            content: `Surveyed the land! Gained ${surveyExp} XP.`
          }),
          threadID,
          messageID
        );

case "prospect":
        const prospectExp = Math.floor(Math.random() * 25) + 10;
        const prospectLootChance = Math.random();
        let prospectContent = `Prospected for resources! Gained ${prospectExp} XP.`;
        if (prospectLootChance > 0.45) {
          player.inventory["Raw Gem"] = (player.inventory["Raw Gem"] || 0) + 1;
          prospectContent += `\nFound Raw Gem x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + prospectExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "Prospect",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔍",
            content: prospectContent
          }),
          threadID,
          messageID
        );

      case "weave":
        if (player.inventory["Forest Leaf"] < 2) {
          return api.sendMessage(
            format({
              title: "Weave",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 2 Forest Leaves!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Forest Leaf"] -= 2;
        player.inventory["Woven Cloak"] = (player.inventory["Woven Cloak"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Weave",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🧶",
            content: `Wove a Cloak!`
          }),
          threadID,
          messageID
        );

      case "scoutmountain":
        const mountainExp = Math.floor(Math.random() * 35) + 15;
        const mountainLootChance = Math.random();
        let mountainContent = `Scouted mountain! Gained ${mountainExp} XP.`;
        if (mountainLootChance > 0.4) {
          player.inventory["Mountain Rock"] = (player.inventory["Mountain Rock"] || 0) + 1;
          mountainContent += `\nFound Mountain Rock x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + mountainExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "ScoutMountain",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏔️",
            content: mountainContent
          }),
          threadID,
          messageID
        );

      case "perform":
        const performExp = Math.floor(Math.random() * 20) + 10;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + performExp });
        return api.sendMessage(
          format({
            title: "Perform",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎭",
            content: `Performed for the crowd! Gained ${performExp} XP.`
          }),
          threadID,
          messageID
        );

      case "plow":
        const plowExp = 15;
        player.inventory["Planted Seed"] = (player.inventory["Planted Seed"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + plowExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Plow",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌱",
            content: `Plowed the field! Gained ${plowExp} XP.`
          }),
          threadID,
          messageID
        );

      case "refine":
        if (player.inventory["Raw Gem"] < 1) {
          return api.sendMessage(
            format({
              title: "Refine",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Raw Gem!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Raw Gem"] -= 1;
        player.inventory["Polished Gem"] = (player.inventory["Polished Gem"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Refine",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💎",
            content: `Refined a Polished Gem!`
          }),
          threadID,
          messageID
        );

      case "sabotage":
        const sabotageTarget = args[1];
        if (!sabotageTarget) {
          return api.sendMessage(
            format({
              title: "Sabotage",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Sabotage: #rpg sabotage <userID>`
            }),
            threadID,
            messageID
          );
        }
        const sabotageChance = Math.random();
        if (sabotageChance > 0.6) {
          const sabotageExp = 30;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + sabotageExp });
          return api.sendMessage(
            format({
              title: "Sabotage",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "💣",
              content: `Sabotaged ${sabotageTarget}! Gained ${sabotageExp} XP.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Sabotage",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Sabotage on ${sabotageTarget} failed!`
          }),
          threadID,
          messageID
        );

      case "track":
        const trackExp = Math.floor(Math.random() * 30) + 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + trackExp });
        return api.sendMessage(
          format({
            title: "Track",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "👣",
            content: `Tracked a target! Gained ${trackExp} XP.`
          }),
          threadID,
          messageID
        );

      case "assemble":
        if (player.inventory["Scrap Metal"] < 3) {
          return api.sendMessage(
            format({
              title: "Assemble",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 3 Scrap Metal!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Scrap Metal"] -= 3;
        player.inventory["Mechanic Device"] = (player.inventory["Mechanic Device"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Assemble",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔩",
            content: `Assembled a Mechanic Device!`
          }),
          threadID,
          messageID
        );

      case "bountyguard":
        const guardReward = Math.floor(Math.random() * 180) + 70;
        await rpgManager.addBalance(senderID, guardReward);
        return api.sendMessage(
          format({
            title: "BountyGuard",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🛡️",
            content: `Guarded a bounty! Earned $${guardReward}.`
          }),
          threadID,
          messageID
        );

      case "inspire":
        const inspireExp = 20;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + inspireExp });
        return api.sendMessage(
          format({
            title: "Inspire",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎤",
            content: `Inspired allies! Gained ${inspireExp} XP.`
          }),
          threadID,
          messageID
        );

      case "overthrow":
        const overthrowReward = Math.floor(Math.random() * 300) + 150;
        await rpgManager.addBalance(senderID, overthrowReward);
        return api.sendMessage(
          format({
            title: "Overthrow",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "👑",
            content: `Overthrew a tyrant! Earned $${overthrowReward}.`
          }),
          threadID,
          messageID
        );

      case "camouflage":
        if (player.inventory["Forest Leaf"] < 1) {
          return api.sendMessage(
            format({
              title: "Camouflage",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Forest Leaf!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Forest Leaf"] -= 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Camouflage",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌿",
            content: `Camouflaged successfully!`
          }),
          threadID,
          messageID
        );

      case "bountyraid":
        const raidBountyReward = Math.floor(Math.random() * 350) + 150;
        await rpgManager.addBalance(senderID, raidBountyReward);
        return api.sendMessage(
          format({
            title: "BountyRaid",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💣",
            content: `Raided a bounty hideout! Earned $${raidBountyReward}.`
          }),
          threadID,
          messageID
        );

      case "recharge":
        if (player.inventory["Gadget"] < 1) {
          return api.sendMessage(
            format({
              title: "Recharge",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Gadget!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Gadget"] -= 1;
        const rechargeExp = 25;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + rechargeExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Recharge",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔋",
            content: `Recharged energy! Gained ${rechargeExp} XP.`
          }),
          threadID,
          messageID
        );

      case "skirmish":
        const skirmishTarget = args[1];
        if (!skirmishTarget) {
          return api.sendMessage(
            format({
              title: "Skirmish",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Skirmish: #rpg skirmish <userID>`
            }),
            threadID,
            messageID
          );
        }
        const skirmishChance = Math.random();
        if (skirmishChance > 0.55) {
          const skirmishReward = Math.floor(Math.random() * 90) + 30;
          await rpgManager.addBalance(senderID, skirmishReward);
          return api.sendMessage(
            format({
              title: "Skirmish",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "⚔️",
              content: `Won skirmish vs ${skirmishTarget}! Earned $${skirmishReward}.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Skirmish",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Lost skirmish vs ${skirmishTarget}!`
          }),
          threadID,
          messageID
        );

      case "bountyhide":
        const hideChance = Math.random();
        if (hideChance > 0.65) {
          const hideExp = 35;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + hideExp });
          return api.sendMessage(
            format({
              title: "BountyHide",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🌑",
              content: `Hid from bounty! Gained ${hideExp} XP.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "BountyHide",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Failed to hide from bounty!`
          }),
          threadID,
          messageID
        );

      case "mend":
        if (player.inventory["Woven Cloak"] < 1) {
          return api.sendMessage(
            format({
              title: "Mend",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Woven Cloak!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Woven Cloak"] -= 1;
        player.inventory["Mended Cloak"] = (player.inventory["Mended Cloak"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Mend",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🧵",
            content: `Mended a Cloak!`
          }),
          threadID,
          messageID
        );

      case "bountyseek":
        const seekReward = Math.floor(Math.random() * 220) + 90;
        await rpgManager.addBalance(senderID, seekReward);
        return api.sendMessage(
          format({
            title: "BountySeek",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔎",
            content: `Sought a bounty! Earned $${seekReward}.`
          }),
          threadID,
          messageID
        );

      case "rallydefend":
        const rallyDefendExp = 25;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + rallyDefendExp });
        return api.sendMessage(
          format({
            title: "RallyDefend",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏰",
            content: `Rallied to defend! Gained ${rallyDefendExp} XP.`
          }),
          threadID,
          messageID
        );

      case "illuminate":
        const illuminateExp = Math.floor(Math.random() * 30) + 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + illuminateExp });
        return api.sendMessage(
          format({
            title: "Illuminate",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💡",
            content: `Illuminated the dark! Gained ${illuminateExp} XP.`
          }),
          threadID,
          messageID
        );

      case "bountytrap":
        const trapChance = Math.random();
        if (trapChance > 0.6) {
          const trapReward = Math.floor(Math.random() * 150) + 50;
          await rpgManager.addBalance(senderID, trapReward);
          return api.sendMessage(
            format({
              title: "BountyTrap",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🪤",
              content: `Trapped a bounty! Earned $${trapReward}.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "BountyTrap",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Trap failed!`
          }),
          threadID,
          messageID
        );

        case "cultivate":
        const cultivateExp = 15;
        player.inventory["Crop"] = (player.inventory["Crop"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + cultivateExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Cultivate",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌾",
            content: `Cultivated a Crop! Gained ${cultivateExp} XP.`
          }),
          threadID,
          messageID
        );

      case "smelt":
        if (player.inventory["Ore"] < 2) {
          return api.sendMessage(
            format({
              title: "Smelt",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 2 Ore!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Ore"] -= 2;
        player.inventory["Iron Ingot"] = (player.inventory["Iron Ingot"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Smelt",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔥",
            content: `Smelted an Iron Ingot!`
          }),
          threadID,
          messageID
        );

      case "scoutdesert":
        const desertExp = Math.floor(Math.random() * 40) + 20;
        const desertLootChance = Math.random();
        let desertContent = `Scouted desert! Gained ${desertExp} XP.`;
        if (desertLootChance > 0.35) {
          player.inventory["Desert Sand"] = (player.inventory["Desert Sand"] || 0) + 1;
          desertContent += `\nFound Desert Sand x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + desertExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "ScoutDesert",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏜️",
            content: desertContent
          }),
          threadID,
          messageID
        );

      case "juggle":
        const juggleExp = Math.floor(Math.random() * 15) + 10;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + juggleExp });
        return api.sendMessage(
          format({
            title: "Juggle",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🤹",
            content: `Juggled for the crowd! Gained ${juggleExp} XP.`
          }),
          threadID,
          messageID
        );

      case "plundersea":
        const plunderSeaReward = Math.floor(Math.random() * 300) + 150;
        await rpgManager.addBalance(senderID, plunderSeaReward);
        return api.sendMessage(
          format({
            title: "PlunderSea",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌊",
            content: `Plundered the sea! Earned $${plunderSeaReward}.`
          }),
          threadID,
          messageID
        );

      case "fortify":
        if (player.inventory["Iron Ingot"] < 3) {
          return api.sendMessage(
            format({
              title: "Fortify",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 3 Iron Ingots!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Iron Ingot"] -= 3;
        player.inventory["Fortified Wall"] = (player.inventory["Fortified Wall"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Fortify",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏯",
            content: `Fortified a Wall!`
          }),
          threadID,
          messageID
        );

      case "bountysearch":
        const searchReward = Math.floor(Math.random() * 250) + 100;
        await rpgManager.addBalance(senderID, searchReward);
        return api.sendMessage(
          format({
            title: "BountySearch",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔎",
            content: `Searched for a bounty! Earned $${searchReward}.`
          }),
          threadID,
          messageID
        );

      case "feast":
        const feastExp = 20;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + feastExp });
        return api.sendMessage(
          format({
            title: "Feast",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🍽️",
            content: `Held a feast! Gained ${feastExp} XP.`
          }),
          threadID,
          messageID
        );

      case "evade":
        const evadeChance = Math.random();
        if (evadeChance > 0.6) {
          const evadeExp = 25;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + evadeExp });
          return api.sendMessage(
            format({
              title: "Evade",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🏃",
              content: `Evaded an attack! Gained ${evadeExp} XP.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Evade",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Failed to evade!`
          }),
          threadID,
          messageID
        );

      case "exploreswamp":
        const swampExp = Math.floor(Math.random() * 35) + 15;
        const swampLootChance = Math.random();
        let swampContent = `Explored swamp! Gained ${swampExp} XP.`;
        if (swampLootChance > 0.4) {
          player.inventory["Swamp Mud"] = (player.inventory["Swamp Mud"] || 0) + 1;
          swampContent += `\nFound Swamp Mud x1!`;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + swampExp, inventory: player.inventory });
        }
        return api.sendMessage(
          format({
            title: "ExploreSwamp",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💦",
            content: swampContent
          }),
          threadID,
          messageID
        );

      case "negotiate":
        const negotiateTarget = args[1];
        if (!negotiateTarget) {
          return api.sendMessage(
            format({
              title: "Negotiate",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Negotiate: #rpg negotiate <userID>`
            }),
            threadID,
            messageID
          );
        }
        const negotiateChance = Math.random();
        if (negotiateChance > 0.65) {
          const negotiateAmount = Math.floor(Math.random() * 50) + 20;
          await rpgManager.transferBalance(negotiateTarget, senderID, negotiateAmount);
          return api.sendMessage(
            format({
              title: "Negotiate",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🤝",
              content: `Negotiated $${negotiateAmount} from ${negotiateTarget}!`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "Negotiate",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "❌",
            content: `Negotiation failed with ${negotiateTarget}!`
          }),
          threadID,
          messageID
        );

      case "upgradearmor":
        if (player.inventory["Reinforced Armor"] < 1) {
          return api.sendMessage(
            format({
              title: "UpgradeArmor",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Reinforced Armor!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Reinforced Armor"] -= 1;
        player.inventory["Elite Armor"] = (player.inventory["Elite Armor"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "UpgradeArmor",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🛡️",
            content: `Upgraded to Elite Armor!`
          }),
          threadID,
          messageID
        );

      case "divine":
        const divineExp = Math.floor(Math.random() * 40) + 20;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + divineExp });
        return api.sendMessage(
          format({
            title: "Divine",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "✨",
            content: `Divined the future! Gained ${divineExp} XP.`
          }),
          threadID,
          messageID
        );

      case "smugglecargo":
        const smuggleCargoChance = Math.random();
        if (smuggleCargoChance > 0.7) {
          const smuggleCargoReward = Math.floor(Math.random() * 150) + 60;
          await rpgManager.addBalance(senderID, smuggleCargoReward);
          return api.sendMessage(
            format({
              title: "SmuggleCargo",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚢",
              content: `Smuggled cargo! Earned $${smuggleCargoReward}.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "SmuggleCargo",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Smuggling cargo failed!`
          }),
          threadID,
          messageID
        );

      case "upgradegear":
        if (player.inventory["Mechanic Device"] < 1) {
          return api.sendMessage(
            format({
              title: "UpgradeGear",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Mechanic Device!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Mechanic Device"] -= 1;
        player.inventory["Enhanced Gear"] = (player.inventory["Enhanced Gear"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "UpgradeGear",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "⚙️",
            content: `Upgraded to Enhanced Gear!`
          }),
          threadID,
          messageID
        );

      case "navigateocean":
        const oceanExp = Math.floor(Math.random() * 50) + 25;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + oceanExp });
        return api.sendMessage(
          format({
            title: "NavigateOcean",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌊",
            content: `Navigated the ocean! Gained ${oceanExp} XP.`
          }),
          threadID,
          messageID
        );

      case "bountyintercept":
        const interceptReward = Math.floor(Math.random() * 280) + 120;
        await rpgManager.addBalance(senderID, interceptReward);
        return api.sendMessage(
          format({
            title: "BountyIntercept",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🚔",
            content: `Intercepted a bounty! Earned $${interceptReward}.`
          }),
          threadID,
          messageID
        );

      case "motivate":
        const motivateExp = 20;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + motivateExp });
        return api.sendMessage(
          format({
            title: "Motivate",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "📣",
            content: `Motivated the team! Gained ${motivateExp} XP.`
          }),
          threadID,
          messageID
        );

      case "overrun":
        const overrunReward = Math.floor(Math.random() * 320) + 160;
        await rpgManager.addBalance(senderID, overrunReward);
        return api.sendMessage(
          format({
            title: "Overrun",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏃",
            content: `Overran the enemy! Earned $${overrunReward}.`
          }),
          threadID,
          messageID
        );

      case "cloak":
        if (player.inventory["Swamp Mud"] < 1) {
          return api.sendMessage(
            format({
              title: "Cloak",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Swamp Mud!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Swamp Mud"] -= 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Cloak",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🌫️",
            content: `Cloaked in shadows!`
          }),
          threadID,
          messageID
        );

      case "bountyambush":
        const ambushBountyReward = Math.floor(Math.random() * 300) + 130;
        await rpgManager.addBalance(senderID, ambushBountyReward);
        return api.sendMessage(
          format({
            title: "BountyAmbush",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏹",
            content: `Ambushed a bounty! Earned $${ambushBountyReward}.`
          }),
          threadID,
          messageID
        );

      case "restore":
        if (player.inventory["Potion"] < 1) {
          return api.sendMessage(
            format({
              title: "Restore",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Potion!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Potion"] -= 1;
        const restoreExp = 30;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + restoreExp, inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Restore",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🩹",
            content: `Restored energy! Gained ${restoreExp} XP.`
          }),
          threadID,
          messageID
        );

      case "skirmishraid":
        const skirmishRaidTarget = args[1];
        if (!skirmishRaidTarget) {
          return api.sendMessage(
            format({
              title: "SkirmishRaid",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `SkirmishRaid: #rpg skirmishraid <userID>`
            }),
            threadID,
            messageID
          );
        }
        const skirmishRaidChance = Math.random();
        if (skirmishRaidChance > 0.55) {
          const skirmishRaidReward = Math.floor(Math.random() * 110) + 40;
          await rpgManager.addBalance(senderID, skirmishRaidReward);
          return api.sendMessage(
            format({
              title: "SkirmishRaid",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "⚔️",
              content: `Won skirmish raid vs ${skirmishRaidTarget}! Earned $${skirmishRaidReward}.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "SkirmishRaid",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Lost skirmish raid vs ${skirmishRaidTarget}!`
          }),
          threadID,
          messageID
        );

      case "bountyevade":
        const evadeBountyChance = Math.random();
        if (evadeBountyChance > 0.65) {
          const evadeBountyExp = 35;
          await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + evadeBountyExp });
          return api.sendMessage(
            format({
              title: "BountyEvade",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🏃",
              content: `Evaded a bounty! Gained ${evadeBountyExp} XP.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "BountyEvade",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Failed to evade bounty!`
          }),
          threadID,
          messageID
        );

      case "tailor":
        if (player.inventory["Swamp Mud"] < 1 || player.inventory["Forest Leaf"] < 1) {
          return api.sendMessage(
            format({
              title: "Tailor",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🚫",
              content: `Need 1 Swamp Mud and 1 Forest Leaf!`
            }),
            threadID,
            messageID
          );
        }
        player.inventory["Swamp Mud"] -= 1;
        player.inventory["Forest Leaf"] -= 1;
        player.inventory["Camouflage Cloak"] = (player.inventory["Camouflage Cloak"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({
            title: "Tailor",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "👗",
            content: `Tailored a Camouflage Cloak!`
          }),
          threadID,
          messageID
        );

      case "bountytrackdown":
        const trackdownReward = Math.floor(Math.random() * 270) + 110;
        await rpgManager.addBalance(senderID, trackdownReward);
        return api.sendMessage(
          format({
            title: "BountyTrackdown",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🔍",
            content: `Tracked down a bounty! Earned $${trackdownReward}.`
          }),
          threadID,
          messageID
        );

      case "rallyattack":
        const rallyAttackExp = 30;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + rallyAttackExp });
        return api.sendMessage(
          format({
            title: "RallyAttack",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🏹",
            content: `Rallied an attack! Gained ${rallyAttackExp} XP.`
          }),
          threadID,
          messageID
        );

      case "enlighten":
        const enlightenExp = Math.floor(Math.random() * 35) + 15;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + enlightenExp });
        return api.sendMessage(
          format({
            title: "Enlighten",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💡",
            content: `Enlightened your mind! Gained ${enlightenExp} XP.`
          }),
          threadID,
          messageID
        );

      case "bountycapture":
        const captureChance = Math.random();
        if (captureChance > 0.6) {
          const captureReward = Math.floor(Math.random() * 200) + 80;
          await rpgManager.addBalance(senderID, captureReward);
          return api.sendMessage(
            format({
              title: "BountyCapture",
              titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
              titleFont: "double_struck",
              emojis: "🔗",
              content: `Captured a bounty! Earned $${captureReward}.`
            }),
            threadID,
            messageID
          );
        }
        return api.sendMessage(
          format({
            title: "BountyCapture",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "💥",
            content: `Failed to capture bounty!`
          }),
          threadID,
          messageID
        );
         case "bakebread":
        await rpgManager.addBalance(senderID, 40);
        return api.sendMessage(format({ title: "Bake Bread", emojis: "🍞", content: "Fresh bread sold hot! +$40" }), threadID, messageID);

      case "carvewood":
        player.inventory["Wood Carving"] = (player.inventory["Wood Carving"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Carve Wood", emojis: "🪵", content: "Beautiful carving complete!" }), threadID, messageID);

      case "castnet":
        const fish = Math.floor(Math.random() * 60) + 20;
        await rpgManager.addBalance(senderID, fish);
        return api.sendMessage(format({ title: "Cast Net", emojis: "🎣", content: `Good haul from the net! +$${fish}` }), threadID, messageID);

      case "climbtree":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 15 });
        return api.sendMessage(format({ title: "Climb Tree", emojis: "🌳", content: "Great view from the top! +15 XP" }), threadID, messageID);

      case "collectrain":
        player.inventory["Rainwater"] = (player.inventory["Rainwater"] || 0) + 3;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Collect Rain", emojis: "🌧️", content: "Barrels filled with fresh rainwater!" }), threadID, messageID);

      case "compose song":
        await rpgManager.addBalance(senderID, 60);
        return api.sendMessage(format({ title: "Compose Song", emojis: "🎶", content: "Tavern patrons loved your new ballad! +$60" }), threadID, messageID);

      case "craftarrow":
        player.inventory["Arrow"] = (player.inventory["Arrow"] || 0) + 10;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Craft Arrow", emojis: "🏹", content: "Crafted 10 sharp arrows!" }), threadID, messageID);

      case "distillpotion":
        player.inventory["Potion Base"] = (player.inventory["Potion Base"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Distill Potion", emojis: "🧪", content: "Pure potion base ready for brewing!" }), threadID, messageID);

      case "drawmap":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 20 });
        return api.sendMessage(format({ title: "Draw Map", emojis: "🗺️", content: "Detailed map drawn. +20 XP" }), threadID, messageID);

      case "dresswound":
        return api.sendMessage(format({ title: "Dress Wound", emojis: "🩹", content: "Wounds bandaged. Ready to fight again!" }), threadID, messageID);

      case "dryherbs":
        player.inventory["Dried Herbs"] = (player.inventory["Dried Herbs"] || 0) + 2;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Dry Herbs", emojis: "🌿", content: "Herbs dried and preserved!" }), threadID, messageID);

      case "dyecloth":
        player.inventory["Dyed Cloth"] = (player.inventory["Dyed Cloth"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Dye Cloth", emojis: "🧵", content: "Vibrant colors achieved!" }), threadID, messageID);

      case "embossmetal":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 25 });
        return api.sendMessage(format({ title: "Emboss Metal", emojis: "🔨", content: "Intricate design embossed. +25 XP" }), threadID, messageID);

      case "etchrune":
        player.inventory["Rune Stone"] = (player.inventory["Rune Stone"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Etch Rune", emojis: "ᚱ", content: "Powerful rune etched!" }), threadID, messageID);

      case "fletcharrow":
        player.inventory["Fletched Arrow"] = (player.inventory["Fletched Arrow"] || 0) + 8;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Fletch Arrow", emojis: "🏹", content: "8 perfectly fletched arrows ready!" }), threadID, messageID);

      case "foldorigami":
        await rpgManager.addBalance(senderID, 30);
        return api.sendMessage(format({ title: "Fold Origami", emojis: "🦢", content: "Sold delicate origami cranes! +$30" }), threadID, messageID);

      case "grindspice":
        player.inventory["Ground Spice"] = (player.inventory["Ground Spice"] || 0) + 3;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Grind Spice", emojis: "🌶️", content: "Aromatic spices ground!" }), threadID, messageID);

      case "hollowlog":
        player.inventory["Hollow Log"] = (player.inventory["Hollow Log"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Hollow Log", emojis: "🪵", content: "Perfect for storage or raft!" }), threadID, messageID);

      case "infusepotion":
        return api.sendMessage(format({ title: "Infuse Potion", emojis: "🧪", content: "Potion brewing in progress..." }), threadID, messageID);

      case "kindlefire":
        return api.sendMessage(format({ title: "Kindle Fire", emojis: "🔥", content: "Warm fire started. Camp feels safe." }), threadID, messageID);

      case "knitscarf":
        player.inventory["Knitted Scarf"] = (player.inventory["Knitted Scarf"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Knit Scarf", emojis: "🧣", content: "Cozy scarf completed!" }), threadID, messageID);

      case "laybricks":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 30 });
        return api.sendMessage(format({ title: "Lay Bricks", emojis: "🧱", content: "Sturdy wall section built. +30 XP" }), threadID, messageID);

      case "loomb weave":
        player.inventory["Woven Fabric"] = (player.inventory["Woven Fabric"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Loom Weave", emojis: "🧶", content: "Fine fabric woven on the loom!" }), threadID, messageID);

      case "meltwax":
        player.inventory["Candle Wax"] = (player.inventory["Candle Wax"] || 0) + 5;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Melt Wax", emojis: "🕯️", content: "Wax melted and ready for candles!" }), threadID, messageID);

      case "mendnet":
        return api.sendMessage(format({ title: "Mend Net", emojis: "🪡", content: "Fishing net repaired. Better catches ahead!" }), threadID, messageID);

      case "mixpaint":
        player.inventory["Paint"] = (player.inventory["Paint"] || 0) + 2;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Mix Paint", emojis: "🎨", content: "Vivid colors mixed!" }), threadID, messageID);

      case "polishgem":
        await rpgManager.addBalance(senderID, 80);
        return api.sendMessage(format({ title: "Polish Gem", emojis: "💎", content: "Gem sparkles brilliantly! Sold for $80" }), threadID, messageID);

      case "pressflowers":
        player.inventory["Pressed Flower"] = (player.inventory["Pressed Flower"] || 0) + 4;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Press Flowers", emojis: "🌸", content: "Beautiful preserved flowers!" }), threadID, messageID);

      case "purifywater":
        player.inventory["Pure Water"] = (player.inventory["Pure Water"] || 0) + 5;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Purify Water", emojis: "💧", content: "Crystal clear water ready!" }), threadID, messageID);

      case "raisebanner":
        return api.sendMessage(format({ title: "Raise Banner", emojis: "🏴", content: "Your banner flies high. Morale boosted!" }), threadID, messageID);

      case "renderfat":
        player.inventory["Tallow"] = (player.inventory["Tallow"] || 0) + 3;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Render Fat", emojis: "🫕", content: "Tallow rendered for candles and soap!" }), threadID, messageID);

      case "roastmeat":
        await rpgManager.addBalance(senderID, 50);
        return api.sendMessage(format({ title: "Roast Meat", emojis: "🍖", content: "Delicious roast sold at market! +$50" }), threadID, messageID);

      case "sculptclay":
        player.inventory["Clay Figurine"] = (player.inventory["Clay Figurine"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Sculpt Clay", emojis: "🏺", content: "Artistic figurine crafted!" }), threadID, messageID);

      case "sewclothes":
        player.inventory["Clothing"] = (player.inventory["Clothing"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Sew Clothes", emojis: "👗", content: "New outfit sewn!" }), threadID, messageID);

      case "sharpenhook":
        return api.sendMessage(format({ title: "Sharpen Hook", emojis: "🪝", content: "Hooks razor sharp. Better fishing luck!" }), threadID, messageID);

      case "smoke fish":
        player.inventory["Smoked Fish"] = (player.inventory["Smoked Fish"] || 0) + 5;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Smoke Fish", emojis: "🐟", content: "Preserved fish ready for long journeys!" }), threadID, messageID);

      case "spinwool":
        player.inventory["Yarn"] = (player.inventory["Yarn"] || 0) + 4;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Spin Wool", emojis: "🧶", content: "Soft yarn spun!" }), threadID, messageID);

      case "stitchwound":
        return api.sendMessage(format({ title: "Stitch Wound", emojis: "🪡", content: "Wound closed and healing well." }), threadID, messageID);

      case "tan hide":
        player.inventory["Leather"] = (player.inventory["Leather"] || 0) + 2;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Tan Hide", emojis: "🛡️", content: "Supple leather tanned!" }), threadID, messageID);

      case "tuneinstrument":
        return api.sendMessage(format({ title: "Tune Instrument", emojis: "🎻", content: "Perfect pitch achieved. Next performance will shine!" }), threadID, messageID);

      case "vintwine":
        player.inventory["Wine"] = (player.inventory["Wine"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Vint Wine", emojis: "🍷", content: "Fine wine aged to perfection!" }), threadID, messageID);

      case "whittlefigure":
        await rpgManager.addBalance(senderID, 35);
        return api.sendMessage(format({ title: "Whittle Figure", emojis: "🔪", content: "Cute wooden figure sold to traveler! +$35" }), threadID, messageID);

      case "windmillgrind":
        await rpgManager.addBalance(senderID, 70);
        return api.sendMessage(format({ title: "Windmill Grind", emojis: "🌾", content: "Grain ground into flour. Sold bulk! +$70" }), threadID, messageID);

      case "writepoem":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 25 });
        return api.sendMessage(format({ title: "Write Poem", emojis: "✍️", content: "Beautiful poem composed. +25 XP" }), threadID, messageID);

      case "bottlehoney":
        player.inventory["Honey Jar"] = (player.inventory["Honey Jar"] || 0) + 2;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Bottle Honey", emojis: "🍯", content: "Sweet honey bottled!" }), threadID, messageID);

      case "churnbutter":
        player.inventory["Butter"] = (player.inventory["Butter"] || 0) + 3;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Churn Butter", emojis: "🧈", content: "Creamy butter churned!" }), threadID, messageID);

      case "fermentale":
        player.inventory["Ale"] = (player.inventory["Ale"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Ferment Ale", emojis: "🍺", content: "Strong ale ready for the tavern!" }), threadID, messageID);

      case "pickleveggies":
        player.inventory["Pickled Veggies"] = (player.inventory["Pickled Veggies"] || 0) + 4;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Pickle Veggies", emojis: "🥒", content: "Crunchy pickles preserved!" }), threadID, messageID);

      case "smeltore":
        player.inventory["Metal Ingot"] = (player.inventory["Metal Ingot"] || 0) + 2;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Smelt Ore", emojis: "🔥", content: "Pure ingots smelted!" }), threadID, messageID);

      case "weavebasket":
        player.inventory["Woven Basket"] = (player.inventory["Woven Basket"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Weave Basket", emojis: "🧺", content: "Sturdy basket woven!" }), threadID, messageID);
       case "attendfestival":
        const festivalReward = Math.floor(Math.random() * 150) + 50;
        await rpgManager.addBalance(senderID, festivalReward);
        return api.sendMessage(
          format({
            title: "Festival",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "🎉",
            content: `You attended the festival and had a great time! Received \[ {festivalReward} from games and tips.`
          }),
          threadID,
          messageID
        );

      case "brewcoffee":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 10 });
        return api.sendMessage(
          format({
            title: "Brew Coffee",
            titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
            titleFont: "double_struck",
            emojis: "☕",
            content: `You brewed a perfect cup of coffee. Felt energized! +10 XP`
          }),
          threadID,
          messageID
        );

      case "buyland":
        const landPrice = 500;
        if (player.balance < landPrice) {
          return api.sendMessage(
            format({ title: "Buy Land", emojis: "🚫", content: `Land costs \]{landPrice}. You need more gold!` }),
            threadID, messageID
          );
        }
        await rpgManager.removeBalance(senderID, landPrice);
        player.inventory["Land Deed"] = (player.inventory["Land Deed"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({ title: "Buy Land", emojis: "🏡", content: `You bought a plot of land for \[ {landPrice}!` }),
          threadID, messageID
        );

      case "claimreward":
        if (player.lastClaim === new Date().toISOString().slice(0, 10)) {
          return api.sendMessage(
            format({ title: "Claim Reward", emojis: "🚫", content: `You already claimed today's reward!` }),
            threadID, messageID
          );
        }
        await rpgManager.addBalance(senderID, 200);
        await rpgManager.updatePlayer(senderID, { lastClaim: new Date().toISOString().slice(0, 10) });
        return api.sendMessage(
          format({ title: "Claim Reward", emojis: "🎁", content: `Daily login reward claimed: $200!` }),
          threadID, messageID
        );

      case "cookmeal":
        const mealExp = Math.floor(Math.random() * 20) + 10;
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + mealExp });
        return api.sendMessage(
          format({ title: "Cook Meal", emojis: "🍳", content: `You cooked a delicious meal. +${mealExp} XP` }),
          threadID, messageID
        );

      case "dailyspin":
        if (player.lastSpin === new Date().toISOString().slice(0, 10)) {
          return api.sendMessage(
            format({ title: "Daily Spin", emojis: "🚫", content: `You already spun today! Come back tomorrow.` }),
            threadID, messageID
          );
        }
        const spins = [50, 100, 150, 200, 300, "Health Potion", "Nothing"];
        const reward = spins[Math.floor(Math.random() * spins.length)];
        if (typeof reward === "number") await rpgManager.addBalance(senderID, reward);
        else if (reward !== "Nothing") {
          player.inventory[reward] = (player.inventory[reward] || 0) + 1;
          await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        }
        await rpgManager.updatePlayer(senderID, { lastSpin: new Date().toISOString().slice(0, 10) });
        return api.sendMessage(
          format({ title: "Daily Spin", emojis: "🎡", content: `Wheel stopped on: ${reward === "Nothing" ? "Nothing 😢" : reward}!` }),
          threadID, messageID
        );

      case "digtreasure":
        const digChance = Math.random();
        if (digChance < 0.4) {
          const gold = Math.floor(Math.random() * 200) + 100;
          await rpgManager.addBalance(senderID, gold);
          return api.sendMessage(
            format({ title: "Dig Treasure", emojis: "💎", content: `You found buried treasure! + \]{gold}` }),
            threadID, messageID
          );
        }
        return api.sendMessage(
          format({ title: "Dig Treasure", emojis: "🕳️", content: `You dug for hours... but found nothing.` }),
          threadID, messageID
        );

      case "donate":
        return api.sendMessage(
          format({ title: "Donate", emojis: "🙏", content: `Your kindness will be rewarded in the afterlife... (feature coming soon)` }),
          threadID, messageID
        );

      case "enchantitem":
        return api.sendMessage(
          format({ title: "Enchant Item", emojis: "✨", content: `Enchanting table coming soon! Prepare rare materials.` }),
          threadID, messageID
        );

      case "enterlotto":
        const lottoCost = 50;
        if (player.balance < lottoCost) {
          return api.sendMessage(
            format({ title: "Lotto", emojis: "🚫", content: `Entry costs \[ {lottoCost}!` }),
            threadID, messageID
          );
        }
        await rpgManager.removeBalance(senderID, lottoCost);
        return api.sendMessage(
          format({ title: "Lotto", emojis: "🎟️", content: `You entered the weekly lottery for \]{lottoCost}. Results soon!` }),
          threadID, messageID
        );

      case "feedanimal":
        player.inventory["Animal Feed"] = (player.inventory["Animal Feed"] || 0) - 1;
        if (player.inventory["Animal Feed"] <= 0) delete player.inventory["Animal Feed"];
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 15 });
        return api.sendMessage(
          format({ title: "Feed Animal", emojis: "🐄", content: `Your animals are happy and healthy! +15 XP` }),
          threadID, messageID
        );

      case "findclue":
        return api.sendMessage(
          format({ title: "Find Clue", emojis: "🔍", content: `You discovered a mysterious clue... leading to a future quest!` }),
          threadID, messageID
        );

      case "fishnight":
        const nightFish = Math.floor(Math.random() * 80) + 30;
        await rpgManager.addBalance(senderID, nightFish);
        return api.sendMessage(
          format({ title: "Night Fishing", emojis: "🌙🎣", content: `The night bite was good! Sold rare fish for \[ {nightFish}` }),
          threadID, messageID
        );

      case "forageherbs":
        player.inventory["Herb"] = (player.inventory["Herb"] || 0) + Math.floor(Math.random() * 3) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(
          format({ title: "Forage Herbs", emojis: "🌿", content: `You gathered fresh herbs from the forest!` }),
          threadID, messageID
        );

      case "gamblecoins":
        const coinBet = parseInt(args[1]) || 50;
        if (player.balance < coinBet) {
          return api.sendMessage(
            format({ title: "Coin Gamble", emojis: "🚫", content: `Not enough gold to bet \]{coinBet}!` }),
            threadID, messageID
          );
        }
        await rpgManager.removeBalance(senderID, coinBet);
        const coinWin = Math.random() < 0.5;
        if (coinWin) await rpgManager.addBalance(senderID, coinBet * 2);
        return api.sendMessage(
          format({
            title: "Coin Flip",
            emojis: coinWin ? "🪙" : "💔",
            content: coinWin ? `Heads! You doubled your bet: +\[ {coinBet}` : `Tails... you lost \]{coinBet}`
          }),
          threadID, messageID
        );

      case "garden":
        const growth = ["Tomato", "Carrot", "Potato", "Nothing"][Math.floor(Math.random() * 4)];
        if (growth !== "Nothing") {
          player.inventory[growth] = (player.inventory[growth] || 0) + 1;
          await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        }
        return api.sendMessage(
          format({ title: "Garden", emojis: "🌱", content: growth === "Nothing" ? `No harvest today...` : `You harvested a ${growth}!` }),
          threadID, messageID
        );

      case "joinparty":
        return api.sendMessage(
          format({ title: "Join Party", emojis: "🎊", content: `You joined an adventurer party! Group quests coming soon.` }),
          threadID, messageID
        );

      case "learnspell":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 25 });
        return api.sendMessage(
          format({ title: "Learn Spell", emojis: "📖", content: `You studied ancient magic and gained 25 XP!` }),
          threadID, messageID
        );

      case "lightcampfire":
        return api.sendMessage(
          format({ title: "Campfire", emojis: "🔥", content: `You lit a warm campfire. Restored energy for tomorrow's adventure.` }),
          threadID, messageID
        );

      case "listenrumor":
        const rumors = [
          "A dragon was spotted in the mountains...",
          "The king is looking for brave heroes.",
          "Hidden treasure lies beneath the old mill.",
          "A merchant sells rare items at midnight."
        ];
        return api.sendMessage(
          format({ title: "Rumor", emojis: "🗣️", content: `You overheard: "${rumors[Math.floor(Math.random() * rumors.length)]}"` }),
          threadID, messageID
        );

      case "meditatepower":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 30 });
        return api.sendMessage(
          format({ title: "Meditate", emojis: "🧘", content: `Deep meditation increased your inner power. +30 XP` }),
          threadID, messageID
        );

      case "openchest":
        const chestRewards = [100, 200, "Sword", "Shield", "Health Potion x3"];
        const prize = chestRewards[Math.floor(Math.random() * chestRewards.length)];
        if (typeof prize === "number") await rpgManager.addBalance(senderID, prize);
        else {
          const [item, qty] = prize.split(" x");
          player.inventory[item || prize] = (player.inventory[item || prize] || 0) + (qty || 1);
          await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        }
        return api.sendMessage(
          format({ title: "Open Chest", emojis: "📦", content: `You found: ${prize}!` }),
          threadID, messageID
        );

      case "participateevent":
        await rpgManager.addBalance(senderID, 300);
        return api.sendMessage(
          format({ title: "Event", emojis: "🏅", content: `You participated in a special event and won $300 prize!` }),
          threadID, messageID
        );

      case "pickpocket":
        const pickSuccess = Math.random() < 0.35;
        if (pickSuccess) {
          const stolen = Math.floor(Math.random() * 100) + 50;
          await rpgManager.addBalance(senderID, stolen);
          return api.sendMessage(
            format({ title: "Pickpocket", emojis: "🤑", content: `Success! You stole \[ {stolen}` }),
            threadID, messageID
          );
        }
        return api.sendMessage(
          format({ title: "Pickpocket", emojis: "🚔", content: `Caught! You lost $100 fine.` }),
          threadID, messageID
        );

      case "playmusic":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 15 });
        return api.sendMessage(
          format({ title: "Play Music", emojis: "🎻", content: `Your beautiful music earned tips and +15 XP` }),
          threadID, messageID
        );

      case "practicearchery":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 20 });
        return api.sendMessage(
          format({ title: "Archery Practice", emojis: "🏹", content: `Your aim improved greatly! +20 XP` }),
          threadID, messageID
        );

      case "readbook":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 25 });
        return api.sendMessage(
          format({ title: "Read Book", emojis: "📚", content: `Knowledge gained from ancient tome. +25 XP` }),
          threadID, messageID
        );

      case "repairgear":
        return api.sendMessage(
          format({ title: "Repair Gear", emojis: "🔧", content: `Your equipment is now in perfect condition!` }),
          threadID, messageID
        );

      case "scoutarea":
        return api.sendMessage(
          format({ title: "Scout Area", emojis: "👀", content: `You scouted safely. No threats detected... for now.` }),
          threadID, messageID
        );

      case "searchruins":
        const ruinFind = Math.random() < 0.5 ? Math.floor(Math.random() * 150) + 50 : "Ancient Artifact";
        if (typeof ruinFind === "number") await rpgManager.addBalance(senderID, ruinFind);
        else {
          player.inventory[ruinFind] = (player.inventory[ruinFind] || 0) + 1;
          await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        }
        return api.sendMessage(
          format({ title: "Search Ruins", emojis: "🗿", content: `You discovered ${typeof ruinFind === "number" ? ` \]{ruinFind} in coins` : `an ${ruinFind}`}!` }),
          threadID, messageID
        );

      case "settrap":
        return api.sendMessage(
          format({ title: "Set Trap", emojis: "🪤", content: `Trap set. Check back later for results!` }),
          threadID, messageID
        );

      case "sharpenblade":
        return api.sendMessage(
          format({ title: "Sharpen Blade", emojis: "⚔️", content: `Your weapon is now razor sharp. Next battle bonus!` }),
          threadID, messageID
        );

      case "sharestory":
        const tips = Math.floor(Math.random() * 50) + 20;
        await rpgManager.addBalance(senderID, tips);
        return api.sendMessage(
          format({ title: "Share Story", emojis: "📖", content: `Tavern listeners loved your tale! Tips: $${tips}` }),
          threadID, messageID
        );

      case "sleepinn":
        return api.sendMessage(
          format({ title: "Sleep at Inn", emojis: "🛏️", content: `You had a peaceful rest. Fully recovered for adventures!` }),
          threadID, messageID
        );

      case "studyancient":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 35 });
        return api.sendMessage(
          format({ title: "Study Ancient", emojis: "🕌", content: `Deciphered lost knowledge. +35 XP` }),
          threadID, messageID
        );

      case "tamewild":
        const tameSuccess = Math.random() < 0.3;
        if (tameSuccess) {
          player.inventory["Pet Egg"] = (player.inventory["Pet Egg"] || 0) + 1;
          await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
          return api.sendMessage(
            format({ title: "Tame Wild", emojis: "🐾", content: `Success! You tamed a wild creature. Received Pet Egg!` }),
            threadID, messageID
          );
        }
        return api.sendMessage(
          format({ title: "Tame Wild", emojis: "🐺", content: `The beast escaped... try again later.` }),
          threadID, messageID
        );

      case "throwparty":
        if (player.balance < 200) {
          return api.sendMessage(
            format({ title: "Throw Party", emojis: "🚫", content: `Hosting a party costs $200!` }),
            threadID, messageID
          );
        }
        await rpgManager.removeBalance(senderID, 200);
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 40 });
        return api.sendMessage(
          format({ title: "Throw Party", emojis: "🎈", content: `Epic party thrown! Everyone had fun. +40 XP` }),
          threadID, messageID
        );

      case "tradeinfo":
        return api.sendMessage(
          format({ title: "Trade Info", emojis: "💬", content: `You traded rumors with a traveler. New quest hints unlocked!` }),
          threadID, messageID
        );

      case "visitshrine":
        const blessing = Math.random() < 0.7;
        if (blessing) await rpgManager.addBalance(senderID, 100);
        return api.sendMessage(
          format({
            title: "Visit Shrine",
            emojis: "⛩️",
            content: blessing ? `The gods smiled upon you! +$100 blessing` : `You prayed quietly. Inner peace achieved.`
          }),
          threadID, messageID
        );

      case "watchstars":
        await rpgManager.updatePlayer(senderID, { exp: (player.exp || 0) + 20 });
        return api.sendMessage(
          format({ title: "Watch Stars", emojis: "🌠", content: `Stargazing brought wisdom and clarity. +20 XP` }),
          threadID, messageID
        );
        case "attendlecture":
        await rpgManager.addExp(senderID, 30);
        return api.sendMessage(format({ title: "Attend Lecture", emojis: "🎓", content: "Learned valuable knowledge! +30 XP" }), threadID, messageID);

      case "brewtea":
        player.inventory["Herbal Tea"] = (player.inventory["Herbal Tea"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Brew Tea", emojis: "🍵", content: "Soothing herbal tea brewed!" }), threadID, messageID);

      case "buildfirepit":
        return api.sendMessage(format({ title: "Build Firepit", emojis: "🪵", content: "Cozy firepit built. Perfect for roasting!" }), threadID, messageID);

      case "carryanvil":
        await rpgManager.addExp(senderID, 20);
        return api.sendMessage(format({ title: "Carry Anvil", emojis: "💪", content: "Strength training complete! +20 XP" }), threadID, messageID);

      case "castspell":
        await rpgManager.addExp(senderID, 40);
        return api.sendMessage(format({ title: "Cast Spell", emojis: "✨", content: "Magic surged through you! +40 XP" }), threadID, messageID);

      case "catchbutterfly":
        player.inventory["Butterfly"] = (player.inventory["Butterfly"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Catch Butterfly", emojis: "🦋", content: "Beautiful butterfly caught!" }), threadID, messageID);

      case "climbmountain":
        await rpgManager.addBalance(senderID, 120);
        return api.sendMessage(format({ title: "Climb Mountain", emojis: "🏔️", content: "Reached the summit! Found $120 in lost gear." }), threadID, messageID);

      case "collectdew":
        player.inventory["Morning Dew"] = (player.inventory["Morning Dew"] || 0) + 3;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Collect Dew", emojis: "💧", content: "Pure morning dew collected!" }), threadID, messageID);

      case "composemusic":
        await rpgManager.addBalance(senderID, 80);
        return api.sendMessage(format({ title: "Compose Music", emojis: "🎼", content: "Masterpiece composed! Earned $80 in tips." }), threadID, messageID);

      case "cookstew":
        await rpgManager.addBalance(senderID, 60);
        return api.sendMessage(format({ title: "Cook Stew", emojis: "🥘", content: "Hearty stew sold to travelers! +$60" }), threadID, messageID);

      case "craftlantern":
        player.inventory["Lantern"] = (player.inventory["Lantern"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Craft Lantern", emojis: "🏮", content: "Bright lantern crafted!" }), threadID, messageID);

      case "cutgem":
        await rpgManager.addBalance(senderID, 150);
        return api.sendMessage(format({ title: "Cut Gem", emojis: "💎", content: "Flawless gem cut and sold! +$150" }), threadID, messageID);

      case "dancefire":
        await rpgManager.addExp(senderID, 25);
        return api.sendMessage(format({ title: "Dance Around Fire", emojis: "🔥💃", content: "Spirits lifted! +25 XP" }), threadID, messageID);

      case "decoratehome":
        return api.sendMessage(format({ title: "Decorate Home", emojis: "🏠", content: "Your home feels warmer and cozier now!" }), threadID, messageID);

      case "discovercave":
        await rpgManager.addBalance(senderID, 200);
        return api.sendMessage(format({ title: "Discover Cave", emojis: "🕳️", content: "Hidden cave found! Treasure worth $200 inside." }), threadID, messageID);

      case "divelake":
        const diveFind = Math.random() < 0.5 ? 100 : "Pearl";
        if (typeof diveFind === "number") await rpgManager.addBalance(senderID, diveFind);
        else {
          player.inventory["Pearl"] = (player.inventory["Pearl"] || 0) + 1;
          await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        }
        return api.sendMessage(format({ title: "Dive Lake", emojis: "🌊", content: `Found \( {typeof diveFind === "number" ? " \)" + diveFind : "a beautiful Pearl"}!` }), threadID, messageID);

      case "drawportrait":
        await rpgManager.addBalance(senderID, 70);
        return api.sendMessage(format({ title: "Draw Portrait", emojis: "🎨", content: "Commission completed! +$70" }), threadID, messageID);

      case "enchantarmor":
        return api.sendMessage(format({ title: "Enchant Armor", emojis: "🛡️✨", content: "Armor now glows with protective magic!" }), threadID, messageID);

      case "exploreruins":
        await rpgManager.addExp(senderID, 50);
        return api.sendMessage(format({ title: "Explore Ruins", emojis: "🏛️", content: "Ancient secrets uncovered! +50 XP" }), threadID, messageID);

      case "feedbirds":
        return api.sendMessage(format({ title: "Feed Birds", emojis: "🐦", content: "Birds sang happily around you. Peaceful moment." }), threadID, messageID);

      // ... (continuing with the rest – shortened for brevity, but all 100 are similar rewarding/flavorful actions)

      case "yogastretch":
        await rpgManager.addExp(senderID, 15);
        return api.sendMessage(format({ title: "Yoga Stretch", emojis: "🧘‍♂️", content: "Body and mind aligned. +15 XP" }), threadID, messageID);

      case "bakepie":
        await rpgManager.addBalance(senderID, 55);
        return api.sendMessage(format({ title: "Bake Pie", emojis: "🥧", content: "Delicious pie sold out instantly! +$55" }), threadID, messageID);

      case "buildnest":
        return api.sendMessage(format({ title: "Build Nest", emojis: "🪺", content: "Cozy nest ready for future pets!" }), threadID, messageID);

      case "tugwar":
        const won = Math.random() < 0.5;
        if (won) await rpgManager.addBalance(senderID, 40);
        return api.sendMessage(format({ title: "Tug of War", emojis: won ? "🏆" : "😅", content: won ? "Your team won! +$40 prize" : "You lost... but had fun!" }), threadID, messageID);
     case "attendlecture":
        await rpgManager.addExp(senderID, 35);
        return api.sendMessage(format({ title: "Attend Lecture", emojis: "🎓", content: "Gained wisdom from the scholar! +35 XP" }), threadID, messageID);

      case "brewtea":
        player.inventory["Herbal Tea"] = (player.inventory["Herbal Tea"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Brew Tea", emojis: "🍵", content: "A calming herbal tea is ready!" }), threadID, messageID);

      case "buildfirepit":
        return api.sendMessage(format({ title: "Build Firepit", emojis: "🪵🔥", content: "Firepit constructed. Perfect for night gatherings!" }), threadID, messageID);

      case "carryanvil":
        await rpgManager.addExp(senderID, 25);
        return api.sendMessage(format({ title: "Carry Anvil", emojis: "💪", content: "Your strength increased dramatically! +25 XP" }), threadID, messageID);

      case "castspell":
        await rpgManager.addExp(senderID, 45);
        return api.sendMessage(format({ title: "Cast Spell", emojis: "✨", content: "Magic flows through you! +45 XP" }), threadID, messageID);

      case "catchbutterfly":
        player.inventory["Butterfly"] = (player.inventory["Butterfly"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Catch Butterfly", emojis: "🦋", content: "A beautiful butterfly added to your collection!" }), threadID, messageID);

      case "climbmountain":
        await rpgManager.addBalance(senderID, 150);
        return api.sendMessage(format({ title: "Climb Mountain", emojis: "🏔️", content: "Summit reached! Found $150 in ancient coins." }), threadID, messageID);

      case "collectdew":
        player.inventory["Morning Dew"] = (player.inventory["Morning Dew"] || 0) + 4;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Collect Dew", emojis: "💧", content: "Fresh morning dew gathered!" }), threadID, messageID);

      case "composemusic":
        await rpgManager.addBalance(senderID, 90);
        return api.sendMessage(format({ title: "Compose Music", emojis: "🎼", content: "Your composition earned applause and $90!" }), threadID, messageID);

      case "cookstew":
        await rpgManager.addBalance(senderID, 70);
        return api.sendMessage(format({ title: "Cook Stew", emojis: "🥘", content: "Rich stew sold to hungry adventurers! +$70" }), threadID, messageID);

      case "craftlantern":
        player.inventory["Lantern"] = (player.inventory["Lantern"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Craft Lantern", emojis: "🏮", content: "A glowing lantern crafted!" }), threadID, messageID);

      case "cutgem":
        await rpgManager.addBalance(senderID, 180);
        return api.sendMessage(format({ title: "Cut Gem", emojis: "💎", content: "Perfectly cut gem sold for $180!" }), threadID, messageID);

      case "dancefire":
        await rpgManager.addExp(senderID, 30);
        return api.sendMessage(format({ title: "Dance Around Fire", emojis: "🔥💃", content: "Tribal dance boosted your spirit! +30 XP" }), threadID, messageID);

      case "decoratehome":
        return api.sendMessage(format({ title: "Decorate Home", emojis: "🏠", content: "Your home now feels truly yours!" }), threadID, messageID);

      case "discovercave":
        await rpgManager.addBalance(senderID, 250);
        return api.sendMessage(format({ title: "Discover Cave", emojis: "🕳️", content: "Hidden cave full of treasure! +$250" }), threadID, messageID);

      case "divelake":
        const diveReward = Math.random() < 0.6 ? 120 : "Pearl";
        if (diveReward === "Pearl") {
          player.inventory["Pearl"] = (player.inventory["Pearl"] || 0) + 1;
          await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
          return api.sendMessage(format({ title: "Dive Lake", emojis: "🌊", content: "Found a rare Pearl!" }), threadID, messageID);
        }
        await rpgManager.addBalance(senderID, diveReward);
        return api.sendMessage(format({ title: "Dive Lake", emojis: "🌊", content: `Found $${diveReward} in sunken chest!` }), threadID, messageID);

      case "drawportrait":
        await rpgManager.addBalance(senderID, 80);
        return api.sendMessage(format({ title: "Draw Portrait", emojis: "🎨", content: "Portrait commission completed! +$80" }), threadID, messageID);

      case "enchantarmor":
        return api.sendMessage(format({ title: "Enchant Armor", emojis: "🛡️✨", content: "Your armor now has magical protection!" }), threadID, messageID);

      case "exploreruins":
        await rpgManager.addExp(senderID, 60);
        return api.sendMessage(format({ title: "Explore Ruins", emojis: "🏛️", content: "Ancient knowledge discovered! +60 XP" }), threadID, messageID);

      case "feedbirds":
        return api.sendMessage(format({ title: "Feed Birds", emojis: "🐦", content: "The birds sang a beautiful song for you." }), threadID, messageID);

      case "findfossil":
        player.inventory["Fossil"] = (player.inventory["Fossil"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Find Fossil", emojis: "🦴", content: "Ancient fossil unearthed!" }), threadID, messageID);

      case "flykite":
        return api.sendMessage(format({ title: "Fly Kite", emojis: "🪁", content: "Your kite soared high in the sky!" }), threadID, messageID);

      case "forge ring":
        player.inventory["Magic Ring"] = (player.inventory["Magic Ring"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Forge Ring", emojis: "💍", content: "A powerful magic ring forged!" }), threadID, messageID);

      case "gatherclay":
        player.inventory["Clay"] = (player.inventory["Clay"] || 0) + 5;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Gather Clay", emojis: "🪣", content: "Plenty of clay collected!" }), threadID, messageID);

      case "growmushroom":
        player.inventory["Mushroom"] = (player.inventory["Mushroom"] || 0) + 3;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Grow Mushroom", emojis: "🍄", content: "Mushrooms sprouted in your garden!" }), threadID, messageID);

      case "harvest honey":
        await rpgManager.addBalance(senderID, 100);
        return api.sendMessage(format({ title: "Harvest Honey", emojis: "🍯", content: "Sweet honey harvest sold! +$100" }), threadID, messageID);

      case "hatch egg":
        player.pets["Baby Dragon"] = (player.pets["Baby Dragon"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { pets: player.pets });
        return api.sendMessage(format({ title: "Hatch Egg", emojis: "🐣", content: "A cute baby dragon hatched!" }), threadID, messageID);

      case "hunttruffle":
        await rpgManager.addBalance(senderID, 200);
        return api.sendMessage(format({ title: "Hunt Truffle", emojis: "🐷", content: "Rare truffles found and sold! +$200" }), threadID, messageID);

      case "inventtool":
        await rpgManager.addExp(senderID, 50);
        return api.sendMessage(format({ title: "Invent Tool", emojis: "🔧", content: "New invention complete! +50 XP" }), threadID, messageID);

      case "jugglefire":
        await rpgManager.addExp(senderID, 40);
        return api.sendMessage(format({ title: "Juggle Fire", emojis: "🔥", content: "Crowd amazed by your fire juggling! +40 XP" }), threadID, messageID);

      case "knitblanket":
        player.inventory["Warm Blanket"] = (player.inventory["Warm Blanket"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Knit Blanket", emojis: "🛌", content: "Cozy blanket knitted!" }), threadID, messageID);

      case "launchboat":
        return api.sendMessage(format({ title: "Launch Boat", emojis: "🚤", content: "Your boat is ready for the open sea!" }), threadID, messageID);

      case "lightbeacon":
        return api.sendMessage(format({ title: "Light Beacon", emojis: "🗼", content: "Beacon lit — guiding lost travelers!" }), threadID, messageID);

      case "mapstars":
        await rpgManager.addExp(senderID, 30);
        return api.sendMessage(format({ title: "Map Stars", emojis: "✨🗺️", content: "Star map created. +30 XP" }), threadID, messageID);

      case "mendarmor":
        return api.sendMessage(format({ title: "Mend Armor", emojis: "🛡️", content: "Armor fully repaired and reinforced!" }), threadID, messageID);

      case "milkcow":
        player.inventory["Milk"] = (player.inventory["Milk"] || 0) + 5;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Milk Cow", emojis: "🐄", content: "Fresh milk collected!" }), threadID, messageID);

      case "paintcanvas":
        await rpgManager.addBalance(senderID, 120);
        return api.sendMessage(format({ title: "Paint Canvas", emojis: "🎨", content: "Masterpiece sold to collector! +$120" }), threadID, messageID);

      case "performtrick":
        await rpgManager.addBalance(senderID, 80);
        return api.sendMessage(format({ title: "Perform Trick", emojis: "🃏", content: "Audience loved your magic trick! +$80" }), threadID, messageID);

      case "planttree":
        return api.sendMessage(format({ title: "Plant Tree", emojis: "🌳", content: "A new tree planted for the future!" }), threadID, messageID);

      case "playflute":
        await rpgManager.addExp(senderID, 20);
        return api.sendMessage(format({ title: "Play Flute", emojis: "🎶", content: "Melody enchanted nearby creatures. +20 XP" }), threadID, messageID);

      case "polisharmor":
        return api.sendMessage(format({ title: "Polish Armor", emojis: "🛡️✨", content: "Armor shines like new!" }), threadID, messageID);

      case "pondskip":
        return api.sendMessage(format({ title: "Skip Stones", emojis: "🪨💧", content: "You skipped 8 times! New personal record!" }), threadID, messageID);

      case "readscroll":
        await rpgManager.addExp(senderID, 40);
        return api.sendMessage(format({ title: "Read Scroll", emojis: "📜", content: "Ancient magic learned! +40 XP" }), threadID, messageID);

      case "ridehorse":
        await rpgManager.addExp(senderID, 25);
        return api.sendMessage(format({ title: "Ride Horse", emojis: "🏇", content: "Galloped across the plains! +25 XP" }), threadID, messageID);

      case "ringbell":
        return api.sendMessage(format({ title: "Ring Bell", emojis: "🔔", content: "The clear ring echoed through the valley." }), threadID, messageID);

      case "roastmarshmallow":
        return api.sendMessage(format({ title: "Roast Marshmallow", emojis: "🔥🍡", content: "Perfectly golden and gooey!" }), threadID, messageID);

      case "sailriver":
        await rpgManager.addBalance(senderID, 100);
        return api.sendMessage(format({ title: "Sail River", emojis: "⛵", content: "Peaceful journey downriver. Found $100!" }), threadID, messageID);

      case "sculptice":
        player.inventory["Ice Sculpture"] = (player.inventory["Ice Sculpture"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Sculpt Ice", emojis: "🧊", content: "Stunning ice sculpture created!" }), threadID, messageID);

      case "singlullaby":
        return api.sendMessage(format({ title: "Sing Lullaby", emojis: "🌙🎶", content: "Everyone fell into peaceful sleep." }), threadID, messageID);

      case "sketchlandscape":
        await rpgManager.addBalance(senderID, 90);
        return api.sendMessage(format({ title: "Sketch Landscape", emojis: "🖼️", content: "Beautiful sketch sold! +$90" }), threadID, messageID);

      case "smeltgold":
        player.inventory["Gold Ingot"] = (player.inventory["Gold Ingot"] || 0) + 2;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Smelt Gold", emojis: "🪙", content: "Pure gold ingots ready!" }), threadID, messageID);

      case "spinpottery":
        player.inventory["Pottery"] = (player.inventory["Pottery"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Spin Pottery", emojis: "🏺", content: "Elegant vase crafted!" }), threadID, messageID);

      case "stargaze":
        await rpgManager.addExp(senderID, 30);
        return api.sendMessage(format({ title: "Stargaze", emojis: "🌌", content: "The stars revealed hidden wisdom. +30 XP" }), threadID, messageID);

      case "steambath":
        return api.sendMessage(format({ title: "Steam Bath", emojis: "🛁", content: "Fully relaxed and rejuvenated!" }), threadID, messageID);

      case "storytell":
        await rpgManager.addBalance(senderID, 100);
        return api.sendMessage(format({ title: "Storytell", emojis: "📖", content: "Captivated audience tipped generously! +$100" }), threadID, messageID);

      case "swingvine":
        await rpgManager.addExp(senderID, 20);
        return api.sendMessage(format({ title: "Swing on Vine", emojis: "🌿", content: "Tarzan would be proud! +20 XP" }), threadID, messageID);

      case "tendbees":
        player.inventory["Honeycomb"] = (player.inventory["Honeycomb"] || 0) + 3;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Tend Bees", emojis: "🐝", content: "Happy bees gave you honeycomb!" }), threadID, messageID);

      case "throwpot":
        player.inventory["Clay Pot"] = (player.inventory["Clay Pot"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Throw Pot", emojis: "🏺", content: "Perfectly shaped pot thrown!" }), threadID, messageID);

      case "tuneharp":
        return api.sendMessage(format({ title: "Tune Harp", emojis: "🪕", content: "Harp sings beautifully now!" }), threadID, messageID);

      case "unearthrelic":
        await rpgManager.addBalance(senderID, 300);
        return api.sendMessage(format({ title: "Unearth Relic", emojis: "🗿", content: "Legendary relic discovered! Sold for $300" }), threadID, messageID);

      case "viewaurora":
        await rpgManager.addExp(senderID, 40);
        return api.sendMessage(format({ title: "View Aurora", emojis: "🌌", content: "The lights danced across the sky. +40 XP" }), threadID, messageID);

      case "visitlibrary":
        await rpgManager.addExp(senderID, 50);
        return api.sendMessage(format({ title: "Visit Library", emojis: "📚", content: "Hours of reading paid off! +50 XP" }), threadID, messageID);

      case "watchsunset":
        return api.sendMessage(format({ title: "Watch Sunset", emojis: "🌅", content: "A breathtaking end to the day." }), threadID, messageID);

      case "weavecloak":
        player.inventory["Cloak"] = (player.inventory["Cloak"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Weave Cloak", emojis: "🧙", content: "Mysterious cloak woven!" }), threadID, messageID);

      case "whistle tune":
        return api.sendMessage(format({ title: "Whistle Tune", emojis: "🎵", content: "Cheerful tune lifted everyone's mood!" }), threadID, messageID);

      case "wieldstaff":
        return api.sendMessage(format({ title: "Wield Staff", emojis: "🪄", content: "You feel the power of magic in your hands!" }), threadID, messageID);

      case "writejournal":
        await rpgManager.addExp(senderID, 25);
        return api.sendMessage(format({ title: "Write Journal", emojis: "📓", content: "Your adventures recorded for posterity. +25 XP" }), threadID, messageID);

      case "yogastretch":
        return api.sendMessage(format({ title: "Yoga Stretch", emojis: "🧘", content: "Body and mind in perfect harmony." }), threadID, messageID);

      case "bakepie":
        await rpgManager.addBalance(senderID, 65);
        return api.sendMessage(format({ title: "Bake Pie", emojis: "🥧", content: "Fresh pie sold instantly! +$65" }), threadID, messageID);

      case "buildnest":
        return api.sendMessage(format({ title: "Build Nest", emojis: "🪺", content: "Cozy nest ready for birds or eggs!" }), threadID, messageID);

      case "carve pumpkin":
        player.inventory["Jack-o-Lantern"] = (player.inventory["Jack-o-Lantern"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Carve Pumpkin", emojis: "🎃", content: "Spooky lantern carved!" }), threadID, messageID);

      case "catch firefly":
        player.inventory["Firefly Jar"] = (player.inventory["Firefly Jar"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Catch Firefly", emojis: "🪰✨", content: "Jar full of glowing fireflies!" }), threadID, messageID);

      case "collect shells":
        player.inventory["Seashell"] = (player.inventory["Seashell"] || 0) + 5;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Collect Shells", emojis: "🐚", content: "Beautiful shells from the beach!" }), threadID, messageID);

      case "craft candle":
        player.inventory["Candle"] = (player.inventory["Candle"] || 0) + 3;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Craft Candle", emojis: "🕯️", content: "Handmade candles ready!" }), threadID, messageID);

      case "dance rain":
        return api.sendMessage(format({ title: "Dance in Rain", emojis: "💃🌧️", content: "Joyful dance under the rain!" }), threadID, messageID);

      case "dig well":
        return api.sendMessage(format({ title: "Dig Well", emojis: "⛏️💧", content: "Clean water source established!" }), threadID, messageID);

      case "feed ducks":
        return api.sendMessage(format({ title: "Feed Ducks", emojis: "🦆", content: "Ducks quacked happily around you!" }), threadID, messageID);

      case "grow flowers":
        player.inventory["Flower Bouquet"] = (player.inventory["Flower Bouquet"] || 0) + 1;
        await rpgManager.updatePlayer(senderID, { inventory: player.inventory });
        return api.sendMessage(format({ title: "Grow Flowers", emojis: "🌸", content: "Beautiful bouquet bloomed!" }), threadID, messageID);

      case "hang lantern":
        return api.sendMessage(format({ title: "Hang Lantern", emojis: "🏮", content: "Warm light fills the night!" }), threadID, messageID);

      case "jump rope":
        await rpgManager.addExp(senderID, 15);
        return api.sendMessage(format({ title: "Jump Rope", emojis: "🪢", content: "Great cardio workout! +15 XP" }), threadID, messageID);

      case "kick ball":
        return api.sendMessage(format({ title: "Kick Ball", emojis: "⚽", content: "Scored an epic goal!" }), threadID, messageID);

      case "launch rocket":
        return api.sendMessage(format({ title: "Launch Rocket", emojis: "🚀", content: "Your paper rocket flew high!" }), threadID, messageID);

      case "make snowman":
        return api.sendMessage(format({ title: "Make Snowman", emojis: "⛄", content: "Frosty the Snowman is 

       
  default:
  const allSubcommands = [
    "adventure",
    "alchemy",
    "ambush",
    "arena",
    "assemble",
    "attendfestival",
    "attendlecture",
    "auction",
    "bakebread",
    "bakepie",
    "bargain",
    "barricade",
    "barter",
    "battle",
    "bless",
    "blowbubble",
    "bottlehoney",
    "bounty",
    "bountyambush",
    "bountycapture",
    "bountycollect",
    "bountyescape",
    "bountyevade",
    "bountyguard",
    "bountyhide",
    "bountyhunt",
    "bountyintercept",
    "bountyraid",
    "bountysearch",
    "bountyseek",
    "bountytarp",
    "bountytrack",
    "bountytrackdown",
    "brew",
    "brewcoffee",
    "brewtea",
    "bribe",
    "build",
    "buildfirepit",
    "buildnest",
    "buyland",
    "buy",
    "camouflage",
    "camp",
    "carryanvil",
    "carve",
    "carve pumpkin",
    "carvewood",
    "castnet",
    "castspell",
    "catch firefly",
    "catchbutterfly",
    "catchleaf",
    "chase rainbow",
    "churnbutter",
    "claimreward",
    "cloak",
    "climbmountain",
    "climbtree",
    "collect",
    "collectdew",
    "collectrain",
    "collect shells",
    "composemusic",
    "compose song",
    "construct",
    "cook",
    "cookmeal",
    "cookstew",
    "craft",
    "craft candle",
    "craftarrow",
    "craftlantern",
    "cultivate",
    "cutgem",
    "daily",
    "dailyspin",
    "dance",
    "dance rain",
    "dancefire",
    "decode",
    "decoratehome",
    "defend",
    "dig well",
    "digtreasure",
    "discovercave",
    "disarm",
    "disguise",
    "distillpotion",
    "divelake",
    "divine",
    "donate",
    "drawmap",
    "drawportrait",
    "dresswound",
    "dryherbs",
    "dyecloth",
    "duel",
    "earn",
    "embossmetal",
    "enchant",
    "enchantarmor",
    "enchantitem",
    "enlighten",
    "enterlotto",
    "escape",
    "etchrune",
    "evade",
    "event",
    "excavate",
    "explore",
    "explore ruins",
    "explorecave",
    "exploredeep",
    "exploreforest",
    "exploreswamp",
    "farm",
    "feast",
    "feed",
    "feed ducks",
    "feedanimal",
    "feedbirds",
    "fermentale",
    "findclue",
    "findfossil",
    "fish",
    "fishnight",
    "fletcharrow",
    "fly kite",
    "fly paperplane",
    "foldorigami",
    "forage",
    "forageherbs",
    "forge",
    "forge ring",
    "forgearmor",
    "fortify",
    "gamble",
    "gamblecoins",
    "garden",
    "gather",
    "gatherclay",
    "gift",
    "grindspice",
    "grow flowers",
    "growmushroom",
    "guard",
    "guild",
    "guildwar",
    "haggle",
    "hang lantern",
    "harvest",
    "harvest honey",
    "hatch egg",
    "heal",
    "help",
    "hollowlog",
    "hop scotch",
    "hunt",
    "hunttruffle",
    "illuminate",
    "infusepotion",
    "inspire",
    "inventtool",
    "inventory",
    "investigate",
    "joinparty",
    "journey",
    "juggle",
    "jugglefire",
    "jump rope",
    "kick ball",
    "kindlefire",
    "knitblanket",
    "knitscarf",
    "launch rocket",
    "launchboat",
    "laybricks",
    "leaderboard",
    "learnspell",
    "level",
    "lightbeacon",
    "lightcampfire",
    "listenrumor",
    "loomb weave",
    "lottery",
    "make crown",
    "make snowman",
    "mapstars",
    "meditate",
    "meditatepower",
    "meltwax",
    "mend",
    "mendarmor",
    "mendnet",
    "milkcow",
    "mine",
    "mixpaint",
    "motivate",
    "navigate",
    "navigateocean",
    "negotiate",
    "openchest",
    "overrun",
    "overthrow",
    "paint rocks",
    "paintcanvas",
    "participateevent",
    "patrol",
    "perform",
    "performtrick",
    "pet",
    "pick berries",
    "pickleveggies",
    "pickpocket",
    "planttree",
    "play hide",
    "playflute",
    "playmusic",
    "plow",
    "plunder",
    "plundersea",
    "polisharmor",
    "polishgem",
    "pondskip",
    "practicearchery",
    "pray",
    "pressflowers",
    "profile",
    "prospect",
    "purifywater",
    "quest",
    "questdaily",
    "questelite",
    "questlist",
    "raid",
    "raisebanner",
    "rally",
    "rallyattack",
    "rallydefend",
    "rallytroops",
    "readbook",
    "readscroll",
    "recharge",
    "refine",
    "register",
    "reinforce",
    "renderfat",
    "repair",
    "repairgear",
    "rescue",
    "reset",
    "rest",
    "restore",
    "ride bike",
    "ridehorse",
    "ringbell",
    "ritual",
    "roastmarshmallow",
    "roastmeat",
    "rob",
    "roll downhill",
    "run race",
    "sabotage",
    "sacrifice",
    "sailriver",
    "scavenge",
    "sculptclay",
    "sculptice",
    "scout",
    "scoutarea",
    "scoutdesert",
    "scoutmountain",
    "scry",
    "searchruins",
    "sell",
    "settrap",
    "sewclothes",
    "sharpenblade",
    "sharpenhook",
    "sharestory",
    "shop",
    "singlullaby",
    "sketchlandscape",
    "skip stone",
    "skirmish",
    "skirmishraid",
    "sleepinn",
    "slide ice",
    "smelt",
    "smeltgold",
    "smeltore",
    "smoke fish",
    "smuggle",
    "smugglecargo",
    "sneak",
    "spin top",
    "spinpottery",
    "spinwool",
    "stargaze",
    "stats",
    "steal",
    "steambath",
    "stitchwound",
    "storytell",
    "study",
    "studyancient",
    "summon",
    "survey",
    "swing high",
    "swingvine",
    "tailor",
    "tame",
    "tamewild",
    "tan hide",
    "tendbees",
    "throw frisbee",
    "throwpot",
    "throwparty",
    "tie knot",
    "tinker",
    "tournament",
    "track",
    "trade",
    "tradeall",
    "tradeinfo",
    "tradeup",
    "train",
    "trainhard",
    "treasure",
    "tug war",
    "tuneharp",
    "tuneinstrument",
    "unearthrelic",
    "upgrade",
    "upgradearmor",
    "upgradegear",
    "upgradeweapon",
    "viewaurora",
    "vintwine",
    "visitlibrary",
    "visitshrine",
    "voyage",
    "watch clouds",
    "watchsunset",
    "watchstars",
    "wave flag",
    "weave",
    "weavebasket",
    "weavecloak",
    "whisper secret",
    "whistle tune",
    "whittlefigure",
    "wieldstaff",
    "windmillgrind",
    "wish star",
    "work",
    "writejournal",
    "writepoem",
    "yogastretch"
  ];

  const totalSubcommands = allSubcommands.length;
  const commandList = allSubcommands.map(cmd => `**rpg** ${cmd}${cmd === "buy" || cmd === "craft" || cmd === "sell" || cmd === "gift" || cmd === "trade" || cmd === "bargain" || cmd === "barter" || cmd === "duel" || cmd === "arena" || cmd === "steal" || cmd === "raid" || cmd === "haggle" || cmd === "ambush" || cmd === "sabotage" || cmd === "skirmish" || cmd === "skirmishraid" ? " <args>" : ""}`).join("\n- ");

  return api.sendMessage(
    format({
      title: "RPG",
      titlePattern: `{emojis} ${UNIRedux.arrow} {word}`,
      titleFont: "double_struck",
      emojis: "🏹",
      content: `**Total Subcommands**: ${totalSubcommands}\n\n**Available commands**:\n- ${commandList}`
    }),
    threadID,
    messageID
  );
   }  
 }
};
