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
  EmbedBuilder
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Send the ticket panel')
    .toJSON()
];

function sanitizeUsername(username) {
  return username
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 20) || 'user';
}

function getTicketChannelName(type, username) {
  const safeName = sanitizeUsername(username);

  if (type === 'jwtg') return `jwtg-${safeName}`;
  if (type === 'pogo') return `pogo-${safeName}`;
  if (type === 'support') return `support-${safeName}`;

  return `ticket-${safeName}`;
}

function getCategoryId(type) {
  if (type === 'jwtg') return process.env.JURASSIC_CATEGORY_ID;
  if (type === 'pogo') return process.env.POKEMON_CATEGORY_ID;
  if (type === 'support') return process.env.SUPPORT_CATEGORY_ID;
  return null;
}

function getTicketLabel(type) {
  if (type === 'jwtg') return 'Jurassic World The Game';
  if (type === 'pogo') return 'Pokémon Go';
  if (type === 'support') return 'Support / Questions';
  return 'Unknown';
}

function buildCloseRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('🔒 Close ticket')
      .setStyle(ButtonStyle.Danger)
  );
}

async function findExistingTicket(guild, channelName) {
  return guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildText && ch.name === channelName
  );
}

async function createTicketChannel({
  interaction,
  type,
  embed
}) {
  const guild = interaction.guild;
  const user = interaction.user;
  const channelName = getTicketChannelName(type, user.username);
  const categoryId = getCategoryId(type);

  if (!categoryId) {
    return interaction.reply({
      content: 'Ticket category not configured correctly.',
      ephemeral: true
    });
  }

  const existingTicket = await findExistingTicket(guild, channelName);

  if (existingTicket) {
    return interaction.reply({
      content: `You already have an open ticket: ${existingTicket}`,
      ephemeral: true
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      },
      {
        id: process.env.OWNER_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels
        ]
      }
    ]
  });

  await channel.send({
    content: `<@&${process.env.OWNER_ROLE_ID}> ${user}`,
    embeds: [embed],
    components: [buildCloseRow()]
  });

  return interaction.reply({
    content: `Your ticket has been created: ${channel}`,
    ephemeral: true
  });
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('Slash command /panel registered successfully.');
  } catch (error) {
    console.error('Error while registering slash command:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'panel') {
        const panelEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('Ticket')
          .setDescription('Use the button below to create a ticket.');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('create_ticket')
            .setLabel('📩 Create ticket')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
          embeds: [panelEmbed],
          components: [row]
        });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'create_ticket') {
        const typeRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('ticket_type_select')
            .setPlaceholder('Select ticket type')
            .addOptions([
              {
                label: 'Buy',
                description: 'Open a purchase ticket',
                value: 'buy',
                emoji: '🛒'
              },
              {
                label: 'Support / Questions',
                description: 'Open a support ticket',
                value: 'support',
                emoji: '❓'
              }
            ])
        );

        await interaction.reply({
          content: 'Select the type of ticket you want to open:',
          components: [typeRow],
          ephemeral: true
        });
      }

      if (interaction.customId === 'close_ticket') {
        await interaction.reply({
          content: 'Closing ticket...',
          ephemeral: true
        });

        await interaction.channel.delete();
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ticket_type_select') {
        const selected = interaction.values[0];

        if (selected === 'buy') {
          const buyRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('buy_game_select')
              .setPlaceholder('Select game/service')
              .addOptions([
                {
                  label: 'Jurassic World The Game',
                  description: 'Open a Jurassic World The Game order ticket',
                  value: 'jwtg',
                  emoji: '🦖'
                },
                {
                  label: 'Pokémon Go',
                  description: 'Open a Pokémon Go order ticket',
                  value: 'pogo',
                  emoji: '⚡'
                }
              ])
          );

          await interaction.update({
            content: 'Select the game/service you want:',
            components: [buyRow]
          });
        }

        if (selected === 'support') {
          const modal = new ModalBuilder()
            .setCustomId('modal_support')
            .setTitle('Support / Questions');

          const subjectInput = new TextInputBuilder()
            .setCustomId('support_subject')
            .setLabel('Subject')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          const descriptionInput = new TextInputBuilder()
            .setCustomId('support_description')
            .setLabel('Explain your issue or question')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder().addComponents(subjectInput),
            new ActionRowBuilder().addComponents(descriptionInput)
          );

          await interaction.showModal(modal);
        }
      }

      if (interaction.customId === 'buy_game_select') {
        const selectedGame = interaction.values[0];

        if (selectedGame === 'jwtg') {
          const modal = new ModalBuilder()
            .setCustomId('modal_jwtg')
            .setTitle('Jurassic World The Game Order');

          const itemInput = new TextInputBuilder()
            .setCustomId('buy_item')
            .setLabel('What do you want to buy?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          const descriptionInput = new TextInputBuilder()
            .setCustomId('order_description')
            .setLabel('Order description')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

          const contactInput = new TextInputBuilder()
            .setCustomId('contact_info')
            .setLabel('Username / contact info')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder().addComponents(itemInput),
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(contactInput)
          );

          await interaction.showModal(modal);
        }

        if (selectedGame === 'pogo') {
          const modal = new ModalBuilder()
            .setCustomId('modal_pogo')
            .setTitle('Pokémon Go Order');

          const itemInput = new TextInputBuilder()
            .setCustomId('buy_item')
            .setLabel('What do you want to buy?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          const descriptionInput = new TextInputBuilder()
            .setCustomId('order_description')
            .setLabel('Order description')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

          const contactInput = new TextInputBuilder()
            .setCustomId('contact_info')
            .setLabel('Trainer name / contact info')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder().addComponents(itemInput),
            new ActionRowBuilder().addComponents(descriptionInput),
            new ActionRowBuilder().addComponents(contactInput)
          );

          await interaction.showModal(modal);
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
          embed
        });
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
          embed
        });
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
          embed
        });
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true
      });
    }
  }
});

client.login(process.env.TOKEN);