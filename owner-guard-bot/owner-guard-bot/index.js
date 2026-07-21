async function handleInviteLink(message, member) {
  try {
    // DON'T delete the message - just timeout
    // Message will stay in chat
    
    // Timeout for 5 minutes
    await member.timeout(INVITE_TIMEOUT_MS, 'Sent invite link');

    const timeoutId = String(++timeoutIdCounter);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`remove_timeout_${timeoutId}`)
        .setLabel('Remove')
        .setStyle(ButtonStyle.Success)
    );

    timeoutTargets.set(timeoutId, { userId: member.id, guildId: message.guildId });

    await message.author.send({
      content: `⛔ You've been timed out for 5 minutes for posting an invite link.`,
    }).catch(() => {});

    const logMessage = await message.channel.send({
      content: `⛔ ${message.author} timed out (5 mins) for posting an invite link.`,
      components: [row],
    });

    setTimeout(() => {
      timeoutTargets.delete(timeoutId);
    }, INVITE_TIMEOUT_MS);
  } catch (err) {
    console.error('Could not handle invite link:', err);
  }
}

