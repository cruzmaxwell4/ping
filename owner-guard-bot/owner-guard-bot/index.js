require('dotenv').config();
const { Client, Events, GatewayIntentBits, PermissionsBitField, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');

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

// Store protected roles per guild: { guildId: Set of roleIds }
const protectedRoles = new Map();

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  // Register slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName('setrole')
      .setDescription('Protect a role from being pinged (5min timeout on ping)')
      .addRoleOption((option) =>
        option
          .setName('role')
          .setDescription('The role to protect')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
  ];

  const rest = new REST().setToken(BOT_TOKEN);

  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(readyClient.user.id), {
      body: commands,
    });
    console.log('Slash commands registered!');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setrole') {
    const role = interaction.options.getRole('role');
    const guildId = interaction.guildId;

    if (!protectedRoles.has(guildId)) {
      protectedRoles.set(guildId, new Set());
    }

    const roles = protectedRoles.get(guildId);

    if (roles.has(role.id)) {
      roles.delete(role.id);
      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('Role Unprotected')
        .setDescription(`${role.name} is no longer protected.`)
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } else {
      roles.add(role.id);
      const embed = new EmbedBuilder()
        .setColor(0x51cf66)
        .setTitle('Role Protected')
        .setDescription(
          `${role.name} is now protected. Anyone mentioning this role or users with this role will be timed out for 5 minutes.`
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;

    // --- Check protected roles ---
    const guildId = message.guildId;
    let shouldTimeout = false;

    if (protectedRoles.has(guildId)) {
      const protectedSet = protectedRoles.get(guildId);

      // Check if message mentions a protected role
      for (const [roleId] of message.mentions.roles) {
        if (protectedSet.has(roleId)) {
          shouldTimeout = true;
          break;
        }
      }

      // Check if message author has a protected role
      if (!shouldTimeout) {
        for (const [roleId] of member.roles.cache) {
          if (protectedSet.has(roleId)) {
            shouldTimeout = true;
            break;
          }
        }
      }

      if (shouldTimeout) {
        await punishPing(message, member, 'protected role');
      }
    }

    // --- Core feature: pinging the owner role = 5 minute timeout ---
    if (message.mentions.roles.has(OWNER_ROLE_ID)) {
      await punishPing(message, member, 'owner role');
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
          `\`/setrole <role>\` — protect/unprotect a role from pings (manage guild only)`,
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
async function punishPing(message, member, reason) {
  if (message.author.id === OWNER_ID) return;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  try {
    await member.timeout(TIMEOUT_MS, `Pinged the ${reason}`);
    await message.reply(`${message.author}, you're timed out for 5 minutes for pinging the ${reason}.`);
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

