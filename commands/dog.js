const fs = require("fs");

module.exports = {

    name: "dog",

    author: "Your Name",

    description: "Sends a dog video when triggered.",



   nonPrefix: true,
    async run({ api, event }) {

        const { threadID, messageID, body } = event;

        // Check for "dog" (case-insensitive)

        if (/^dog/i.test(body)) {

            const videoPath = `${__dirname}/nopPrefix/dog.mp4`;

            if (!fs.existsSync(videoPath)) {

                return api.sendMessage("❌ Video file not found!", threadID, messageID);

            }

            api.sendMessage({

                attachment: fs.createReadStream(videoPath)

            }, threadID, messageID);

        }

    }

};