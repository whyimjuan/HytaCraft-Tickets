// index.js
const express = require('express');
const app = express();
const { Client, GatewayIntentBits, Events, PermissionsBitField, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TICKETS_CATEGORY_ID = '1382437394451665057';
const CLOSED_CATEGORY_ID = '1382437505051398175';
const STAFF_ROLE_ID = '1118358436221034596';

let ticketCounter = 1;
const ticketMetadata = new Map();

// Crear cliente
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ]
});

client.commands = new Map();

// Cargar comandos desde carpetas
const commandFolders = fs.existsSync(path.join(__dirname, 'commands')) ? fs.readdirSync(path.join(__dirname, 'commands')) : [];
for (const folder of commandFolders) {
  const commandsPath = path.join(__dirname, 'commands', folder);
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.log(`[WARNING] El comando en ${file} no tiene data.`);
    }
  }
}

// Cargar eventos personalizados si existen
const eventPath = path.join(__dirname, 'events');
if (fs.existsSync(eventPath)) {
  const eventFiles = fs.readdirSync(eventPath).filter(file => file.endsWith('.js'));
  for (const file of eventFiles) {
    const event = require(path.join(eventPath, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
}

// Evento cuando el bot esté listo
client.once(Events.ClientReady, () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: 'mc.hytacraft.com',
      type: 4
    }]
  });
});

