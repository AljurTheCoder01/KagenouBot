
import AuroraBetaStyler from "@aurora/styler"; 
const { LINE } = AuroraBetaStyler;
import * as fs from "fs";
import * as path from "path";

const adminCommand: ShadowBot.Command = {
  config: {
    name: "admin",
    author: "Aljur pogoy",
    nonPrefix: false,
    description: "Manage admin list. Usage: #admin list | #admin add <uid> <role> | #admin remove <uid>",
  },
  run: async ({ api, event }) => {
    const { threadID, messageID, senderID, body, messageReply } = event;
    const configPath = path.join(__dirname, "..", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    let vips = Array.isArray(config.vips) ? [...config.vips] : [];
    let admins = Array.isArray(config.admins) ? [...config.admins] : [];
    let moderators = Array.isArray(config.moderators) ? [...config.moderators] : [];
    let developers = Array.isArray(config.developers) ? [...config.developers] : [];
    const userId = String(senderID);
    const isDeveloper = developers.includes(userId);
    if (!isDeveloper) {
      const errorMessage = AuroraBetaStyler.styleOutput({
        headerText: "Error",
        headerSymbol: "❌",
        headerStyle: "bold",
        bodyText: "Only developers can use this command.",
        bodyStyle: "sansSerif",
        footerText: "Developed by: **Aljur pogoy**",
      });
      return api.sendMessage(errorMessage, threadID, messageID);
    }

    const args = body.split(" ").slice(1);
    const subCommand = args[0]?.toLowerCase();
    if (!subCommand || subCommand === "list") {
      const promptMessage = AuroraBetaStyler.styleOutput({
        headerText: "Admin List Prompt",
        headerSymbol: "👑",
        headerStyle: "bold",
        bodyText: "Would you like to see the full list of admins, moderators, developers, and VIPs? React with 👍 to confirm or 👎 to cancel.",
        bodyStyle: "sansSerif",
        footerText: "Developed by: **Aljur pogoy**",
      });

      const messageInfo = await new Promise((resolve, reject) => {
        api.sendMessage(promptMessage, threadID, (err, info) => {
          if (err) return reject(err);
          resolve(info);
        }, messageID);
      }) as { messageID: string };

      const normalizedMessageID = messageInfo.messageID.trim().replace(/\s+/g, '');

      global.reactionData.set(normalizedMessageID, {
        messageID: normalizedMessageID,
        threadID: threadID,
        authorID: senderID,
        callback: async ({ api, event, reaction }) => {
          if (reaction === "👍") {
            const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
            const vips = Array.isArray(cfg.vips) ? [...cfg.vips] : [];
            const admins = Array.isArray(cfg.admins) ? [...cfg.admins] : [];
            const moderators = Array.isArray(cfg.moderators) ? [...cfg.moderators] : [];
            const developers = Array.isArray(cfg.developers) ? [...cfg.developers] : [];

            const getUserNames = async (uids: string[]): Promise<string> => {
              if (!Array.isArray(uids) || uids.length === 0) return "None";
              const names: string[] = [];
              for (const uid of uids) {
                try {
                  const userInfo = await api.getUserInfo([uid]);
                  const name = userInfo[uid]?.name || "Unknown";
                  names.push(`— ${name}\nUID: ${uid}`);
                } catch {
                  names.push(`— Unknown\nUID: ${uid}`);
                }
              }
              return names.join("\n");
            };

            const devNames = await getUserNames(developers);
            const modNames = await getUserNames(moderators);
            const adminNames = await getUserNames(admins);
            const vipNames = await getUserNames(vips);

            const bodyText = `
👑 𝗗𝗲𝘃𝗲𝗅𝗈𝗽𝗲𝗿𝘀:
${devNames}

${LINE}

🛡️ 𝗠𝗼𝖽𝖾𝗋𝖺𝗍𝗈𝗋𝘀:
${modNames}

${LINE}

⚖️ 𝗔𝗱𝗺𝗶𝗻𝘀:
${adminNames}

${LINE}

🎭 𝗩𝗜𝗣𝘀:
${vipNames}
            `.trim();

            const fullListMessage = AuroraBetaStyler.styleOutput({
              headerText: "Admin List",
              headerSymbol: "👑",
              headerStyle: "bold",
              bodyText,
              bodyStyle: "sansSerif",
              footerText: "Developed by: **Aljur pogoy**",
            });
            await api.sendMessage(fullListMessage, threadID, messageID);
          } else if (reaction === "👎") {
            const cancelMessage = AuroraBetaStyler.styleOutput({
              headerText: "Cancelled",
              headerSymbol: "❌",
              headerStyle: "bold",
              bodyText: "Action cancelled. No list displayed.",
              bodyStyle: "sansSerif",
              footerText: "Developed by: **Aljur pogoy**",
            });
            await api.sendMessage(cancelMessage, threadID, messageID);
          }
        }
      });
      return;
    }
    if (subCommand === "add") {
      let uid: string, role: number;
      if (messageReply) {
        uid = messageReply.senderID;
        role = parseInt(args[1]) || 1;
      } else {
        if (args.length < 2) {
          const errorMessage = AuroraBetaStyler.styleOutput({
            headerText: "Error",
            headerSymbol: "❌",
            headerStyle: "bold",
            bodyText: "Usage: #admin add <uid> <role> (or reply to a user)",
            bodyStyle: "sansSerif",
            footerText: "Developed by: **Aljur pogoy**",
          });
          return api.sendMessage(errorMessage, threadID, messageID);
        }
        uid = args[1];
        role = parseInt(args[2]) || 1;
      }
      if (role < 1 || role > 4) {
        const errorMessage = AuroraBetaStyler.styleOutput({
          headerText: "Error",
          headerSymbol: "❌",
          headerStyle: "bold",
          bodyText: "Role must be 1 (admin), 2 (moderator), 3 (developer) or 4 (VIP).",
          bodyStyle: "sansSerif",
          footerText: "Developed by: **Aljur pogoy**",
        });
        return api.sendMessage(errorMessage, threadID, messageID);
      }

      if (
        admins.includes(String(uid)) ||
        moderators.includes(String(uid)) ||
        developers.includes(String(uid)) ||
        vips.includes(String(uid))
      ) {
        const errorMessage = AuroraBetaStyler.styleOutput({
          headerText: "Error",
          headerSymbol: "❌",
          headerStyle: "bold",
          bodyText: `UID ${uid} is already in the admin/VIP list.`,
          bodyStyle: "sansSerif",
          footerText: "Developed by: **Aljur pogoy**",
        });
        return api.sendMessage(errorMessage, threadID, messageID);
      }
      if (role === 4) vips.push(String(uid));
      else if (role === 3) developers.push(String(uid));
      else if (role === 2) moderators.push(String(uid));
      else admins.push(String(uid));

      config.admins = admins;
      config.moderators = moderators;
      config.developers = developers;
      config.vips = vips;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      const userInfo = await api.getUserInfo([uid]);
      const name = userInfo[uid]?.name || "Unknown";
      const successMessage = AuroraBetaStyler.styleOutput({
        headerText: "Success",
        headerSymbol: "✅",
        headerStyle: "bold",
        bodyText: `Added ${name} (UID: ${uid}) as ${
          role === 4 ? "VIP" : role === 3 ? "Developer" : role === 2 ? "Moderator" : "Admin"
        } (role ${role}).`,
        bodyStyle: "sansSerif",
        footerText: "Developed by: **Aljur pogoy**",
      });
      return api.sendMessage(successMessage, threadID, messageID);
    }
    if (subCommand === "remove") {
      if (args.length < 2) {
        const errorMessage = AuroraBetaStyler.styleOutput({
          headerText: "Error",
          headerSymbol: "❌",
          headerStyle: "bold",
          bodyText: "Usage: #admin remove <uid>",
          bodyStyle: "sansSerif",
          footerText: "Developed by: **Aljur pogoy**",
        });
        return api.sendMessage(errorMessage, threadID, messageID);
      }
      const uid = args[1];
      if (
        !admins.includes(String(uid)) &&
        !moderators.includes(String(uid)) &&
        !developers.includes(String(uid)) &&
        !vips.includes(String(uid))
      ) {
        const errorMessage = AuroraBetaStyler.styleOutput({
          headerText: "Error",
          headerSymbol: "❌",
          headerStyle: "bold",
          bodyText: `UID ${uid} is not in the admin/mod/vip/developer list.`,
          bodyStyle: "sansSerif",
          footerText: "Developed by: **Aljur pogoy**",
        });
        return api.sendMessage(errorMessage, threadID, messageID);
      }
      admins = admins.filter(a => a !== String(uid));
      moderators = moderators.filter(m => m !== String(uid));
      developers = developers.filter(d => d !== String(uid));
      vips = vips.filter(v => v !== String(uid));

      config.admins = admins;
      config.moderators = moderators;
      config.developers = developers;
      config.vips = vips;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      const userInfo = await api.getUserInfo([uid]);
      const name = userInfo[uid]?.name || "Unknown";
      const successMessage = AuroraBetaStyler.styleOutput({
        headerText: "Success",
        headerSymbol: "✅",
        headerStyle: "bold",
        bodyText: `Removed ${name} (UID: ${uid}) from the admin/mod/vip/developer list.`,
        bodyStyle: "sansSerif",
        footerText: "Developed by: **Aljur pogoy**",
      });
      return api.sendMessage(successMessage, threadID, messageID);
    }
    const errorMessage = AuroraBetaStyler.styleOutput({
      headerText: "Error",
      headerSymbol: "❌",
      headerStyle: "bold",
      bodyText: "Invalid subcommand. Use: admin list | add <uid> <role> | remove <uid>",
      bodyStyle: "sansSerif",
      footerText: "Developed by: **Aljur pogoy**",
    });
    api.sendMessage(errorMessage, threadID, messageID);
  },
  onReaction: async ({ api, event, reaction }) => {
    const { messageID } = event;
    console.log("[DEBUG] onReaction triggered:", reaction, "for MessageID:", messageID);
  },
};

export default adminCommand;
