require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  OverwriteType,
  AttachmentBuilder,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const requiredEnv = [
  'TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'OWNER_ROLE_ID',
  'JURASSIC_CATEGORY_ID',
  'POKEMON_CATEGORY_ID',
  'SUPPORT_CATEGORY_ID',
  'LOG_CHANNEL_ID',
  'VOUCH_CHANNEL_ID',
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Send the ticket panel'),

  new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Send a DM reminder to the ticket owner')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Custom reminder message')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('vouch')
    .setDescription('Leave feedback about the service')
    .addStringOption(option =>
      option
        .setName('review')
        .setDescription('Write your feedback')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('stars')
        .setDescription('Rate the service from 1 to 5')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(5)
    )
    .addAttachmentOption(option =>
      option
        .setName('image')
        .setDescription('Optional screenshot/image')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('requestvouch')
    .setDescription('Ask a user to leave a vouch')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user you want to ask for feedback')
        .setRequired(true)
    ),
].map(cmd => cmd.toJSON());

function sanitizeUsername(username) {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 20) || 'user';
}

function getTicketChannelName(type, username) {
  const safe = sanitizeUsername(username);

  if (type === 'jwtg') return `jwtg-${safe}`;
  if (type === 'pogo') return `pogo-${safe}`;
  if (type === 'support') return `support-${safe}`;

  return `ticket-${safe}`;
}

function getCategoryId(type) {
  if (type === 'jwtg') return process.env.JURASSIC_CATEGORY_ID;
  if (type === 'pogo') return process.env.POKEMON_CATEGORY_ID;
  if (type === 'support') return process.env.SUPPORT_CATEGORY_ID;
  return null;
}

function isTicketChannel(channel) {
  if (!channel || channel.type !== ChannelType.GuildText) return false;

  return (
    channel.name.startsWith('jwtg-') ||
    channel.name.startsWith('pogo-') ||
    channel.name.startsWith('support-')
  );
}

function getTicketOwnerIdFromTopic(topic) {
  if (!topic) return null;

  const match = topic.match(/ticketOwnerId:(\d+)/);
  return match ? match[1] : null;
}

function getTicketOwnerIdFromPermissions(channel) {
  if (!channel || !channel.permissionOverwrites) return null;

  const ownerRoleId = process.env.OWNER_ROLE_ID;
  const everyoneId = channel.guild.roles.everyone.id;

  const userOverwrite = channel.permissionOverwrites.cache.find(overwrite => {
    if (overwrite.type !== OverwriteType.Member) return false;
    if (overwrite.id === ownerRoleId) return false;
    if (overwrite.id === everyoneId) return false;

    const canView = overwrite.allow.has(PermissionsBitField.Flags.ViewChannel);
    return canView;
  });

  return userOverwrite ? userOverwrite.id : null;
}

function getTicketOwnerId(channel) {
  const fromTopic = getTicketOwnerIdFromTopic(channel.topic);
  if (fromTopic) return fromTopic;

  const fromPermissions = getTicketOwnerIdFromPermissions(channel);
  if (fromPermissions) return fromPermissions;

  return null;
}

function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('Ticket')
    .setDescription('Use the button below to create a ticket.');
}

function buildCreateTicketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('create_ticket')
      .setLabel('Create ticket')
      .setEmoji('📩')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildTypeSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_type_select')
      .setPlaceholder('Select ticket type')
      .addOptions([
        {
          label: 'Buy',
          description: 'Open a purchase ticket',
          value: 'buy',
          emoji: '🛒',
        },
        {
          label: 'Support / Questions',
          description: 'Open a support ticket',
          value: 'support',
          emoji: '❓',
        },
      ])
  );
}

function buildBuyGameRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('buy_game_select')
      .setPlaceholder('Select the game/service you want')
      .addOptions([
        {
          label: 'Jurassic World The Game',
          description: 'Open a Jurassic World The Game order ticket',
          value: 'jwtg',
          emoji: '🦖',
        },
        {
          label: 'Pokémon Go',
          description: 'Open a Pokémon Go order ticket',
          value: 'pogo',
          emoji: '⚡',
        },
      ])
  );
}

function buildCloseRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );
}

function buildJwtgModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal_jwtg')
    .setTitle('Jurassic World The Game Order');

  const itemInput = new TextInputBuilder()
    .setCustomId('buy_item')
    .setLabel('What do you want to buy?')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('order_description')
    .setLabel('Order description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  const contactInput = new TextInputBuilder()
    .setCustomId('contact_info')
    .setLabel('Username / contact info')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder().addComponents(itemInput),
    new ActionRowBuilder().addComponents(descriptionInput),
    new ActionRowBuilder().addComponents(contactInput)
  );

  return modal;
}

function buildPogoModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal_pogo')
    .setTitle('Pokémon Go Order');

  const itemInput = new TextInputBuilder()
    .setCustomId('buy_item')
    .setLabel('What do you want to buy?')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('order_description')
    .setLabel('Order description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  const contactInput = new TextInputBuilder()
    .setCustomId('contact_info')
    .setLabel('Trainer name / contact info')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  modal.addComponents(
    new ActionRowBuilder().addComponents(itemInput),
    new ActionRowBuilder().addComponents(descriptionInput),
    new ActionRowBuilder().addComponents(contactInput)
  );

  return modal;
}

function buildSupportModal() {
  const modal = new ModalBuilder()
    .setCustomId('modal_support')
    .setTitle('Support / Questions');

  const subjectInput = new TextInputBuilder()
    .setCustomId('support_subject')
    .setLabel('Subject')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('support_description')
    .setLabel('Explain your issue or question')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(subjectInput),
    new ActionRowBuilder().addComponents(descriptionInput)
  );

  return modal;
}

async function findExistingTicket(guild, channelName) {
  return guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildText && ch.name === channelName
  );
}

function formatMessageForTranscript(message) {
  const createdAt = new Date(message.createdTimestamp).toLocaleString('en-GB');
  const author = `${message.author?.tag || 'Unknown User'} (${message.author?.id || 'Unknown ID'})`;
  const content = message.content?.trim() ? message.content : '[No text content]';

  const attachments = message.attachments.size > 0
    ? `\nAttachments:\n${message.attachments.map(att => att.url).join('\n')}`
    : '';

  return `[${createdAt}] ${author}\n${content}${attachments}\n`;
}

async function fetchAllMessages(channel) {
  let allMessages = [];
  let lastId;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    const fetched = [...messages.values()];
    allMessages.push(...fetched);

    lastId = fetched[fetched.length - 1].id;

    if (messages.size < 100) break;
  }

  return allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function createTranscriptAttachment(channel) {
  const messages = await fetchAllMessages(channel);

  let transcript = '';
  transcript += `Server: ${channel.guild.name}\n`;
  transcript += `Channel: #${channel.name}\n`;
  transcript += `Created transcript at: ${new Date().toLocaleString('en-GB')}\n`;
  transcript += `Topic: ${channel.topic || 'No topic'}\n`;
  transcript += '\n====================\n\n';

  for (const message of messages) {
    transcript += formatMessageForTranscript(message);
    transcript += '\n--------------------\n\n';
  }

  const buffer = Buffer.from(transcript, 'utf-8');
  return new AttachmentBuilder(buffer, { name: `${channel.name}-transcript.txt` });
}

async function sendTranscriptBeforeClosing(channel, closedByUser) {
  const ownerId = getTicketOwnerId(channel);
  const logChannel = await client.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);
  const transcriptAttachment = await createTranscriptAttachment(channel);

  const summaryEmbed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('Ticket Closed')
    .addFields(
      { name: 'Channel', value: channel.name, inline: false },
      { name: 'Closed by', value: `${closedByUser.tag} (${closedByUser.id})`, inline: false },
      { name: 'Ticket owner ID', value: ownerId || 'Not found', inline: false }
    )
    .setTimestamp();

  if (logChannel && logChannel.type === ChannelType.GuildText) {
    await logChannel.send({
      embeds: [summaryEmbed],
      files: [transcriptAttachment],
    }).catch(console.error);
  }

  if (ownerId) {
    const ownerUser = await client.users.fetch(ownerId).catch(() => null);

    if (ownerUser) {
      const ownerTranscriptAttachment = await createTranscriptAttachment(channel);

      await ownerUser.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Your Ticket Transcript')
            .setDescription('Here is the transcript of your ticket.')
            .setTimestamp(),
        ],
        files: [ownerTranscriptAttachment],
      }).catch(console.error);
    }
  }
}

function buildStars(stars) {
  return '⭐'.repeat(stars);
}

