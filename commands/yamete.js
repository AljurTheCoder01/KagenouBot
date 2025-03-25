const fs = require("fs");

module.exports = {

    name: "yamete",

    author: "VanHung",

    description: "Plays 'Yamete' sound when triggered.",



    nonPrefix: true,

    async run({ api, event }) {

        const { threadID, messageID, body } = event;

  

        if (/^yamete/i.test(body)) {

            const audioPath = `${__dirname}/nopPrefix/yamate.mp3`;

            if (!fs.existsSync(audioPath)) {

                return api.sendMessage("❌ Audio file not found!", threadID, messageID);

            }

            api.sendMessage({

                attachment: fs.createReadStream(audioPath)

            }, threadID, messageID);

        }

    }

};