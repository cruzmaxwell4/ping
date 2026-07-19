require('dotenv').config();
const fs = require('fs');
const { Client, Events, GatewayIntentBits, PermissionsBitField, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');

const { BOT_TOKEN, OWNER_ID, OWNER_ROLE_ID, OWNER_SERVER_ID } = process.env;
const PREFIX = process.env.PREFIX || '!';
const WARN_THRESHOLD = 2; // 2 warnings before timeout
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const WARNING_RESET_MS = 24 * 60 * 60 * 1000; // 24 hours

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

// In-memory data storage
const data = {
  protectedRoles: {},
  protectedUsers: {},
  acceptChannels: {},
  userWarnings: {},
  exemptUsers: {},
  allowedUsers: {},
};

// Store timeout targets for button interactions: { timeoutId: { userId, guildId } }
const timeoutTargets = new Map();

// Counter for generating unique timeout IDs
let timeoutIdCounter = 0;

// Backup/restore data
function loadData() {
  if (fs.existsSync('bot-data.json')) {
    try {
      const saved = JSON.parse(fs.readFileSync('bot-data.json', 'utf-8'));
      Object.assign(data, saved);
      console.log('Data loaded from bot-data.json');
    } catch (err) {
      console.error('Error loading data:', err);
    }
  }
}

function saveData() {
  try {
    fs.writeFileSync('bot-data.json', JSON.stringify(data, null, 2));
    console.log('Data saved to bot-data.json');
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

// Load data on startup
loadData();

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  // Register slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName('setrole')
      .setDescription('Protect a role from being pinged (2 warnings, then 10min timeout)')
      .addRoleOption((option) =>
        option
          .setName('role')
          .setDescription('The role to protect')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
    new SlashCommandBuilder()
      .setName('selectperson')
      .setDescription('Protect a person from being pinged (2 warnings, then 10min timeout)')
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
    new SlashCommandBuilder()
      .setName('refreshwarnings')
      .setDescription('Clear warnings for a user so they can start fresh at 1 warning (owner only)')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The user to clear warnings for')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
      .setName('setperson')
      .setDescription('Exempt a user from all warnings and timeouts (owner only)')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The user to exempt')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
      .setName('personallowed')
      .setDescription('Allow a user to ping owner or roles without warnings')
      .addUserOption((option) =>
        option
          .setName('user')
          .setDescription('The user to allow')
          .setRequired(true)
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
  if (guild.id !== OWNER_SERVER_ID) {
    console.log(`Leaving unauthorized server: ${guild.name} (${guild.id})`);
    await guild.leave();
  } else {
    console.log(`Joined authorized server: ${guild.name}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setrole') {
      const role = interaction.options.getRole('role');
      const guildId = interaction.guildId;

      if (!data.protectedRoles[guildId]) {
        data.protectedRoles[guildId] = [];
      }

      const roles = data.protectedRoles[guildId];
      const idx = roles.indexOf(role.id);

      if (idx > -1) {
        roles.splice(idx, 1);
        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Role Unprotected')
          .setDescription(`${role.name} is no longer protected.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } else {
        roles.push(role.id);
        const embed = new EmbedBuilder()
          .setColor(0x51cf66)
          .setTitle('Role Protected')
          .setDescription(`${role.name} is now protected. Users get 2 warnings, then 10 minute timeout.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      saveData();
    } else if (interaction.commandName === 'selectperson') {
      const user = interaction.options.getUser('user');
      const guildId = interaction.guildId;

      if (!data.protectedUsers[guildId]) {
        data.protectedUsers[guildId] = [];
      }

      const users = data.protectedUsers[guildId];
      const idx = users.indexOf(user.id);

      if (idx > -1) {
        users.splice(idx, 1);
        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Person Unprotected')
          .setDescription(`${user.username} is no longer protected.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } else {
        users.push(user.id);
        const embed = new EmbedBuilder()
          .setColor(0x51cf66)
          .setTitle('Person Protected')
          .setDescription(`${user.username} is now protected. Users get 2 warnings, then 10 minute timeout.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      saveData();
    } else if (interaction.commandName === 'acceptchannel') {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "Only the server owner can use this command.", ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel');
      const guildId = interaction.guildId;

      if (!data.acceptChannels[guildId]) {
        data.acceptChannels[guildId] = [];
      }

      const channels = data.acceptChannels[guildId];
      const idx = channels.indexOf(channel.id);

      if (idx > -1) {
        channels.splice(idx, 1);
        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Channel Disabled')
          .setDescription(`${channel.name} is no longer an accept channel.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } else {
        channels.push(channel.id);
        const embed = new EmbedBuilder()
          .setColor(0x51cf66)
          .setTitle('Channel Accepted')
          .setDescription(`${channel.name} is now an accept channel. People can ping the owner here without warnings.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      saveData();
    } else if (interaction.commandName === 'refreshwarnings') {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "Only the server owner can use this command.", ephemeral: true });
      }

      const user = interaction.options.getUser('user');
      const guildId = interaction.guildId;

      // Find and clear all warnings for this user in this guild
      let clearedCount = 0;
      for (const key in data.userWarnings) {
        if (key.startsWith(`${guildId}:${user.id}:`)) {
          delete data.userWarnings[key];
          clearedCount++;
        }
      }

      saveData();

      const embed = new EmbedBuilder()
        .setColor(0x51cf66)
        .setTitle('Warnings Refreshed')
        .setDescription(`${user.username}'s warnings have been cleared. They can now ping again starting at 1 warning.`)
        .addFields(
          { name: 'User', value: user.tag, inline: true },
          { name: 'Warnings Cleared', value: String(clearedCount), inline: true }
        )
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } else if (interaction.commandName === 'setperson') {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "Only the server owner can use this command.", ephemeral: true });
      }

      const user = interaction.options.getUser('user');
      const guildId = interaction.guildId;

      if (!data.exemptUsers[guildId]) {
        data.exemptUsers[guildId] = [];
      }

      const users = data.exemptUsers[guildId];
      const idx = users.indexOf(user.id);

      if (idx > -1) {
        users.splice(idx, 1);
        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Exemption Removed')
          .setDescription(`${user.username} is no longer exempt from warnings.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } else {
        users.push(user.id);
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle('Person Exempted')
          .setDescription(`${user.username} is now exempt from all warnings and timeouts.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      saveData();
    } else if (interaction.commandName === 'personallowed') {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: "Only the server owner can use this command.", ephemeral: true });
      }

      const user = interaction.options.getUser('user');
      const guildId = interaction.guildId;

      if (!data.allowedUsers[guildId]) {
        data.allowedUsers[guildId] = [];
      }

      const users = data.allowedUsers[guildId];
      const idx = users.indexOf(user.id);

      if (idx > -1) {
        users.splice(idx, 1);
        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle('Allowance Removed')
          .setDescription(`${user.username} is no longer allowed to ping owner and roles freely.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } else {
        users.push(user.id);
        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle('Person Allowed')
          .setDescription(`User is now allowed to ping owner and roles freely.`)
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      }

      saveData();
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('remove_timeout_')) {
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
    const userId = message.author.id;
    const channelId = message.channelId;

    // Check if in accept channel
    const isInAcceptChannel = data.acceptChannels[guildId]?.includes(channelId);
    if (isInAcceptChannel && message.mentions.roles.has(OWNER_ROLE_ID)) {
      return;
    }

    // --- Check protected roles ---
    let shouldWarn = false;
    if (data.protectedRoles[guildId]) {
      for (const roleId of message.mentions.roles.keys()) {
        if (data.protectedRoles[guildId].includes(roleId)) {
          shouldWarn = true;
          break;
        }
      }

      if (!shouldWarn) {
        for (const roleId of member.roles.cache.keys()) {
          if (data.protectedRoles[guildId].includes(roleId)) {
            shouldWarn = true;
            break;
          }
        }
      }

      if (shouldWarn) {
        await handleWarning(message, member, 'protected role');
      }
    }

    // --- Check protected users ---
    if (data.protectedUsers[guildId]) {
      for (const mentionUserId of message.mentions.users.keys()) {
        if (data.protectedUsers[guildId].includes(mentionUserId)) {
          shouldWarn = true;
          break;
        }
      }

      if (shouldWarn) {
        await handleWarning(message, member, 'protected person');
      }
    }

    // --- Core feature: pinging owner role ---
    if (message.mentions.roles.has(OWNER_ROLE_ID) && !isInAcceptChannel) {
      await handleWarning(message, member, 'owner role');
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
          `\`/setrole <role>\` — protect a role`,
          `\`/selectperson <user>\` — protect a person`,
          `\`/acceptchannel <channel>\` — allow owner pings in a channel`,
          `\`/refreshwarnings <user>\` — clear a user's warnings (owner only)`,
          `\`/setperson <user>\` — exempt a user from all warnings (owner only)`,
          `\`/personallowed <user>\` — allow user to ping owner/roles freely`,
        ].join('\n'),
      );
    } else if (command === 'untimeout') {
      await handleUntimeout(message, args);
    }
  } catch (err) {
    console.error('Error handling message:', err);
  }
});

async function handleWarning(message, member, reason) {
  if (message.author.id === OWNER_ID) return;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  const guildId = message.guildId;
  const userId = message.author.id;

  if (data.exemptUsers[guildId]?.includes(userId)) return;
  if (data.allowedUsers[guildId]?.includes(userId)) return;
  const warningKey = `${guildId}:${userId}:${reason}`;

  // Initialize user warnings if needed
  if (!data.userWarnings[warningKey]) {
    data.userWarnings[warningKey] = {
      count: 0,
      lastWarningTime: 0,
    };
  }

  const now = Date.now();
  const lastTime = data.userWarnings[warningKey].lastWarningTime;

  // Reset warnings if 24 hours have passed
  if (lastTime && (now - lastTime) > WARNING_RESET_MS) {
    data.userWarnings[warningKey].count = 0;
  }

  data.userWarnings[warningKey].count++;
  data.userWarnings[warningKey].lastWarningTime = now;

  const warningCount = data.userWarnings[warningKey].count;

  if (warningCount < WARN_THRESHOLD) {
    // Send warning
    const remaining = WARN_THRESHOLD - warningCount;
    try {
      await message.author.send({
        content: `⚠️ Warning ${warningCount}/${WARN_THRESHOLD} — You pinged the ${reason}. ${remaining} more warning${remaining === 1 ? '' : 's'} before 10 minute timeout.`,
      }).catch(() => {});

      const ownerMessage = await message.reply({
        content: `⚠️ ${message.author} warned (${warningCount}/${WARN_THRESHOLD}) for pinging the ${reason}.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error('Could not send warning:', err);
    }
  } else {
    // Timeout on 3rd offense (after 2 warnings)
    try {
      await member.timeout(TIMEOUT_MS, `${reason} - 3rd offense`);

      const timeoutId = String(++timeoutIdCounter);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`remove_timeout_${timeoutId}`)
          .setLabel('Remove')
          .setStyle(ButtonStyle.Success)
      );

      timeoutTargets.set(timeoutId, { userId: member.id, guildId: message.guildId });

      await message.author.send({
        content: `You've been timed out for 10 minutes for the 3rd time pinging the ${reason}.`,
      }).catch(() => {});

      await message.reply({
        content: `${message.author} timed out (10 mins) for pinging the ${reason}.`,
        components: [row],
        ephemeral: true,
      });

      // Reset warnings after timeout
      data.userWarnings[warningKey].count = 0;
      data.userWarnings[warningKey].lastWarningTime = 0;

      setTimeout(() => {
        timeoutTargets.delete(timeoutId);
      }, TIMEOUT_MS);
    } catch (err) {
      console.error('Could not time out member:', err);
    }
  }

  saveData();
}

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

// Auto-save data every 5 minutes
setInterval(() => {
  saveData();
}, 5 * 60 * 1000);

client.login(BOT_TOKEN);

