const fs = require("fs");

module.exports = {

    name: "allha",

    author: "Aljur",

    description: "Plays 'Yamete' sound when triggered.",

    nonPrefix: true,

    async run({ api, event }) {

        const { threadID, messageID, body } = event;

        // Check for "yamete" (case-insensitive)

        if (/^allha/i.test(body)) {

            const audioPath = `${__dirname}/nopPrefix/allha.mp3`;

            if (!fs.existsSync(audioPath)) {

                return api.sendMessage("Audio file not found!", threadID, messageID);

            }

            api.sendMessage({

                attachment: fs.createReadStream(audioPath)

            }, threadID, messageID);

        }

    }

};