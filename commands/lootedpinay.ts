import axios from "axios";
import fs from "fs";
import path from "path";
import AuroraBetaStyler from "@aurora/styler";

module.exports = {
  config: {
    name: "lootedpinay",
    description: "Fetches and sends a random Looted Pinay video.",
    cooldown: 5,
    nsfw: true,
    usage: "/lootedpinay",
    category: "Entertainment 🎥",
  },
  run: async ({ api, event }) => {
    const { threadID, messageID } = event;
    const waitingMessage = AuroraBetaStyler.styleOutput({
      headerText: "Looted Pinay",
      headerSymbol: "🎥",
      headerStyle: "bold",
      bodyText: "Searching for you, please wait...",
      bodyStyle: "sansSerif",
      footerText: "Developed by: Aljur Pogoy",
    });
    const waitMsg = await new Promise<{ messageID: string }>((resolve) => {
      api.sendMessage(waitingMessage, threadID, (err, info) => resolve(info), messageID);
    });

    try {
      const response = await axios.get("https://kaiz-apis.mooo.com/api/lootedpinay", {
        params: {
          limit: 1,
          apikey: "9d41cb0c-b7ce-4b35-a037-097b1d8fa8d9",
        },
      });

      const { title, mp4url } = response.data.videos[0];
      const videoResponse = await axios({
        method: "get",
        url: mp4url,
        responseType: "stream",
      });

      const filePath = path.join(__dirname, "lootedpinay.mp4");
      const writer = fs.createWriteStream(filePath);
      videoResponse.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
      const stats = fs.statSync(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);

      const styledMessage = AuroraBetaStyler.styleOutput({
        headerText: "Looted Pinay",
        headerSymbol: "🎥",
        headerStyle: "bold",
        bodyText: `Title: ${title}`,
        bodyStyle: "sansSerif",
        footerText: "Developed by: Aljur Pogoy",
      });

      if (fileSizeMB > 25) {
        api.sendMessage(
          {
            body: `${styledMessage}\n\n⚠️ File is too large to upload.\nWatch here: ${mp4url}`,
          },
          threadID, messageID,
          () => {
            fs.unlinkSync(filePath);
            api.unsendMessage(waitMsg.messageID);
          },
          messageID
        );
      } else {
        api.sendMessage(
          {
            body: styledMessage,
            attachment: fs.createReadStream(filePath),
          },
          threadID,
          () => {
            fs.unlinkSync(filePath);
            api.unsendMessage(waitMsg.messageID);
          },
          messageID
        );
      }
    } catch (err) {
      api.sendMessage(
        " Please try again later.",
        threadID,
        () => api.unsendMessage(waitMsg.messageID),
        messageID
      );
      console.error("LootedPinay Error:", err);
    }
  },
};
