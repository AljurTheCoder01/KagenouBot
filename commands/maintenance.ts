

import AuroraBetaStyler from '@aurora/styler';

const maintenanceCommand: ShadowBot.Command = {
  config: {
    name: 'maintenance',
    description: 'Maintenance mode .',
    usage: 'maintenance [on|off]',
    role: 3, 
    aliases: ["maintain"],
    category: 'System ⚙️',
  },

  run: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    if (global.maintenanceMode === undefined) global.maintenanceMode = false;
    const option = args[0]?.toLowerCase();
    if (!option || !['on', 'off'].includes(option)) {
      const usageMsg = AuroraBetaStyler.styleOutput({
        headerText: 'Maintenance Toggle',
        headerSymbol: '🛠️',
        headerStyle: 'bold',
        bodyText: 'Usage: maintenance [on|off]',
        bodyStyle: 'sansSerif',
        footerText: 'Developed by: **Aljur Pogoy**',
      });
      return api.sendMessage(usageMsg, threadID, messageID);
    }

    if (option === 'on') {
      global.maintenanceMode = true;
    } else if (option === 'off') {
      global.maintenanceMode = false;
    }

    const statusMsg = AuroraBetaStyler.styleOutput({
      headerText: 'Maintenance Mode',
      headerSymbol: option === 'on' ? '🚧' : '✅',
      headerStyle: 'bold',
      bodyText: `Maintenance mode is now ${option.toUpperCase()}.`,
      bodyStyle: 'sansSerif',
      footerText: 'Developed by: **Aljur Pogoy**',
    });

    return api.sendMessage(statusMsg, threadID, messageID);
  },
};

export default maintenanceCommand;