// Interacciones: comandos y menús
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return interaction.reply({ content: 'Este comando no existe', ephemeral: true });

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      interaction.reply({ content: 'Hubo un error al ejecutar este comando', ephemeral: true });
    }
    return;
  }

  // Ticket: selección de categoría
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_menu') {
    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_${interaction.values[0]}`)
      .setTitle('SOPORTE DE HYTACRAFT')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('usuario').setLabel('Nombre de usuario').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('modalidad').setLabel('Modalidad').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('descripcion').setLabel('Descripción o comentario').setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );
    await interaction.showModal(modal);
  }

  // Ticket: crear canal
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
    const categoria = interaction.customId.split('_')[2];
    const usuario = interaction.fields.getTextInputValue('usuario');
    const modalidad = interaction.fields.getTextInputValue('modalidad');
    const descripcion = interaction.fields.getTextInputValue('descripcion');
    const ticketId = ticketCounter++;
    const channelName = `🟢-ticket-${ticketId}`;

    const ticketChannel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: TICKETS_CATEGORY_ID,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ],
    });

    const infoEmbed = new EmbedBuilder()
      .setTitle('📝 Detalles del Ticket')
      .addFields(
        { name: '👤 Usuario', value: usuario, inline: true },
        { name: '🎮 Modalidad', value: modalidad, inline: true },
        { name: '📝 Descripción', value: descripcion },
        { name: '🧑‍💼 Reclamado por', value: '> (Este ticket no ha sido reclamado)' },
        { name: '❗ Importante', value: '¡Recuerda no mencionar al Staff! Te atenderán lo antes posible.' }
      )
      .setFooter({ text: `Creado el ${new Date().toLocaleString()}` })
      .setColor(0x38caea);

    const statusMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_status')
      .setPlaceholder('Selecciona el estado del ticket...')
      .addOptions([
        { label: 'En revisión', emoji: '🟡', value: 'en_revision' },
        { label: 'Cerrar Ticket', emoji: '🔴', value: 'cerrar' },
        { label: 'Urgente ⚠️', emoji: '⚠️', value: 'urgente' },
      ]);

    const row = new ActionRowBuilder().addComponents(statusMenu);
    const ticketMessage = await ticketChannel.send({ embeds: [infoEmbed], components: [row] });

    ticketMetadata.set(ticketChannel.id, {
      autorId: interaction.user.id,
      categoria,
      usuario,
      modalidad,
      descripcion,
      infoMessageId: ticketMessage.id,
      estado: 'abierto',
      urgente: false,
    });

    await interaction.reply({ content: `✅ Tu ticket ha sido creado: ${ticketChannel}`, ephemeral: true });
  }

  // Ticket: cambiar estado
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_status') {
    const meta = ticketMetadata.get(interaction.channel.id);
    if (!meta) return interaction.reply({ content: '❌ No se encontró información del ticket.', ephemeral: true });

    let newName = interaction.channel.name;
    const status = interaction.values[0];

    if (status === 'en_revision') {
      newName = newName.replace('🟢', '🟡');
      await interaction.channel.send({ embeds: [new EmbedBuilder().setTitle('🔄 Ticket en Revisión').setDescription(`Este ticket fue marcado como "En Revisión" por ${interaction.user}`).setColor(0xFAA61A)] });
    } else if (status === 'cerrar') {
      newName = newName.replace(/^.\-/, '🔴-');
      await interaction.channel.setParent(CLOSED_CATEGORY_ID);
      const embed = new EmbedBuilder().setTitle('🛑 Ticket Cerrado').setDescription(`Este ticket fue cerrado por ${interaction.user}`).setColor(0xAE03DE);
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('delete_ticket').setLabel('🗑️ Eliminar').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('reopen_ticket').setLabel('🔓 Re-Abrir').setStyle(ButtonStyle.Secondary)
      );
      await interaction.channel.send({ embeds: [embed], components: [buttons] });
    } else if (status === 'urgente') {
      newName = newName.replace(/^.\-/, '⚠️-');
      meta.urgente = true;
    }

    await interaction.channel.setName(newName);
    meta.estado = status;
    await interaction.reply({ content: `✅ Estado actualizado: ${status}`, ephemeral: true });
  }

  // Ticket: botones
  if (interaction.isButton()) {
    const meta = ticketMetadata.get(interaction.channel.id);
    if (!meta) return interaction.reply({ content: '❌ No se encontró información del ticket.', ephemeral: true });

    if (interaction.customId === 'delete_ticket') {
      await interaction.reply({ content: '✅ Eliminando ticket...', ephemeral: true });
      await interaction.channel.delete();
    } else if (interaction.customId === 'reopen_ticket') {
      await interaction.channel.setParent(TICKETS_CATEGORY_ID);
      const newName = interaction.channel.name.replace(/^.\-/, '🟢-');
      await interaction.channel.setName(newName);
      meta.estado = 'reabierto';
      await interaction.reply({ content: '✅ Ticket reabierto.', ephemeral: true });
    }
  }
});

// Comando para crear el menú de tickets
client.on('messageCreate', async (message) => {
  if (message.content === '!setticketchannel' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    const embed = new EmbedBuilder()
      .setTitle('👉 **AYUDA AL JUGADOR** 👈')
      .setDescription('**¡Hola, querido usuario**! Si necesitas ayuda, hacer un reporte o tienes algun problema, no dudes en abrir un ticket aqui, te estara atendiendo un personal./n n> **ADVERTENCIA**: Si abres un ticket para bromear, serás baneado permanentemente del **Discord**.')
      .setColor(0x38caea)
      .setImage('https://media.discordapp.net/attachments/1382097919506776085/1382445129264005270/Sin_titulo-2.png?ex=684b2ddb&is=6849dc5b&hm=d81058810b5c2d1983a8a550922cce894aa2add857d67efa9b7ae96470b27af1&=&format=webp&quality=lossless&width=1860&height=391');

    const menu = new StringSelectMenuBuilder()
      .setCustomId('ticket_menu')
      .setPlaceholder('Selecciona tu problema')
      .addOptions([
        { label: 'General', emoji: '🌍', value: 'general' },
        { label: 'Bugs', emoji: '🛠️', value: 'bugs' },
        { label: 'Reportar jugador', emoji: '❌', value: 'reportar_jugador' },
        { label: 'Apelacion', emoji: '🙏', value: 'apelacion' },
        { label: 'Creador de contenido', emoji: '🎥', value: 'creador_contenido' },
        { label: 'Tienda Web', emoji: '🛒', value: 'tienda_web' },
        { label: 'Reportar STAFF', emoji: '⭕', value: 'reportar_staff' },
        { label: 'Otros', emoji: '❓', value: 'otros' },
      ]);

    const row = new ActionRowBuilder().addComponents(menu);
    await message.channel.send({ embeds: [embed], components: [row] });
  }
});

// Express API para mantener el bot vivo en Render
app.get('/', (req, res) => {
  res.send('¡Bot de Discord está corriendo!');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor web escuchando en el puerto ${port}`);
});

// Login del bot
client.login(process.env.TOKEN);
