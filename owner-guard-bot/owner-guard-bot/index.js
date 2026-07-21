require('dotenv').config();
const fs = require('fs');
const { Client, Events, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');

const { BOT_TOKEN, OWNER_ID, OWNER_SERVER_ID, INVITE_LINK } = process.env;
const PREFIX = process.env.PREFIX || '!';

if (!BOT_TOKEN || !OWNER_ID || !OWNER_SERVER_ID) {
  console.error('Missing required env vars');
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

// Extract invite code from URL
function extractInviteCode(url) {
  const match = url.match(/(?:discord\.gg|discord\.io|discord\.me|discord\.li|discordapp\.com\/invite)\/([a-zA-Z0-9-_]+)/i);
  return match ? match[1].toLowerCase() : null;
}

// Check if message contains the whitelisted invite link
function isWhitelistedInvite(content) {
  if (!INVITE_LINK) return false;
  
  const whitelistedCode = extractInviteCode(INVITE_LINK);
  if (!whitelistedCode) return false;

  // Find all invite links in message
  const inviteMatches = content.match(/(?:https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9-_]+/gi);
  if (!inviteMatches) return false;

  // Check if any match the whitelisted code
  for (const match of inviteMatches) {
    const code = extractInviteCode(match);
    if (code === whitelistedCode) {
      return true;
    }
  }

  return false;
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  if (INVITE_LINK) {
    const code = extractInviteCode(INVITE_LINK);
    console.log(`✓ Whitelisted invite: ${code}`);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  if (guild.id !== OWNER_SERVER_ID) {
    console.log(`Leaving unauthorized server: ${guild.name}`);
    await guild.leave();
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;

    // Owner can do anything
    if (message.author.id === OWNER_ID) return;

    // Check for invite links
    const hasInviteLink = /(?:https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9-_]+/i.test(message.content);
    
    if (hasInviteLink) {
      // If it's the whitelisted link, allow it
      if (isWhitelistedInvite(message.content)) {
        console.log(`✓ ${message.author.tag} posted whitelisted invite - allowed`);
        return;
      }

      // Non-whitelisted invite - timeout
      console.log(`✗ ${message.author.tag} posted non-whitelisted invite - timing out`);
      await message.delete().catch(() => {});
      await member.timeout(5 * 60 * 1000, 'Posted invite link').catch(() => {});
      return;
    }

    // Commands
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift()?.toLowerCase();

    if (command === 'ping') {
      await message.reply(`Pong! ${client.ws.ping}ms`);
    } else if (command === 'help') {
      await message.reply(
        [
          `Ping Bot`,
          ``,
          `\`${PREFIX}ping\` - check latency`,
          `\`${PREFIX}help\` - show this`,
        ].join('\n')
      );
    }
  } catch (err) {
    console.error('Error:', err);
  }
});

client.login(BOT_TOKEN);

