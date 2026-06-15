#!/usr/bin/env node
// Register the /agricogla slash command with Discord. Run once after setting up
// the app (and again whenever the command definition changes).
//
//   DISCORD_CLIENT_ID=... DISCORD_BOT_TOKEN=... [DISCORD_GUILD_ID=...] \
//     node scripts/register-discord-commands.mjs
//
// Set DISCORD_GUILD_ID to register a guild-scoped command (appears instantly,
// ideal for testing); omit it to register globally (can take up to an hour to
// propagate). The invoked command replies with LAUNCH_ACTIVITY, which opens the
// Activity — see src/server/discord/interactions.ts.

const appId = process.env.DISCORD_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !botToken) {
  console.error("Missing DISCORD_CLIENT_ID and/or DISCORD_BOT_TOKEN in the environment.");
  process.exit(1);
}

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

const command = {
  name: "agricogla",
  type: 1, // CHAT_INPUT
  description: "Start or watch an Agricola game in this voice channel",
};

const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
  body: JSON.stringify(command),
});

if (!res.ok) {
  console.error(`Failed to register command: ${res.status}\n${await res.text()}`);
  process.exit(1);
}

const scope = guildId ? `guild ${guildId}` : "globally";
console.log(`Registered /agricogla ${scope}.`);
