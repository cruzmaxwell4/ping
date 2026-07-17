require('dotenv').config();
const { Client, Events, GatewayIntentBits, PermissionsBitField, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');

const { BOT_TOKEN, OWNER_ID, OWNER_ROLE_ID, OWNER_SERVER_ID } = process.env;
const PREFIX = process.env.PREFIX || '!';
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

if (!BOT_TOKEN || !OWNER_ID || !OWNER_ROLE_ID || !OWNER_SERVER_ID) {
  console.error('Missing BOT_TOKEN, OWNER_ID, OWNER_ROLE_ID, or OWNER_SERVER_ID — check your environment variables.');
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

// Store protected users per guild: { guildId: Set of userIds }
const protectedUsers = new Map();

// Store accept channels per guild: { guildId: Set of channelIds }
const acceptChannels = new Map();

// Store timeout targets for button interactions: { timeoutId: { userId, guildId } }
const timeoutTargets = new Map();

// Counter for generating unique timeout IDs
let timeoutIdCounter = 0;

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
    new SlashCommandBuilder()
      .setName('selectperson')
      .setDescription('Protect a person from being pinged (5min timeout on ping)')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The person to protect')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
    new SlashCommandBuilder()
      .setName('acceptchannel')
      .setDescription('Allow people to ping the owner in this channel without timeout (owner only)')
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('The channel to accept pings in')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
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

client.on(Events.GuildCreate, async (guild) => {
  // If bot joins a server that's not the owner's server, leave immediately
  if (guild.id !== OWNER_SERVER_ID) {
    console.log(`Leaving unauthorized server: ${guild.name} (${guild.id})`);
    await guild.leave();
  } else {
    console.log(`Joined authorized server: ${guild.name}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
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
    } else if (interaction.commandName === 'selectperson') {
      const user = interaction.options.getUser('user');
      const guildId = interaction.guildId;

      if (!protectedUsers.has(guildId)) {
        protectedUsers.set(guildId, new Set());
      }

      const users = protectedUsers.get(guildId);

      if (users.has(user.id)) {
        users.delete(user.id);
        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Person Unprotected')
          .setDescription(`${user.username} is no longer protected.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } else {
        users.add(user.id);
        const embed = new EmbedBuilder()
          .setColor(0x51cf66)
          .setTitle('Person Protected')
          .setDescription(
            `${user.username} is now protected. Anyone mentioning this person will be timed out for 5 minutes.`
          )
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }
    } else if (interaction.commandName === 'acceptchannel') {
      // Owner only check
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "Only the server owner can use this command.", ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel');
      const guildId = interaction.guildId;

      if (!acceptChannels.has(guildId)) {
        acceptChannels.set(guildId, new Set());
      }

      const channels = acceptChannels.get(guildId);

      if (channels.has(channel.id)) {
        channels.delete(channel.id);
        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Channel Disabled')
          .setDescription(`${channel.name} is no longer an accept channel. Pings here will timeout.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } else {
        channels.add(channel.id);
        const embed = new EmbedBuilder()
          .setColor(0x51cf66)
          .setTitle('Channel Accepted')
          .setDescription(`${channel.name} is now an accept channel. People can ping the owner here without timeout.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }
    }
  }

  // Handle button clicks
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('remove_timeout_')) {
      // Only owner can use the button
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "Only the server owner can remove timeouts.", ephemeral: true });
      }

      const timeoutId = interaction.customId.replace('remove_timeout_', '');
      const target = timeoutTargets.get(timeoutId);

      if (!target) {
        return interaction.reply({ content: 'This timeout has already been removed or expired.', ephemeral: true });
      }

      try {
        const guild = await client.guilds.fetch(target.guildId);
        const member = await guild.members.fetch(target.userId);

        await member.timeout(null, `Timeout removed by ${interaction.user.tag}`);
        await interaction.reply({ content: `Removed the timeout on **${member.user.tag}**.`, ephemeral: true });

        // Remove the button after timeout is removed
        timeoutTargets.delete(timeoutId);
        const newRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('remove_timeout_expired')
            .setLabel('Remove')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
        );
        await interaction.message.edit({ components: [newRow] });
      } catch (err) {
        console.error('Could not remove timeout via button:', err);
        await interaction.reply({
          content: "Couldn't remove that timeout — make sure my role is above theirs and I have the **Moderate Members** permission.",
          ephemeral: true,
        });
      }
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;

    const guildId = message.guildId;
    const channelId = message.channelId;

    // Check if this message is in an accept channel
    const isInAcceptChannel = acceptChannels.has(guildId) && acceptChannels.get(guildId).has(channelId);

    // If in accept channel and pinging owner, don't timeout
    if (isInAcceptChannel && message.mentions.roles.has(OWNER_ROLE_ID)) {
      return;
    }

    // --- Check protected roles ---
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

    // --- Check protected users ---
    if (protectedUsers.has(guildId)) {
      const protectedSet = protectedUsers.get(guildId);

      // Check if message mentions a protected user
      for (const [userId] of message.mentions.users) {
        if (protectedSet.has(userId)) {
          shouldTimeout = true;
          break;
        }
      }

      if (shouldTimeout) {
        await punishPing(message, member, 'protected person');
      }
    }

    // --- Core feature: pinging the owner role = 5 minute timeout (unless in accept channel) ---
    if (message.mentions.roles.has(OWNER_ROLE_ID) && !isInAcceptChannel) {
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
          `\`/selectperson <user>\` — protect/unprotect a person from pings (manage guild only)`,
          `\`/acceptchannel <channel>\` — allow pinging owner in this channel (owner only)`,
        ].join('\n'),
      );
    } else if (command === 'untimeout') {
      await handleUntimeout(message, args);
    }
  } catch (err) {
    console.error('Error handling message:', err);
  }
});

// Times out whoever pinged protected role/person/owner — unless they're the real owner or an admin
// (Discord's API blocks timing out admins anyway, so we check first instead of erroring).
async function punishPing(message, member, reason) {
  if (message.author.id === OWNER_ID) return;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  try {
    await member.timeout(TIMEOUT_MS, `Pinged the ${reason}`);

    // Generate unique timeout ID instead of using message ID
    const timeoutId = String(++timeoutIdCounter);

    // Create the button with the unique timeout ID
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`remove_timeout_${timeoutId}`)
        .setLabel('Remove')
        .setStyle(ButtonStyle.Success)
    );

    // Store the timeout target for button interaction
    timeoutTargets.set(timeoutId, { userId: member.id, guildId: message.guildId });

    // Send DM to timed out user (no button)
    await message.author.send({
      content: `You've been timed out for 5 minutes for pinging the ${reason}.`,
    }).catch(() => {
      // If DM fails, silently ignore (owner message will show in chat)
    });

    // Send ephemeral (only owner sees) message in chat with Remove button
    const ownerMessage = await message.reply({
      content: `${message.author} timed out for pinging the ${reason}.`,
      components: [row],
      ephemeral: true,
    });

    // Clean up stored data after 5 minutes (timeout expires)
    setTimeout(() => {
      timeoutTargets.delete(timeoutId);
    }, TIMEOUT_MS);
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

