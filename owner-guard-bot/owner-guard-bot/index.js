require('dotenv').config();
const { Client, Events, GatewayIntentBits, PermissionsBitField } = require('discord.js');

const { BOT_TOKEN, OWNER_ID, OWNER_ROLE_ID } = process.env;
const PREFIX = process.env.PREFIX || '!';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

if (!BOT_TOKEN || !OWNER_ID || !OWNER_ROLE_ID) {
  console.error('Missing BOT_TOKEN, OWNER_ID, or OWNER_ROLE_ID — check your environment variables.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;

    // --- Core feature: pinging the owner role = 5 minute timeout ---
    if (message.mentions.roles.has(OWNER_ROLE_ID)) {
      await punishPing(message, member);
    }

    // --- Commands ---
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    if (command === 'ping') {
      await message.reply(`Pong! Latency: ${Math.round(client.ws.ping)}ms`);
    } else if (command === 'help') {
      await message.reply(
        [
          `**Commands** (prefix: \`${PREFIX}\`)`,
          `\`${PREFIX}ping\` — check if the bot's alive`,
          `\`${PREFIX}help\` — show this list`,
          `\`${PREFIX}untimeout @user\` — remove a timeout (owner only)`,
        ].join('\n'),
      );
    } else if (command === 'untimeout') {
      await handleUntimeout(message, args);
    }
  } catch (err) {
    console.error('Error handling message:', err);
  }
});

// Times out whoever pinged the owner role — unless they're the real owner or an admin
// (Discord's API blocks timing out admins anyway, so we check first instead of erroring).
async function punishPing(message, member) {
  if (message.author.id === OWNER_ID) return;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  try {
    await member.timeout(TIMEOUT_MS, 'Pinged the owner role');
    await message.reply(`${message.author}, you're timed out for 5 minutes for pinging the owner role.`);
  } catch (err) {
    console.error('Could not time out member:', err);
  }
}

// Owner-only: lifts a timeout early. Accepts a mention or a raw user ID.
async function handleUntimeout(message, args) {
  if (message.author.id !== OWNER_ID) {
    return message.reply("You don't have permission to use that command.");
  }

  let target = message.mentions.members?.first();
  if (!target && args[0]) {
    target = await message.guild.members.fetch(args[0]).catch(() => null);
  }

  if (!target) {
    return message.reply(`Usage: \`${PREFIX}untimeout @user\` (or \`${PREFIX}untimeout <user ID>\`)`);
  }

  try {
    await target.timeout(null, `Timeout removed by ${message.author.tag}`);
    await message.reply(`Removed the timeout on **${target.user.tag}**.`);
  } catch (err) {
    console.error('Could not remove timeout:', err);
    await message.reply(
      "Couldn't remove that timeout — make sure my role is above theirs and I have the **Moderate Members** permission.",
    );
  }
}

client.login(BOT_TOKEN);
