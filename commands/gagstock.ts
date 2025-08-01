import axios from "axios";
import WebSocket from "ws";
import AuroraBetaStyler from "@aurora/styler";

namespace ShadowBot {
  export interface Command {
    config: {
      name: string;
      description: string;
      usage: string;
      category?: string;
      role?: number;
    };
    run: (context: { api: any; event: any; args: string[] }) => Promise<void>;
  }
}

const activeSessions: Map<string, { ws: WebSocket; keepAlive: NodeJS.Timeout; closed: boolean }> = new Map();
const lastSentCache: Map<string, string> = new Map();
const PH_TIMEZONE = "Asia/Manila";

function pad(n: number): string {
  return n < 10 ? "0" + n : n.toString();
}

function getPHTime(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: PH_TIMEZONE }));
}

function getCountdown(target: Date): string {
  const now = getPHTime();
  const msLeft = target.getTime() - now.getTime();
  if (msLeft <= 0) return "00h 00m 00s";
  const h = Math.floor(msLeft / 3.6e6);
  const m = Math.floor((msLeft % 3.6e6) / 6e4);
  const s = Math.floor((msLeft % 6e4) / 1000);
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

function getNextRestocks(): { [key: string]: string } {
  const now = getPHTime();
  const timers: { [key: string]: string } = {};
  const nextEgg = new Date(now);
  nextEgg.setMinutes(now.getMinutes() < 30 ? 30 : 0);
  if (now.getMinutes() >= 30) nextEgg.setHours(now.getHours() + 1);
  nextEgg.setSeconds(0, 0);
  timers.egg = getCountdown(nextEgg);
  const next5 = new Date(now);
  const nextM = Math.ceil((now.getMinutes() + (now.getSeconds() > 0 ? 1 : 0)) / 5) * 5;
  next5.setMinutes(nextM === 60 ? 0 : nextM, 0, 0);
  if (nextM === 60) next5.setHours(now.getHours() + 1);
  timers.gear = timers.seed = getCountdown(next5);
  const nextHoney = new Date(now);
  nextHoney.setMinutes(now.getMinutes() < 30 ? 30 : 0);
  if (now.getMinutes() >= 30) nextHoney.setHours(now.getHours() + 1);
  nextHoney.setSeconds(0, 0);
  timers.honey = getCountdown(nextHoney);
  const next7 = new Date(now);
  const totalHours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const next7h = Math.ceil(totalHours / 7) * 7;
  next7.setHours(next7h, 0, 0, 0);
  timers.cosmetics = getCountdown(next7);
  const nextMerchant = new Date(now);
  const hoursToNext = 4 - (now.getHours() % 4);
  nextMerchant.setHours(now.getHours() + hoursToNext, 0, 0, 0);
  timers.travelingmerchant = getCountdown(nextMerchant);
  return timers;
}

function formatValue(val: number): string {
  if (val >= 1_000_000) return `x${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `x${(val / 1_000).toFixed(1)}K`;
  return `x${val}`;
}

function addEmoji(name: string): string {
  const emojis = {
    "Common Egg": "🥚", "Uncommon Egg": "🐣", "Rare Egg": "🍳", "Legendary Egg": "🪺", "Mythical Egg": "🔮",
    "Bug Egg": "🪲", "Cleaning Spray": "🧴", "Friendship Pot": "🪴", "Watering Can": "🚿", "Trowel": "🛠️",
    "Recall Wrench": "🔧", "Basic Sprinkler": "💧", "Advanced Sprinkler": "💦", "Godly Sprinkler": "⛲",
    "Lightning Rod": "⚡", "Master Sprinkler": "🌊", "Favorite Tool": "❤️", "Harvest Tool": "🌾", "Carrot": "🥕",
    "Strawberry": "🍓", "Blueberry": "🫐", "Orange Tulip": "🌷", "Tomato": "🍅", "Corn": "🌽", "Daffodil": "🌼",
    "Watermelon": "🍉", "Pumpkin": "🎃", "Apple": "🍎", "Bamboo": "🎍", "Coconut": "🥥", "Cactus": "🌵",
    "Dragon Fruit": "🍈", "Mango": "🥭", "Grape": "🍇", "Mushroom": "🍄", "Pepper": "🌶️", "Cacao": "🍫",
    "Beanstalk": "🌱", "Ember Lily": "🏵️", "Sugar Apple": "🍏"
  };
  return `${emojis[name] || ""} ${name}`;
}

const gagstockCommand: ShadowBot.Command = {
  config: {
    name: "gagstock",
    description: "Track Grow A Garden stock using WebSocket live updates, including Traveling Merchant.",
    usage: "/gagstock on | /gagstock on Sunflower | Watering Can | /gagstock off",
    category: "Tools ⚒️",
    role: 4, // Restrict to admins
  },
  run: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    const action = args[0]?.toLowerCase();
    const filters = args.slice(1).join(" ").split("|").map(f => f.trim().toLowerCase()).filter(Boolean);

    if (action === "off") {
      const session = activeSessions.get(threadID.toString());
      if (session) {
        clearInterval(session.keepAlive);
        session.closed = true;
        session.ws?.terminate();
        activeSessions.delete(threadID.toString());
        lastSentCache.delete(threadID.toString());
        const offMessage = AuroraBetaStyler.styleOutput({
          headerText: "Gagstock",
          headerSymbol: "🛑",
          headerStyle: "bold",
          bodyText: "Gagstock tracking stopped for this thread.",
          bodyStyle: "bold",
          footerText: "Developed by: **Aljur Pogoy**",
        });
        await api.sendMessage(offMessage, threadID, messageID);
      } else {
        const noSessionMessage = AuroraBetaStyler.styleOutput({
          headerText: "Gagstock",
          headerSymbol: "⚠️",
          headerStyle: "bold",
          bodyText: "This thread is not currently tracking Gagstock.",
          bodyStyle: "bold",
          footerText: "Developed by: **Aljur Pogoy**",
        });
        await api.sendMessage(noSessionMessage, threadID, messageID);
      }
      return;
    }

    if (action !== "on") {
      const usageMessage = AuroraBetaStyler.styleOutput({
        headerText: "Gagstock",
        headerSymbol: "📌",
        headerStyle: "bold",
        bodyText: "Usage:\n• /gagstock on\n• /gagstock on Sunflower | Watering Can\n• /gagstock off",
        bodyStyle: "bold",
        footerText: "Developed by: **Aljur Pogoy**",
      });
      await api.sendMessage(usageMessage, threadID, messageID);
      return;
    }

    if (activeSessions.has(threadID.toString())) {
      const activeMessage = AuroraBetaStyler.styleOutput({
        headerText: "Gagstock",
        headerSymbol: "📡",
        headerStyle: "bold",
        bodyText: "This thread is already tracking Gagstock. Use /gagstock off to stop.",
        bodyStyle: "bold",
        footerText: "Developed by: **Aljur Pogoy**",
      });
      await api.sendMessage(activeMessage, threadID, messageID);
      return;
    }

    const startMessage = AuroraBetaStyler.styleOutput({
      headerText: "Gagstock",
      headerSymbol: "✅",
      headerStyle: "bold",
      bodyText: "Gagstock tracking started for this thread via WebSocket!",
      bodyStyle: "bold",
      footerText: "Developed by: **Aljur Pogoy**",
    });
    await api.sendMessage(startMessage, threadID, messageID);

    let ws: WebSocket;
    let keepAliveInterval: NodeJS.Timeout;

    function connectWebSocket() {
      ws = new WebSocket("wss://gagstock.gleeze.com");
      ws.on("open", () => {
        keepAliveInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 10000);
        console.log(`[EVENT_DEBUG] WebSocket connected for thread ${threadID}`);
      });

      ws.on("message", async (data: string) => {
        try {
          const payload = JSON.parse(data);
          if (payload.status !== "success") return;
          const backup = payload.data;
          const stockData = {
            gearStock: backup.gear.items.map((i: { name: string; quantity: string }) => ({ name: i.name, value: Number(i.quantity) })),
            seedsStock: backup.seed.items.map((i: { name: string; quantity: string }) => ({ name: i.name, value: Number(i.quantity) })),
            eggStock: backup.egg.items.map((i: { name: string; quantity: string }) => ({ name: i.name, value: Number(i.quantity) })),
            cosmeticsStock: backup.cosmetics.items.map((i: { name: string; quantity: string }) => ({ name: i.name, value: Number(i.quantity) })),
            honeyStock: backup.honey.items.map((i: { name: string; quantity: string }) => ({ name: i.name, value: Number(i.quantity) })),
            travelingmerchantStock: backup.travelingmerchant?.items.map((i: { name: string; quantity: string }) => ({ name: i.name, value: Number(i.quantity) })) || [],
          };
          const currentKey = JSON.stringify({
            gearStock: stockData.gearStock,
            seedsStock: stockData.seedsStock,
            travelingmerchantStock: stockData.travelingmerchantStock,
          });
          const lastSent = lastSentCache.get(threadID.toString());
          if (lastSent === currentKey) return;
          lastSentCache.set(threadID.toString(), currentKey);

          const restocks = getNextRestocks();
          const formatList = (arr: { name: string; value: number }[]) => arr.map(i => `- ${addEmoji(i.name)}: ${formatValue(i.value)}`).join("\n");
          let filteredContent = "";
          let matched = 0;

          const addSection = (label: string, items: { name: string; value: number }[], restock: string) => {
            const filtered = filters.length ? items.filter(i => filters.some(f => i.name.toLowerCase().includes(f))) : items;
            if (label === "Gear" || label === "Seeds" || label === "Traveling Merchant") {
              if (filtered.length > 0) {
                matched += filtered.length;
                filteredContent += `${label}:\n${formatList(filtered)}\n⏳ Restock In: ${restock}\n\n`;
              }
            } else {
              filteredContent += `${label}:\n${formatList(items)}\n⏳ Restock In: ${restock}\n\n`;
            }
          };

          addSection("Gear", stockData.gearStock, restocks.gear);
          addSection("Seeds", stockData.seedsStock, restocks.seed);
          addSection("Eggs", stockData.eggStock, restocks.egg);
          addSection("Cosmetics", stockData.cosmeticsStock, restocks.cosmetics);
          addSection("Honey", stockData.honeyStock, restocks.honey);
          addSection("Traveling Merchant", stockData.travelingmerchantStock, restocks.travelingmerchant);

          if (matched === 0 && filters.length > 0) return;

          const updatedAtPH = getPHTime().toLocaleString("en-PH", {
            hour: "numeric", minute: "numeric", second: "numeric",
            hour12: true, day: "2-digit", month: "short", year: "numeric"
          });

          const weather = await axios.get("https://growagardenstock.com/api/stock/weather").then(res => res.data).catch(() => null);
          const weatherInfo = weather ? `🌤️ Weather: ${weather.icon} ${weather.weatherType}\n📋 ${weather.description}\n🎯 ${weather.cropBonuses}\n` : "";

          const message = AuroraBetaStyler.styleOutput({
            headerText: "Grow A Garden Tracker",
            headerSymbol: "🌾",
            headerStyle: "bold",
            bodyText: `${filteredContent}${weatherInfo}📅 Updated at (PH): ${updatedAtPH}`,
            bodyStyle: "bold",
            footerText: "Credits: **Aljur Pogoy** | **Developer Assistant**",
          });

          if (!activeSessions.has(threadID.toString())) return;
          await api.sendMessage(message, threadID);
        } catch (e) {
          console.error(`[EVENT_DEBUG] WebSocket message processing failed for thread ${threadID}:`, e);
        }
      });

      ws.on("close", () => {
        clearInterval(keepAliveInterval);
        const session = activeSessions.get(threadID.toString());
        if (session && !session.closed) setTimeout(connectWebSocket, 3000);
        console.log(`[EVENT_DEBUG] WebSocket closed for thread ${threadID}, reconnecting...`);
      });

      ws.on("error", () => {
        ws.close();
        console.error(`[EVENT_DEBUG] WebSocket error for thread ${threadID}, closing connection`);
      });

      activeSessions.set(threadID.toString(), { ws, keepAlive: keepAliveInterval, closed: false });
    }

    connectWebSocket();
  },
};

export default gagstockCommand;