async function createTicketChannel({ interaction, type, embed }) {
  const guild = interaction.guild;
  const user = interaction.user;
  const categoryId = getCategoryId(type);

  if (!guild) {
    return interaction.reply({
      content: 'This command can only be used inside a server.',
      ephemeral: true,
    });
  }

  if (!categoryId) {
    return interaction.reply({
      content: 'Ticket category not configured correctly.',
      ephemeral: true,
    });
  }

  const channelName = getTicketChannelName(type, user.username);
  const existingTicket = await findExistingTicket(guild, channelName);

  if (existingTicket) {
    return interaction.reply({
      content: `You already have an open ticket: ${existingTicket}`,
      ephemeral: true,
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: `ticketOwnerId:${user.id}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
      {
        id: process.env.OWNER_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
        ],
      },
    ],
  });

  await channel.send({
    content: `<@&${process.env.OWNER_ROLE_ID}> ${user}`,
    embeds: [embed],
    components: [buildCloseRow()],
    allowedMentions: {
      roles: [process.env.OWNER_ROLE_ID],
      users: [user.id],
    },
  });

  return interaction.reply({
    content: `Your ticket has been created: ${channel}`,
    ephemeral: true,
  });
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error('Error while registering slash commands:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'panel') {
        await interaction.reply({
          embeds: [buildTicketPanelEmbed()],
          components: [buildCreateTicketRow()],
        });
        return;
      }

      if (interaction.commandName === 'remind') {
        if (!interaction.guild || !interaction.channel) {
          await interaction.reply({
            content: 'This command can only be used inside a server ticket.',
            ephemeral: true,
          });
          return;
        }

        if (!isTicketChannel(interaction.channel)) {
          await interaction.reply({
            content: 'You can only use /remind inside a ticket channel.',
            ephemeral: true,
          });
          return;
        }

        const ownerId = getTicketOwnerId(interaction.channel);

        if (!ownerId) {
          await interaction.reply({
            content: 'I could not find the ticket owner in this channel. This may be an old ticket with no saved owner data.',
            ephemeral: true,
          });
          return;
        }

        const customMessage = interaction.options.getString('message');
        const dmMessage =
          customMessage ||
          'Hello! We are waiting for your reply in your ticket. Please check it when you can.';

        try {
          const user = await client.users.fetch(ownerId);

          await user.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('Ticket Reminder')
                .setDescription(dmMessage)
                .setFooter({ text: interaction.guild.name }),
            ],
          });

          await interaction.reply({
            content: `Reminder sent to ${user}.`,
            ephemeral: true,
          });
        } catch (dmError) {
          console.error('DM error:', dmError);

          await interaction.reply({
            content: 'I could not send a DM to the ticket owner.',
            ephemeral: true,
          });
        }

        return;
      }

      if (interaction.commandName === 'vouch') {
        if (!interaction.guild) {
          await interaction.reply({
            content: 'This command can only be used inside a server.',
            ephemeral: true,
          });
          return;
        }

        const review = interaction.options.getString('review', true);
        const stars = interaction.options.getInteger('stars', true);
        const image = interaction.options.getAttachment('image');

        const vouchChannel = await client.channels.fetch(process.env.VOUCH_CHANNEL_ID).catch(() => null);

        if (!vouchChannel || vouchChannel.type !== ChannelType.GuildText) {
          await interaction.reply({
            content: 'The vouch channel is not configured correctly.',
            ephemeral: true,
          });
          return;
        }

        if (image && image.contentType && !image.contentType.startsWith('image/')) {
          await interaction.reply({
            content: 'The attachment must be an image.',
            ephemeral: true,
          });
          return;
        }

        const vouchEmbed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle('New Vouch')
          .addFields(
            { name: 'Client', value: `${interaction.user}`, inline: false },
            { name: 'Rating', value: buildStars(stars), inline: false },
            { name: 'Feedback', value: review, inline: false }
          )
          .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
          .setTimestamp();

        if (image) {
          vouchEmbed.setImage(image.url);
        }

        await vouchChannel.send({
          embeds: [vouchEmbed],
        });

        await interaction.reply({
          content: 'Your vouch has been sent successfully. Thank you!',
          ephemeral: true,
        });

        return;
      }

      if (interaction.commandName === 'requestvouch') {
        if (!interaction.guild) {
          await interaction.reply({
            content: 'This command can only be used inside a server.',
            ephemeral: true,
          });
          return;
        }

        if (!interaction.member.roles.cache.has(process.env.OWNER_ROLE_ID)) {
          await interaction.reply({
            content: 'You are not allowed to use this command.',
            ephemeral: true,
          });
          return;
        }

        const targetUser = interaction.options.getUser('user', true);

        try {
          await targetUser.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0xFEE75C)
                .setTitle('Feedback Request')
                .setDescription(
                  `Hello! We would love to hear your feedback.\n\nPlease use the command \`/vouch\` in the server to leave your review.\n\nYou can also include:\n- a rating from 1 to 5 stars\n- an optional image`
                )
                .setFooter({ text: interaction.guild.name }),
            ],
          });

          await interaction.reply({
            content: `Feedback request sent to ${targetUser}.`,
            ephemeral: true,
          });
        } catch (error) {
          console.error('Request vouch DM error:', error);

          await interaction.reply({
            content: 'I could not send a DM to that user.',
            ephemeral: true,
          });
        }

        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'create_ticket') {
        await interaction.reply({
          content: 'Select the type of ticket you want to open:',
          components: [buildTypeSelectRow()],
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === 'close_ticket') {
        if (!interaction.member.roles.cache.has(process.env.OWNER_ROLE_ID)) {
          await interaction.reply({
            content: 'You are not allowed to close this ticket.',
            ephemeral: true,
          });
          return;
        }

        await interaction.reply({
          content: 'Creating transcript and closing ticket...',
          ephemeral: true,
        });

        await sendTranscriptBeforeClosing(interaction.channel, interaction.user);
        await interaction.channel.delete();
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_type_select') {
        const selected = interaction.values[0];

        if (selected === 'buy') {
          await interaction.update({
            content: 'Select the game/service you want:',
            components: [buildBuyGameRow()],
          });
          return;
        }

        if (selected === 'support') {
          await interaction.showModal(buildSupportModal());
          return;
        }
      }

      if (interaction.customId === 'buy_game_select') {
        const selectedGame = interaction.values[0];

        if (selectedGame === 'jwtg') {
          await interaction.showModal(buildJwtgModal());
          return;
        }

        if (selectedGame === 'pogo') {
          await interaction.showModal(buildPogoModal());
          return;
        }
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'modal_jwtg') {
        const buyItem = interaction.fields.getTextInputValue('buy_item');
        const orderDescription = interaction.fields.getTextInputValue('order_description');
        const contactInfo = interaction.fields.getTextInputValue('contact_info');

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('New Ticket Opened')
          .addFields(
            { name: 'User', value: `${interaction.user}`, inline: false },
            { name: 'Type', value: 'Buy', inline: true },
            { name: 'Game', value: 'Jurassic World The Game', inline: true },
            { name: 'What do you want to buy?', value: buyItem, inline: false },
            { name: 'Order description', value: orderDescription, inline: false },
            { name: 'Username / contact info', value: contactInfo, inline: false }
          )
          .setTimestamp();

        await createTicketChannel({
          interaction,
          type: 'jwtg',
          embed,
        });
        return;
      }

      if (interaction.customId === 'modal_pogo') {
        const buyItem = interaction.fields.getTextInputValue('buy_item');
        const orderDescription = interaction.fields.getTextInputValue('order_description');
        const contactInfo = interaction.fields.getTextInputValue('contact_info');

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('New Ticket Opened')
          .addFields(
            { name: 'User', value: `${interaction.user}`, inline: false },
            { name: 'Type', value: 'Buy', inline: true },
            { name: 'Game', value: 'Pokémon Go', inline: true },
            { name: 'What do you want to buy?', value: buyItem, inline: false },
            { name: 'Order description', value: orderDescription, inline: false },
            { name: 'Trainer name / contact info', value: contactInfo, inline: false }
          )
          .setTimestamp();

        await createTicketChannel({
          interaction,
          type: 'pogo',
          embed,
        });
        return;
      }

      if (interaction.customId === 'modal_support') {
        const subject = interaction.fields.getTextInputValue('support_subject');
        const description = interaction.fields.getTextInputValue('support_description');

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('New Ticket Opened')
          .addFields(
            { name: 'User', value: `${interaction.user}`, inline: false },
            { name: 'Type', value: 'Support / Questions', inline: false },
            { name: 'Subject', value: subject, inline: false },
            { name: 'Issue / Question', value: description, inline: false }
          )
          .setTimestamp();

        await createTicketChannel({
          interaction,
          type: 'support',
          embed,
        });
        return;
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing your request.',
          ephemeral: true,
        });
      }
    } catch (replyError) {
      console.error('Reply error:', replyError);
    }
  }
});

client.login(process.env.TOKEN);