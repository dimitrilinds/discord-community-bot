// ═══════════════════════════════════════════════════════
//  DS6Music Discord Bot — Multi-Servidor v2.0
//  Funciona en cualquier servidor de Discord
// ═══════════════════════════════════════════════════════
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActivityType,
        PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle,
        ChannelType, REST, Routes, SlashCommandBuilder,
        ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ── Token ──
const TOKEN = process.env.DISCORD_TOKEN; // Configura DISCORD_TOKEN en tu archivo .env

// ── Dueño global del bot (acceso total en cualquier servidor) ──
const BOT_OWNER_ID = '752530531110879233';
function isBotOwner(userOrMember) {
  if (!userOrMember) return false;
  const id = userOrMember.id || userOrMember.user?.id;
  return id === BOT_OWNER_ID;
}

// ── Directorio de datos por servidor ──
const DATA_DIR = path.join(__dirname, 'guild_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ══════════════════════════════════════════════════════
//  GESTIÓN DE DATOS POR SERVIDOR (guildId)
// ══════════════════════════════════════════════════════
function guildDir(guildId) {
  const dir = path.join(DATA_DIR, guildId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadJSON(filePath, def = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) { return def; }
}
function saveJSON(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); } catch(e) {}
}

// Config del servidor (canales, roles, etc.)
function loadConfig(guildId) {
  return loadJSON(path.join(guildDir(guildId), 'config.json'), {
    guildId,
    channels: {},
    roles: {},
    levelRoles: {},
    sorteoMeta: 150,
    sorteoActive: false,
    setupDone: false
  });
}
function saveConfig(guildId, data) {
  saveJSON(path.join(guildDir(guildId), 'config.json'), data);
}

// XP por servidor
function loadXP(guildId)    { return loadJSON(path.join(guildDir(guildId), 'xp.json'), {}); }
function saveXP(guildId, d) { saveJSON(path.join(guildDir(guildId), 'xp.json'), d); }

// Coins por servidor
function loadCoins(guildId)    { return loadJSON(path.join(guildDir(guildId), 'coins.json'), {}); }
function saveCoins(guildId, d) { saveJSON(path.join(guildDir(guildId), 'coins.json'), d); }

// Daily por servidor
function loadDaily(guildId)    { return loadJSON(path.join(guildDir(guildId), 'daily.json'), {}); }
function saveDaily(guildId, d) { saveJSON(path.join(guildDir(guildId), 'daily.json'), d); }

// Invitaciones por servidor
function loadInvites(guildId)    { return loadJSON(path.join(guildDir(guildId), 'invites.json'), { invites: {}, invited_by: {} }); }
function saveInvites(guildId, d) { saveJSON(path.join(guildDir(guildId), 'invites.json'), d); }

// Warns de moderación por servidor
function loadWarns(guildId)    { return loadJSON(path.join(guildDir(guildId), 'warns.json'), {}); }
function saveWarns(guildId, d) { saveJSON(path.join(guildDir(guildId), 'warns.json'), d); }

// Tags/etiquetas personalizadas por servidor
function loadTags(guildId)    { return loadJSON(path.join(guildDir(guildId), 'tags.json'), {}); }
function saveTags(guildId, d) { saveJSON(path.join(guildDir(guildId), 'tags.json'), d); }

// Configuración de bienvenida por servidor
function loadWelcome(guildId) {
  return loadJSON(path.join(guildDir(guildId), 'welcome.json'), {
    enabled: true,
    channel: null,
    message: '¡Bienvenido/a {user} al servidor **{server}**! 🎉 Eres el miembro #**{count}**.',
    dmEnabled: true,
    dmMessage: null,
    color: 0xF1C40F,
    thumbnail: true,
    autoRoles: [],
  });
}
function saveWelcome(guildId, d) { saveJSON(path.join(guildDir(guildId), 'welcome.json'), d); }

// Auto-roles por servidor
function loadAutoRoles(guildId) { return loadJSON(path.join(guildDir(guildId), 'autoroles.json'), { roles: [] }); }
function saveAutoRoles(guildId, d) { saveJSON(path.join(guildDir(guildId), 'autoroles.json'), d); }

// ── Anti-spam: mapa de mensajes recientes ──
const spamMap = new Map();

function checkSpam(message) {
  const cfg = loadConfig(message.guild.id);
  if (!cfg.antispam || !cfg.antispam.enabled) return false;
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const window = (cfg.antispam.window || 5) * 1000;
  const limit  = cfg.antispam.limit  || 5;
  const times = (spamMap.get(key) || []).filter(t => now - t < window);
  times.push(now);
  spamMap.set(key, times);
  return times.length >= limit;
}

// ── Helper: verificar si es Staff/Mod/Admin ──
function isStaff(member) {
  if (!member) return false;
  // El dueño del bot siempre es staff en cualquier servidor
  if (isBotOwner(member.user || member)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.KickMembers)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.BanMembers)) return true;
  const staffNames = ['staff', 'moderador', 'mod', 'admin', 'owner', 'dueño', 'helper'];
  return member.roles.cache.some(r => staffNames.some(n => r.name.toLowerCase().includes(n)));
}

// ── Helper: parsear duración (ej: 10m, 2h, 1d) ──
function parseDuration(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const val = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return val * mult[unit];
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.floor(ms/1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms/60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h`;
  return `${Math.floor(ms/86400000)}d`;
}

// ── Migrar datos del servidor principal si existen ──
function migrateMainGuildData(guildId) {
  const dir = guildDir(guildId);
  const files = [
    { src: path.join(__dirname, 'xp_data.json'),    dst: path.join(dir, 'xp.json') },
    { src: path.join(__dirname, 'coins_data.json'), dst: path.join(dir, 'coins.json') },
    { src: path.join(__dirname, 'daily_data.json'), dst: path.join(dir, 'daily.json') },
    { src: path.join(__dirname, 'invites.json'),    dst: path.join(dir, 'invites.json') },
  ];
  for (const f of files) {
    if (fs.existsSync(f.src) && !fs.existsSync(f.dst)) {
      try { fs.copyFileSync(f.src, f.dst); console.log(`[Migrate] ${f.src} → ${f.dst}`); } catch(e) {}
    }
  }
  // Migrar config principal
  const cfgDst = path.join(dir, 'config.json');
  if (!fs.existsSync(cfgDst)) {
    try {
      const mainCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
      const roleIds = JSON.parse(fs.readFileSync(path.join(__dirname, 'role_ids.json'), 'utf8'));
      const cfg = {
        guildId,
        setupDone: true,
        sorteoMeta: 150,
        sorteoActive: false,
        channels: {
          bienvenidos:      '1503670578278699089',
          reglas:           '1503670408887537704',
          comandos:         '1503670462000009286',
          suscripciones:    '1503670526927835256',
          anuncios:         '1503670419566362667',
          logs:             '1503670690153496597',
          top3:             '1503683449356025866',
          sorteos:          '1503799677114646528',
          soporte:          '1503913524521472011',
          verificacion:     '1503677166901137481',
          chatES:           '1503670587636322315',
          chatEN:           '1503809204115210250',
          chatPT:           '1503809243676147922',
          novedades:        '1503670430634999828',
          staffChat:        '1503670677788430356',
          dailyRewards:     '1503835051354226940',
          tiendaDescuentos: '1504314832713683024',
        },
        roles: roleIds,
        levelRoles: {
          '5':  '1503835044605726751',
          '10': '1503835046086443210',
          '20': '1503835046841290762',
          '50': '1503835047281688606',
        },
        ticketCategoryId: '1503670628660805712',
        ticketRoles: {
          staff: '1503670328923131944',
          owner: '1503670317804158991',
        }
      };
      saveJSON(cfgDst, cfg);
      console.log(`[Migrate] Config principal migrada para guild ${guildId}`);
    } catch(e) { console.log('[Migrate] Error migrando config:', e.message); }
  }
}

// ══════════════════════════════════════════════════════
//  SISTEMA DE XP Y NIVELES
// ══════════════════════════════════════════════════════
function xpRequiredForLevel(level) {
  if (level === 1) return 25;
  if (level === 2) return 50;
  if (level === 3) return 100;
  if (level === 4) return 150;
  if (level === 5) return 200;
  return 200 + (level - 5) * 50;
}

function getLevel(xp) {
  let level = 0, totalRequired = 0;
  while (true) {
    level++;
    totalRequired += xpRequiredForLevel(level);
    if (xp < totalRequired) return level - 1 || 1;
    if (level >= 100) return 100;
  }
}

function xpForNextLevel(currentLevel) { return xpRequiredForLevel(currentLevel + 1); }

function xpAccumulated(level) {
  let total = 0;
  for (let i = 1; i <= level; i++) total += xpRequiredForLevel(i);
  return total;
}

const xpCooldown = new Map(); // key: guildId+userId

async function addXP(member, amount) {
  const guildId = member.guild.id;
  const userId  = member.id;
  const key     = `${guildId}:${userId}`;

  const now = Date.now();
  if (xpCooldown.has(key) && now - xpCooldown.get(key) < 60000) return { levelUp: false };
  xpCooldown.set(key, now);

  const xpData = loadXP(guildId);
  if (!xpData[userId]) xpData[userId] = { xp: 0, level: 1 };

  const oldLevel = getLevel(xpData[userId].xp);
  xpData[userId].xp += amount;
  const newLevel = getLevel(xpData[userId].xp);
  xpData[userId].level = newLevel;
  saveXP(guildId, xpData);

  if (newLevel > oldLevel) {
    await assignLevelRole(member, newLevel);
    const bonus = newLevel * 25;
    addCoinsAmount(guildId, userId, bonus);
    return { levelUp: true, newLevel, bonus };
  }
  return { levelUp: false };
}

async function assignLevelRole(member, level) {
  try {
    const cfg = loadConfig(member.guild.id);
    const levelRoles = cfg.levelRoles || {};
    for (const [, roleId] of Object.entries(levelRoles)) {
      if (member.roles.cache.has(roleId)) await member.roles.remove(roleId).catch(() => {});
    }
    const thresholds = [50, 20, 10, 5];
    for (const threshold of thresholds) {
      if (level >= threshold) {
        const roleId = levelRoles[String(threshold)];
        if (roleId) {
          const role = member.guild.roles.cache.get(roleId);
          if (role) await member.roles.add(role).catch(() => {});
        }
        break;
      }
    }
  } catch(e) {}
}

// ══════════════════════════════════════════════════════
//  SISTEMA DE COINS
// ══════════════════════════════════════════════════════
function addCoinsAmount(guildId, userId, amount) {
  const coins = loadCoins(guildId);
  if (!coins[userId]) coins[userId] = 0;
  coins[userId] += amount;
  saveCoins(guildId, coins);
  return coins[userId];
}

function getCoinsAmount(guildId, userId) {
  const coins = loadCoins(guildId);
  return coins[userId] || 0;
}

function spendCoinsAmount(guildId, userId, amount) {
  const coins = loadCoins(guildId);
  if (!coins[userId] || coins[userId] < amount) return false;
  coins[userId] -= amount;
  saveCoins(guildId, coins);
  return true;
}

// ══════════════════════════════════════════════════════
//  SISTEMA DE IDIOMAS
// ══════════════════════════════════════════════════════
function getUserLang(member) {
  if (!member) return 'es';
  if (member.roles && member.roles.cache) {
    if (member.roles.cache.some(r => r.name.includes('English'))) return 'en';
    if (member.roles.cache.some(r => r.name.includes('Português') || r.name.includes('Portugues'))) return 'pt';
  }
  if (member.user && member.user.locale) {
    const loc = member.user.locale.toLowerCase();
    if (loc.startsWith('en')) return 'en';
    if (loc.startsWith('pt')) return 'pt';
  }
  return 'es';
}

// ══════════════════════════════════════════════════════
//  HELPER HTTP
// ══════════════════════════════════════════════════════
function httpGet(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    let body = '';
    const req = mod.get(url, (res) => {
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

// ── Suscripciones IMVU (solo servidor principal) ──
const BOT_SUB_FILES = [
  '/root/imvu-bot/data/subscriptions.json',
  '/root/imvu-bot2/data/subscriptions.json',
  '/root/imvu-bot3/data/subscriptions.json',
  '/root/imvu-bot4/data/subscriptions.json',
];
function getAllSubscriptions() {
  const allSubs = [], seen = new Set();
  for (const filePath of BOT_SUB_FILES) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      let subs = [];
      if (data.subscriptions && typeof data.subscriptions === 'object' && !Array.isArray(data.subscriptions))
        subs = Object.values(data.subscriptions);
      if (data.subscriptions && Array.isArray(data.subscriptions))
        subs = data.subscriptions;
      for (const [key, val] of Object.entries(data))
        if (key.startsWith('room-') && typeof val === 'object' && val.roomId) subs.push(val);
      for (const s of subs) {
        if (!s || typeof s !== 'object') continue;
        const key = s.roomId || `${s.contractorUsername}-${filePath}`;
        if (!seen.has(key)) { seen.add(key); allSubs.push(s); }
      }
    } catch(e) {}
  }
  return allSubs;
}

// ── Cache de invitaciones por servidor ──
const inviteCaches = new Map(); // guildId → Map(code → uses)

async function refreshInviteCache(guild) {
  try {
    const invites = await guild.invites.fetch();
    const cache = new Map(invites.map(inv => [inv.code, inv.uses || 0]));
    inviteCaches.set(guild.id, cache);
    return cache;
  } catch(e) { return new Map(); }
}

// ── Enviar log ──
async function sendLog(guild, text, color = 0x7289da) {
  try {
    const cfg = loadConfig(guild.id);
    const logId = cfg.channels && cfg.channels.logs;
    if (!logId) return;
    const ch = guild.channels.cache.get(logId);
    if (ch) await ch.send({ embeds: [{ description: text, color }] });
  } catch(e) {}
}

// ══════════════════════════════════════════════════════
//  PANEL DE SORTEOS (por servidor)
// ══════════════════════════════════════════════════════
async function updateSorteoPanel(guild) {
  try {
    const cfg = loadConfig(guild.id);
    const sorteoChId = cfg.channels && cfg.channels.sorteos;
    if (!sorteoChId) return;
    const ch = guild.channels.cache.get(sorteoChId);
    if (!ch) return;

    await guild.members.fetch();
    const memberCount = guild.members.cache.filter(m => !m.user.bot).size;
    const meta = cfg.sorteoMeta || 150;
    const progress = Math.min(memberCount, meta);
    const pct = Math.floor((progress / meta) * 100);
    const filled = Math.floor(pct / 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ¡Sorteos — ${guild.name}!`)
      .setColor(0xF1C40F)
      .setDescription(
        `¡Participa en los sorteos oficiales de **${guild.name}**!\n¡Mantente atento para ganar premios increíbles!\n\n` +
        `**📋 ¿Cómo participar?**\nSolo necesitas ser miembro del servidor.\n¡El ganador es elegido automáticamente al azar entre todos los miembros!\n\n` +
        `**🎟️ ¿Quieres más probabilidades de ganar?**\nInvita amigos al servidor — **cada miembro que invites te da +1 ticket extra** en el sorteo.\nUsa \`!invitaciones\` para ver cuántos puntos tienes.\n\n` +
        `> 📊 Progreso actual: **${memberCount} / ${meta} miembros** — ¡Invita a tus amigos!\n\n` +
        `**[${bar}] ${pct}%**\n\n` +
        `**📊 Ver tu ranking de invitaciones**\n\`!invitaciones\` — Ver tus puntos e invitados\n\`!invitaciones top\` — Ver el ranking completo del servidor\n\n` +
        `**🏅 Ganadores anteriores**\nLos resultados de cada sorteo se anuncian aquí mismo.`
      )
      .setFooter({ text: `${guild.name} • ¡Buena suerte!` })
      .setTimestamp();

    const msgs = await ch.messages.fetch({ limit: 10 });
    const botMsg = msgs.find(m => m.author.bot && m.embeds.length > 0 && m.embeds[0].title && m.embeds[0].title.includes('Sorteo'));
    if (botMsg) await botMsg.edit({ embeds: [embed] });
    else await ch.send({ embeds: [embed] });
  } catch(e) { console.log('[Sorteo] Error panel:', e.message); }
}

// ══════════════════════════════════════════════════════
//  SORTEO AUTOMÁTICO (3 GANADORES)
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
//  SISTEMA DE SORTEOS ACTIVOS (en memoria)
// ══════════════════════════════════════════════════════
const activeSorteos = new Map(); // guildId -> { premio, ganadores, durMs, endsAt, channelId, messageId, participants }

// ══════════════════════════════════════════════════════
//  TOP 3 SALAS (solo servidor principal DS6Music)
// ══════════════════════════════════════════════════════
const MAIN_GUILD_ID = '1503668022512975912';

async function updateTop3Rooms(guild) {
  try {
    const cfg = loadConfig(guild.id);
    const top3ChId = cfg.channels && cfg.channels.top3;
    if (!top3ChId) return;
    const ch = guild.channels.cache.get(top3ChId);
    if (!ch) return;

    // Usar el endpoint oficial de la web para obtener datos en tiempo real
    const data = await httpGet('https://ds6music.com/api/top-rooms');
    if (!data || !data.top) return;
    const top3 = data.top.slice(0, 3).map(room => ({
      roomId: room.roomId || '',
      roomName: room.roomName || room.roomId || '',
      ownerName: (room.roomName || '').replace('Sala de ', ''),
      listeners: room.clientCount || 0,
      song: room.currentSong || '',
      artist: '',
      streamUrl: room.streamLink || '',
      imvuRoomUrl: room.imvuLink || '',
      queue: room.queueLength || 0,
      status: room.status || 'idle'
    }));
    const medalColors = ['🥇', '🥈', '🥉'];
    let desc = top3.length === 0
      ? 'No hay salas activas en este momento.\n\n💡 ¿Quieres aparecer aquí? ¡Contrata DS6Music en [ds6music.com/suscripcion](https://ds6music.com/suscripcion)!'
      : 'Las salas con más oyentes en este momento.\n🔄 **Actualizado cada 10 minutos**\n\n';

    top3.forEach((room, i) => {
      desc += `${medalColors[i]} **Sala de ${room.ownerName || room.roomName}** — ${room.listeners} 👤 oyentes\n`;
      if (room.song) desc += `🎵 *${room.artist ? room.artist + ' — ' : ''}${room.song.slice(0, 60)}*\n`;
      if (room.queue > 0) desc += `📋 Cola: ${room.queue} canción${room.queue !== 1 ? 'es' : ''}\n`;
      const links = [];
      if (room.streamUrl) links.push(`[🔊 Escuchar en vivo](${room.streamUrl})`);
      if (room.imvuRoomUrl) links.push(`[🏠 Ir a la sala](${room.imvuRoomUrl})`);
      if (links.length) desc += links.join(' · ') + '\n';
      desc += '\n';
    });

    if (top3.length > 0) desc += '> 💡 ¿Quieres aparecer aquí? Contrata DS6Music en [ds6music.com/suscripcion](https://ds6music.com/suscripcion)';

    const embed = new EmbedBuilder()
      .setTitle('🏆 Top 3 Salas Más Activas — DS6Music')
      .setDescription(desc)
      .setColor(0xF1C40F)
      .setFooter({ text: `DS6Music • Última actualización: ${new Date().toLocaleString('es-ES')} • ds6music.com` })
      .setTimestamp();

    const msgs = await ch.messages.fetch({ limit: 5 });
    const botMsg = msgs.find(m => m.author.bot && m.embeds.length > 0);
    if (botMsg) await botMsg.edit({ embeds: [embed] });
    else await ch.send({ embeds: [embed] });
  } catch(e) { console.error('[Top3] Error:', e.message); }
}

// ══════════════════════════════════════════════════════
//  SISTEMA DE TICKETS (por servidor)
// ══════════════════════════════════════════════════════
async function setupTicketMessage(guild) {
  try {
    const cfg = loadConfig(guild.id);
    const soporteId = cfg.channels && cfg.channels.soporte;
    if (!soporteId) return;
    const ch = guild.channels.cache.get(soporteId);
    if (!ch) return;

    // Solo enviar si NO existe ya un mensaje del bot con botón de ticket
    const msgs = await ch.messages.fetch({ limit: 20 });
    const existing = msgs.find(m => m.author.id === client.user.id && m.components && m.components.length > 0);
    if (existing) return; // Panel ya existe, no reenviar

    const embed = new EmbedBuilder()
      .setTitle(`🎫 Sistema de Soporte — ${guild.name}`)
      .setColor(0x9B59B6)
      .addFields(
        { name: '📋 ¿Para qué sirve?', value: '• Reportar problemas o incidencias\n• Hacer consultas al Staff\n• Solicitar ayuda o soporte\n• Cualquier consulta privada', inline: false },
        { name: '⚡ Tiempo de respuesta', value: 'Nuestro Staff responde **inmediatamente**.', inline: false },
        { name: '📌 Normas', value: '• Un ticket por consulta\n• Sé respetuoso con el Staff\n• Haz clic en el botón para abrir tu ticket privado', inline: false }
      )
      .setFooter({ text: `${guild.name} • Sistema de Soporte` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_ticket').setLabel('🎫 Abrir Ticket').setStyle(ButtonStyle.Primary)
    );
    await ch.send({ embeds: [embed], components: [row] });
  } catch(e) { console.error('[Tickets] Error setup:', e.message); }
}

// ══════════════════════════════════════════════════════
//  CLIENTE DISCORD
// ══════════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.DirectMessages, GatewayIntentBits.DirectMessageTyping,
  ],
  partials: ['CHANNEL', 'MESSAGE']
});

// ══════════════════════════════════════════════════════
//  EVENTO: READY
// ══════════════════════════════════════════════════════
client.once(Events.ClientReady, async () => {
  console.log(`✅ DS6 Bot v3.0 conectado como ${client.user.tag}`);
  console.log(`📡 Activo en ${client.guilds.cache.size} servidor(es)`);
  client.user.setActivity('❤️ Desarrollado con pasión por Daddy • DS6Music v3.0 • ds6music.com', { type: ActivityType.Watching });

  // ── Registrar Slash Commands globalmente ──
  try {
    const slashCommands = [
      // ── Slash Commands ──
      new SlashCommandBuilder().setName('info').setDescription('Muestra información del bot DS6'),
      new SlashCommandBuilder().setName('ping').setDescription('Muestra la latencia del bot'),
      new SlashCommandBuilder().setName('ayuda').setDescription('Muestra todos los comandos disponibles'),
      new SlashCommandBuilder().setName('nivel').setDescription('Muestra tu nivel y XP actual'),
      new SlashCommandBuilder().setName('coins').setDescription('Muestra tus DS6 Coins'),
      new SlashCommandBuilder().setName('perfil').setDescription('Muestra tu perfil completo'),
      new SlashCommandBuilder().setName('top').setDescription('Ranking de XP del servidor'),
      new SlashCommandBuilder().setName('invitaciones').setDescription('Muestra tus invitaciones y tickets de sorteo'),
      // ── Context Menu Commands (clic derecho en usuario) ──
      new ContextMenuCommandBuilder().setName('Ver Perfil DS6').setType(ApplicationCommandType.User),
      new ContextMenuCommandBuilder().setName('Ver Coins DS6').setType(ApplicationCommandType.User),
      new ContextMenuCommandBuilder().setName('Ver Nivel DS6').setType(ApplicationCommandType.User),
      new ContextMenuCommandBuilder().setName('Ver Invitaciones DS6').setType(ApplicationCommandType.User),
      // ── Context Menu Commands (clic derecho en mensaje) ──
      new ContextMenuCommandBuilder().setName('Reportar Mensaje').setType(ApplicationCommandType.Message),
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    console.log(`✅ ${slashCommands.length} slash commands registrados globalmente`);
  } catch(e) {
    console.log('[SlashCmds] Error registrando comandos:', e.message);
  }

  // Migrar datos del servidor principal
  migrateMainGuildData(MAIN_GUILD_ID);

  // Inicializar cada servidor
  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.members.fetch();
      await refreshInviteCache(guild);

      if (guild.id === MAIN_GUILD_ID) {
        setTimeout(() => setupTicketMessage(guild).catch(() => {}), 6000);
        setTimeout(() => updateTop3Rooms(guild).catch(() => {}), 8000);
      }
    } catch(e) { console.log(`[Ready] Error init guild ${guild.id}:`, e.message); }
  }

  // Intervalos globales
  setInterval(() => {
    for (const [, guild] of client.guilds.cache) {
      if (guild.id === MAIN_GUILD_ID) updateTop3Rooms(guild).catch(() => {});
    }
  }, 10 * 60 * 1000);
});

// ══════════════════════════════════════════════════════
//  EVENTO: NUEVO SERVIDOR (cuando alguien agrega el bot)
// ══════════════════════════════════════════════════════
client.on(Events.GuildCreate, async (guild) => {
  console.log(`[GuildCreate] Bot agregado a: ${guild.name} (${guild.id})`);
  
  // Enviar mensaje de bienvenida al canal del sistema o al primer canal de texto
  try {
    const channel = guild.systemChannel || 
      guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(guild.members.me).has('SendMessages'));
    
    if (channel) {
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const embed = new EmbedBuilder()
        .setTitle('👋 ¡Hola! Soy DS6 Bot')
        .setThumbnail(guild.client.user.displayAvatarURL({ forceStatic: false }))
        .setDescription(
          `¡Gracias por agregarme a **${guild.name}**! 🎉\n\n` +
          `Soy **DS6 Bot**, tu asistente completo para gestionar y animar tu servidor.\n\n` +
          `**¿Por dónde empezar?**\n` +
          `> 1️⃣ Escribe \`!setup\` para configurarme automáticamente\n` +
          `> 2️⃣ Usa \`!comandos\` para ver todo lo que puedo hacer\n` +
          `> 3️⃣ Usa \`!ayuda\` para una guía completa\n\n` +
          `**¿Qué puedo hacer?**\n` +
          `🛡️ Moderación completa (kick, ban, silenciar, warns)\n` +
          `💰 Sistema de economía (coins, daily, trabajo, sorteos)\n` +
          `⭐ Sistema de niveles y XP\n` +
          `🎮 Comandos de diversión (trivia, juegos, memes)\n` +
          `🎫 Sistema de tickets de soporte\n` +
          `🚫 Anti-spam automático\n` +
          `🎉 Bienvenida personalizable para nuevos miembros\n\n` +
          `Usa \`!comandos\` para ver todo lo que puedo hacer.`
        )
        .setColor(0x8B0000)
        .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • Usa !setup para comenzar' })
        .setTimestamp();
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🌐 ds6music.com')
          .setStyle(ButtonStyle.Link)
          .setURL('https://ds6music.com'),
        new ButtonBuilder()
          .setLabel('📋 Ver Comandos')
          .setStyle(ButtonStyle.Secondary)
          .setCustomId('welcome_comandos'),
      );
      
      await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }
  } catch(e) { console.log('[GuildCreate] Error bienvenida:', e.message); }
  try {
    await guild.members.fetch();
    await refreshInviteCache(guild);

    // Crear config básica si no existe
    const cfg = loadConfig(guild.id);
    if (!cfg.setupDone) {
      // Auto-detectar canales por nombre
      const autoChannels = {};
      const channelMap = {
        sorteos: ['sorteos', 'giveaway', 'sorteo'],
        soporte: ['soporte-tickets', 'tickets', 'support', 'soporte'],
        bienvenidos: ['bienvenidos', 'bienvenidas', 'welcome'],
        logs: ['logs', 'log', 'audit-log'],
        chatES: ['chat-general-es', 'chat-general', 'general'],
      };
      for (const [key, names] of Object.entries(channelMap)) {
        for (const name of names) {
          const ch = guild.channels.cache.find(c => c.name.toLowerCase().includes(name) && c.type === ChannelType.GuildText);
          if (ch) { autoChannels[key] = ch.id; break; }
        }
      }
      cfg.channels = autoChannels;
      saveConfig(guild.id, cfg);
    }

    // Enviar mensaje de bienvenida al owner
    const owner = await guild.fetchOwner();
    if (owner) {
      const embed = new EmbedBuilder()
        .setTitle('🎵 ¡Gracias por agregar DS6 Bot!')
        .setDescription(
          `👑 Hola **${owner.user.username}**, soy **DS6 Bot** y acabo de unirme a tu servidor **${guild.name}**. ¡Gracias por agregarme! 🎉\n\n` +
          `**🚀 Primeros pasos:**\n` +
          `> 1️⃣ Escribe \`!setup\` en tu servidor para configurarme automáticamente\n` +
          `> 2️⃣ Usa \`!comandos\` para ver todo lo que puedo hacer\n` +
          `> 3️⃣ Usa \`!ayuda\` para una guía completa\n\n` +
          `**🛡️ Moderación:** \`!kick\` \`!ban\` \`!silenciar\` \`!warn\` \`!clear\`\n` +
          `**💰 Economía:** \`!coins\` \`!daily\` \`!trabajo\` \`!sorteo\`\n` +
          `**⭐ Niveles:** \`!nivel\` \`!top\` \`!perfil\`\n` +
          `**🎮 Diversión:** \`!8ball\` \`!trivia\` \`!rps\` \`!chiste\`\n` +
          `**🎫 Tickets:** \`!ticket\` — Sistema de soporte\n\n` +
          `¡Escribe \`!ayuda\` para ver la guía completa!`
        )
        .setColor(0xF1C40F)
        .setFooter({ text: 'DS6 Bot v3.0' });
      await owner.send({ embeds: [embed] }).catch(() => {});
    }
  } catch(e) { console.log(`[GuildCreate] Error:`, e.message); }
});

// ══════════════════════════════════════════════════════
//  EVENTO: NUEVO MIEMBRO
// ══════════════════════════════════════════════════════
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const guild = member.guild;
    const guildId = guild.id;
    const cfg = loadConfig(guildId);
    const welcomeCfg = loadWelcome(guildId);

    // ── Auto-roles al entrar ──
    const autoRolesCfg = loadAutoRoles(guildId);
    if (autoRolesCfg.roles && autoRolesCfg.roles.length > 0) {
      for (const roleId of autoRolesCfg.roles) {
        const role = guild.roles.cache.get(roleId);
        if (role) await member.roles.add(role).catch(() => {});
      }
    } else {
      // Fallback: asignar rol Miembro si existe
      const memberRole = guild.roles.cache.find(r => r.name.toLowerCase().includes('miembro') || r.name.toLowerCase() === 'member');
      if (memberRole) await member.roles.add(memberRole).catch(() => {});
    }

    // Tracking de invitaciones
    try {
      const newInvites = await guild.invites.fetch();
      const cache = inviteCaches.get(guildId) || new Map();
      let usedInvite = null;
      for (const [code, invite] of newInvites) {
        const cachedUses = cache.get(code) || 0;
        if (invite.uses > cachedUses) { usedInvite = invite; break; }
      }
      inviteCaches.set(guildId, new Map(newInvites.map(inv => [inv.code, inv.uses])));
      if (usedInvite && usedInvite.inviter) {
        const inviterId = usedInvite.inviter.id;
        const inviterName = usedInvite.inviter.username;
        const data = loadInvites(guildId);
        if (!data.invites[inviterId]) data.invites[inviterId] = { name: inviterName, count: 0, members: [] };
        data.invites[inviterId].count++;
        data.invites[inviterId].name = inviterName;
        data.invites[inviterId].members.push({ id: member.user.id, name: member.user.username, date: new Date().toISOString() });
        data.invited_by[member.user.id] = { inviterId, inviterName };
        saveInvites(guildId, data);
      }
    } catch(e) {}

    // ── Bienvenida en canal personalizable ──
    try {
      if (welcomeCfg.enabled) {
        const wChId = welcomeCfg.channel || (cfg.channels && cfg.channels.bienvenidos);
        const wCh = wChId ? guild.channels.cache.get(wChId) : null;
        if (wCh) {
          const wMsg = (welcomeCfg.message || '¡Bienvenido/a {user} a **{server}**! 🎉 Eres el miembro #**{count}**.')
            .replace(/{user}/g, `<@${member.id}>`)
            .replace(/{username}/g, member.user.username)
            .replace(/{server}/g, guild.name)
            .replace(/{count}/g, guild.memberCount)
            .replace(/{id}/g, member.id);
          const wEmbed = new EmbedBuilder()
            .setDescription(wMsg)
            .setColor(welcomeCfg.color || 0xF1C40F)
            .setTimestamp()
            .setFooter({ text: `${guild.name} • Miembro #${guild.memberCount}` });
          if (welcomeCfg.thumbnail !== false) wEmbed.setThumbnail(member.user.displayAvatarURL({ forceStatic: false }));
          if (welcomeCfg.title) wEmbed.setTitle(welcomeCfg.title.replace(/{username}/g, member.user.username).replace(/{server}/g, guild.name));
          else wEmbed.setTitle(`🎉 ¡Bienvenido/a, ${member.user.username}!`);
          if (welcomeCfg.banner) wEmbed.setImage(welcomeCfg.banner);
          await wCh.send({ content: `<@${member.id}>`, embeds: [wEmbed] }).catch(() => {});
        }
      }
    } catch(e) {}

    // ── Bienvenida por DM personalizable ──
    try {
      if (welcomeCfg.dmEnabled !== false) {
        const dmMsg = welcomeCfg.dmMessage ||
          `¡Hola **${member.user.username}**! 🎉 Bienvenido/a a **${guild.name}**\n\nUsa \`!ayuda\` para ver todos los comandos.\nUsa \`!daily\` para reclamar tu recompensa diaria.\nUsa \`!coins\` para ver tus DS6 Coins.`;
        const dmEmbed = new EmbedBuilder()
          .setTitle(`🎉 ¡Bienvenido/a a ${guild.name}!`)
          .setDescription(dmMsg
            .replace(/{user}/g, member.user.username)
            .replace(/{server}/g, guild.name)
            .replace(/{count}/g, guild.memberCount))
          .setColor(welcomeCfg.color || 0xF1C40F)
          .setThumbnail(guild.iconURL({ dynamic: false }) || null)
          .setFooter({ text: `${guild.name} • ds6music.com` })
          .setTimestamp();
        await member.send({ embeds: [dmEmbed] }).catch(() => {});
      }
    } catch(e) {}

  } catch(e) { console.error('[GuildMemberAdd] Error:', e.message); }
});

// ══════════════════════════════════════════════════════
//  EVENTO: MIEMBRO SALE
// ══════════════════════════════════════════════════════
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const guild = member.guild;
    const guildId = guild.id;
    const cfg = loadConfig(guildId);

    // ── Mensaje de despedida ──
    const despedidaChId = cfg.channels?.bienvenidos || cfg.channels?.general;
    const despedidaCh = despedidaChId ? guild.channels.cache.get(despedidaChId) : null;
    if (despedidaCh) {
      const msgTemplate = (cfg.mensajes && cfg.mensajes.despedida)
        || '**{username}** ha abandonado **{server}**. Ahora somos **{count}** miembros.';
      const msgFinal = msgTemplate
        .replace(/{user}/g, member.user.tag)
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, guild.name)
        .replace(/{count}/g, guild.memberCount)
        .replace(/{fecha}/g, new Date().toLocaleDateString('es-ES'));
      const embed = new EmbedBuilder()
        .setDescription(msgFinal)
        .setColor(0x95A5A6)
        .setThumbnail(member.user.displayAvatarURL({ forceStatic: false }))
        .setFooter({ text: `${guild.name} • Miembros: ${guild.memberCount}` })
        .setTimestamp();
      await despedidaCh.send({ embeds: [embed] }).catch(() => {});
    }
  } catch(e) { console.error('[GuildMemberRemove] Error:', e.message); }
});

// ══════════════════════════════════════════════════════
//  EVENTO: MENSAJES (XP + COMANDOS)
// ══════════════════════════════════════════════════════
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guild.id;

  // Dar XP por mensaje
  try {
    const result = await addXP(message.member, 1);
    if (result.levelUp) {
      const cfg = loadConfig(guildId);
      const chatChId = cfg.channels && cfg.channels.chatES;
      const notifCh = chatChId ? message.guild.channels.cache.get(chatChId) : message.channel;
      if (notifCh) {
        const embed = new EmbedBuilder()
          .setTitle('⬆️ ¡Subiste de nivel!')
          .setDescription(`🎉 <@${message.author.id}> ha alcanzado el **Nivel ${result.newLevel}**!\n🪙 Bonus: **+${result.bonus} DS6 Coins**`)
          .setColor(0xF1C40F);
        await notifCh.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch(e) {}

  // ── Anti-Spam automático ──
  if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !isStaff(message.member)) {
    if (checkSpam(message)) {
      try {
        await message.delete().catch(() => {});
        const cfg = loadConfig(guildId);
        const muteMs = parseDuration(cfg.antispam && cfg.antispam.muteDuration || '5m') || 300000;
        await message.member.timeout(muteMs, 'Anti-spam automático').catch(() => {});
        const warn = await message.channel.send(`⚠️ <@${message.author.id}> has sido silenciado por **${formatDuration(muteMs)}** por spam.`);
        setTimeout(() => warn.delete().catch(() => {}), 8000);
        await sendLog(message.guild, `🚫 **Anti-spam** | ${message.author.tag} silenciado por ${formatDuration(muteMs)} en <#${message.channel.id}>`, 0xFF6600);
      } catch(e) {}
      return;
    }
  }

  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  try {

  // ══════════════════════════════════════════════════════
  //  COMANDO: !setup (configurar el bot en un servidor)
  // ══════════════════════════════════════════════════════
  if (command === 'setup') {
    if (!isBotOwner(message.author) &&
        !message.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
        !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply('❌ Solo los **administradores** del servidor pueden usar `!setup`.');
    }

    await message.channel.send(`⚙️ **Configurando DS6 Bot en ${message.guild.name}...**`);

    const guild = message.guild;
    const cfg = loadConfig(guildId);

    // ── Auto-detectar canales por nombre (búsqueda amplia) ──
    const channelMap = {
      sorteos:     ['sorteos', 'giveaway', 'sorteo', 'giveaways', 'rifas'],
      soporte:     ['soporte-tickets', 'soporte', 'tickets', 'ticket', 'support', 'help', 'ayuda'],
      bienvenidos: ['bienvenidos', 'bienvenidas', 'welcome', 'bienvenido', 'entrada'],
      logs:        ['logs', 'log', 'audit-log', 'bot-logs', 'registro', 'moderacion'],
      chatES:      ['chat-general-es', 'chat-general', 'general', 'chat', 'conversacion'],
      chatEN:      ['chat-general-en', 'chat-english', 'english', 'ingles'],
      chatPT:      ['chat-general-pt', 'chat-portugues', 'portugues', 'brasil'],
      anuncios:    ['anuncios', 'announcements', 'noticias', 'avisos', 'news'],
      top3:        ['top-3-salas', 'top-salas', 'top3', 'top-rooms', 'ranking-salas'],
    };

    const found = {};
    for (const [key, names] of Object.entries(channelMap)) {
      for (const name of names) {
        const ch = guild.channels.cache.find(c => c.name.toLowerCase().includes(name) && c.type === ChannelType.GuildText);
        if (ch) { found[key] = ch.id; break; }
      }
    }

    // No asignar canales por fallback - solo los que realmente existen

    cfg.channels = { ...cfg.channels, ...found };

    // ── Meta de sorteo adaptativa según tamaño del servidor ──
    await guild.members.fetch().catch(() => {});
    const currentMembers = guild.members.cache.filter(m => !m.user.bot).size;
    let sorteoMeta;
    if (currentMembers < 20) sorteoMeta = 50;
    else if (currentMembers < 50) sorteoMeta = 100;
    else if (currentMembers < 100) sorteoMeta = 150;
    else if (currentMembers < 200) sorteoMeta = 250;
    else sorteoMeta = currentMembers + 100;
    cfg.sorteoMeta = cfg.sorteoMeta || sorteoMeta;

    // ── Auto-detectar roles de nivel ──
    const levelRoleMap = {
      '5':  ['activo', 'active', 'nivel5', 'level5'],
      '10': ['regular', 'nivel10', 'level10'],
      '20': ['veterano', 'veteran', 'nivel20', 'level20'],
      '50': ['leyenda', 'legend', 'nivel50', 'level50'],
    };
    const foundLevelRoles = {};
    for (const [level, names] of Object.entries(levelRoleMap)) {
      for (const name of names) {
        const role = guild.roles.cache.find(r => r.name.toLowerCase().includes(name));
        if (role) { foundLevelRoles[level] = role.id; break; }
      }
    }
    if (Object.keys(foundLevelRoles).length > 0) cfg.levelRoles = foundLevelRoles;

    // ── Auto-detectar categoría de tickets ──
    const ticketCat = guild.channels.cache.find(c =>
      c.type === ChannelType.GuildCategory &&
      (c.name.toLowerCase().includes('soporte') || c.name.toLowerCase().includes('support') ||
       c.name.toLowerCase().includes('ticket') || c.name.toLowerCase().includes('ayuda'))
    );
    if (ticketCat) cfg.ticketCategoryId = ticketCat.id;

    // ── Auto-detectar roles de staff ──
    const staffRole = guild.roles.cache.find(r =>
      r.name.toLowerCase().includes('staff') || r.name.toLowerCase().includes('moderador') ||
      r.name.toLowerCase().includes('mod') || r.name.toLowerCase().includes('admin')
    );
    const ownerRole = guild.roles.cache.find(r =>
      r.name.toLowerCase().includes('owner') || r.name.toLowerCase().includes('dueño') ||
      r.name.toLowerCase().includes('fundador') || r.name.toLowerCase().includes('founder')
    );
    cfg.ticketRoles = cfg.ticketRoles || {};
    if (staffRole) cfg.ticketRoles.staff = staffRole.id;
    if (ownerRole) cfg.ticketRoles.owner = ownerRole.id;

    cfg.setupDone = true;
    saveConfig(guildId, cfg);

    // ── Publicar paneles ──

    if (cfg.channels.soporte) await setupTicketMessage(guild).catch(() => {});

    const channelsList = Object.entries(found).map(([k, id]) => `• **${k}**: <#${id}>`).join('\n') || '• Ninguno detectado';
    const rolesList = Object.entries(foundLevelRoles).map(([lvl, id]) => `• Nivel ${lvl}: <@&${id}>`).join('\n') || '• Ninguno detectado (usa `!setrol [nivel] @rol`)';

    const embed = new EmbedBuilder()
      .setTitle('✅ DS6 Bot — Configuración completada')
      .setDescription(
        `El bot ha sido configurado en **${guild.name}**.\n\n` +
        `**📢 Canales detectados:**\n${channelsList}\n\n` +
        `**🏅 Roles de nivel detectados:**\n${rolesList}\n\n` +
        `**💡 Comandos de configuración manual:**\n` +
        `• \`!setcanal soporte #canal\` — Cambiar canal de tickets\n` +
        `• \`!setcanal bienvenidos #canal\` — Canal de bienvenida\n` +
        `• \`!setcanal logs #canal\` — Canal de logs\n` +
        `• \`!setrol 5 @rol\` — Rol para nivel 5\n` +
        `• \`!sorteo meta ${cfg.sorteoMeta}\` — Cambiar meta del sorteo\n\n` +
        `**📋 Próximos pasos:**\n• Usa \`!comandos\` para ver todos los comandos\n• Los miembros pueden usar \`!nivel\`, \`!coins\`, \`!daily\`\n• Usa \`!sortear [duración] [ganadores] [premio]\` para crear sorteos manuales\n• Usa \`!setcanal\` para configurar canales adicionales`
      )
      .setColor(0x00E676)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • !comandos para ver todo' });

    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !ayuda
  // ══════════════════════════════════════════════════════
  if (command === 'ayuda' || command === 'help') {
    const lang = getUserLang(message.member);
    const texts = {
      es: { title: '🎵 Comandos DS6 Bot', desc: 'Lista completa de comandos disponibles.' },
      en: { title: '🎵 DS6 Bot Commands', desc: 'Full list of available commands.' },
      pt: { title: '🎵 Comandos DS6 Bot', desc: 'Lista completa de comandos disponíveis.' }
    };
    const t = texts[lang] || texts['es'];
    const embed = new EmbedBuilder()
      .setTitle(t.title)
      .setDescription(t.desc)
      .addFields(
        { name: '🏆 Niveles y XP', value: '`!nivel [@user]`\n`!top` — Top 10', inline: true },
        { name: '🪙 DS6 Coins', value: '`!coins` `!daily`\n`!transferir @user N`\n`!canjear N`', inline: true },
        { name: '🎉 Sorteos', value: '`!invitaciones`\n`!invitaciones top`', inline: true },
        { name: '🎮 Diversión', value: '`!8ball [pregunta]`\n`!dado` `!moneda`\n`!chiste`\n`!abrazo/beso/slap @user`', inline: true },
        { name: '🏷️ Etiquetas', value: '`!tag [nombre]`\n`!tag add [nombre] [texto]`\n`!tag del [nombre]`\n`!tag list`', inline: true },
        { name: '📊 Info', value: '`!perfil` `!userinfo`\n`!serverinfo` `!avatar`\n`!precio`', inline: true },
        { name: '✅ Verificación & Soporte', value: '`!verificar [IMVU]`\n`!ticket [consulta]`\n`!cerrar`', inline: true },
        { name: '🛡️ Moderación (Staff)', value: '`!kick` `!ban` `!unban`\n`!silenciar @u [10m]`\n`!desilenciar @u`\n`!warn` `!warnings`\n`!clear [N]` `!lock/unlock`\n`!slowmode [seg]`', inline: true },
        { name: '⚙️ Configuración (Admin)', value: '`!config` — Panel principal\n`!bienvenida` — Bienvenida\n`!autoroles` — Roles auto\n`!antispam` — Anti-spam\n`!setup` — Setup inicial', inline: true },
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • !comandos para ver todo' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !nivel / !level / !xp
  // ══════════════════════════════════════════════════════
  if (command === 'nivel' || command === 'level' || command === 'xp') {
    const target = message.mentions.members.first() || message.member;
    const xpData = loadXP(guildId);
    const uid = target.id;
    const userXP = xpData[uid] ? xpData[uid].xp : 0;
    const level = getLevel(userXP);
    const nextLevelXP = xpForNextLevel(level);
    const accXP = xpAccumulated(level);
    const progressXP = userXP - accXP;
    const pct = Math.min(100, Math.floor((progressXP / nextLevelXP) * 100));
    const filled = Math.floor(pct / 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    const allXP = Object.entries(xpData).sort((a, b) => b[1].xp - a[1].xp);
    const rank = allXP.findIndex(([id]) => id === uid) + 1;

    const embed = new EmbedBuilder()
      .setTitle(`📊 Nivel de ${target.user.username}`)
      .setThumbnail(target.user.displayAvatarURL({ forceStatic: false }))
      .addFields(
        { name: '🏅 Nivel', value: `**${level}**`, inline: true },
        { name: '⭐ XP Total', value: `**${userXP}**`, inline: true },
        { name: '🏆 Ranking', value: `**#${rank}**`, inline: true },
        { name: `📈 Progreso al nivel ${level + 1}`, value: `${progressXP} / ${nextLevelXP} XP\n[${bar}] ${pct}%`, inline: false },
      )
      .setColor(0xF1C40F)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • Gana XP chateando' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !top / !ranking
  // ══════════════════════════════════════════════════════
  if (command === 'top' || command === 'ranking' || command === 'leaderboard') {
    const xpData = loadXP(guildId);
    const sorted = Object.entries(xpData).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
    if (sorted.length === 0) return message.reply('📊 Aún no hay datos de XP en este servidor.');

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    let desc = '';
    for (let i = 0; i < sorted.length; i++) {
      const [uid, data] = sorted[i];
      const level = getLevel(data.xp);
      let name = `<@${uid}>`;
      try {
        const member = message.guild.members.cache.get(uid);
        if (member) name = member.user.username;
      } catch(e) {}
      desc += `${medals[i]} **${name}** — Nivel ${level} | ${data.xp} XP\n`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Top 10 — ${message.guild.name}`)
      .setDescription(desc)
      .setColor(0xF1C40F)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • Chatea para subir en el ranking' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !coins / !monedas / !saldo
  // ══════════════════════════════════════════════════════
  if (command === 'coins' || command === 'monedas' || command === 'saldo') {
    const target = message.mentions.members.first() || message.member;
    const coins = getCoinsAmount(guildId, target.id);
    const xpData = loadXP(guildId);
    const userXP = xpData[target.id] ? xpData[target.id].xp : 0;
    const level = getLevel(userXP);
    const discount = Math.floor(coins / 1000) * 2;
    const cfg = loadConfig(guildId);
    const tiendaId = cfg.channels && cfg.channels.tiendaDescuentos;

    const embed = new EmbedBuilder()
      .setTitle(`🪙 DS6 Coins — ${target.user.username}`)
      .setThumbnail(target.user.displayAvatarURL({ forceStatic: false }))
      .addFields(
        { name: '🪙 Saldo actual', value: `**${coins.toLocaleString()} DS6 Coins**`, inline: true },
        { name: '🏅 Nivel', value: `**${level}**`, inline: true },
        { name: '💰 Descuento disponible', value: `**$${discount} USD**`, inline: true },
        { name: '🛍️ ¿Cómo usar tus coins?', value: tiendaId ? `Visita <#${tiendaId}> para ver cómo canjear\nUsa \`!canjear N\` para obtener descuento` : 'Usa `!canjear N` para obtener descuento\n1,000 coins = $2 USD de descuento', inline: false },
      )
      .setColor(0xF1C40F)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • Gana coins chateando y con !daily' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !daily
  // ══════════════════════════════════════════════════════
  if (command === 'daily') {
    const lang = getUserLang(message.member);
    const userId = message.author.id;
    const dailyData = loadDaily(guildId);
    const now = Date.now();
    const lastDaily = dailyData[userId] || 0;
    const cooldown = 24 * 60 * 60 * 1000;

    if (now - lastDaily < cooldown) {
      const remaining = cooldown - (now - lastDaily);
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      const msgs = {
        es: `⏳ Ya reclamaste tu recompensa diaria. Vuelve en **${hrs}h ${mins}m**.`,
        en: `⏳ You already claimed your daily reward. Come back in **${hrs}h ${mins}m**.`,
        pt: `⏳ Você já resgatou sua recompensa diária. Volte em **${hrs}h ${mins}m}**.`
      };
      return message.reply(msgs[lang] || msgs['es']);
    }

    const xpData = loadXP(guildId);
    const level = xpData[userId] ? getLevel(xpData[userId].xp) : 1;
    const coinsReward = 50 + (level * 10);
    const xpReward = 10 + level;

    dailyData[userId] = now;
    saveDaily(guildId, dailyData);
    addCoinsAmount(guildId, userId, coinsReward);
    if (message.member) await addXP(message.member, xpReward);

    const msgs = {
      es: `🎁 **¡Recompensa diaria reclamada!**\n\n🪙 **+${coinsReward} DS6 Coins**\n⭐ **+${xpReward} XP**\n\n💡 Vuelve mañana para más recompensas. ¡Cada día que reclames aumenta tu nivel!`,
      en: `🎁 **Daily reward claimed!**\n\n🪙 **+${coinsReward} DS6 Coins**\n⭐ **+${xpReward} XP**\n\n💡 Come back tomorrow for more rewards!`,
      pt: `🎁 **Recompensa diária resgatada!**\n\n🪙 **+${coinsReward} DS6 Coins**\n⭐ **+${xpReward} XP**\n\n💡 Volte amanhã para mais recompensas!`
    };
    const embed = new EmbedBuilder()
      .setTitle('🎁 Recompensa Diaria')
      .setDescription(msgs[lang] || msgs['es'])
      .setColor(0x00E676)
      .setFooter({ text: 'DS6 Bot v3.0' });
    return message.channel.send({ embeds: [embed] });
  }


  // ══════════════════════════════════════════════════════
  //  COMANDO: !canjear
  // ══════════════════════════════════════════════════════
  if (command === 'canjear' || command === 'redeem') {
    const userId = message.author.id;
    const coins = getCoinsAmount(guildId, userId);
    const cfg = loadConfig(guildId);
    const tiendaId = cfg.channels && cfg.channels.tiendaDescuentos;

    if (args.length === 0) {
      const maxDescuento = Math.floor(coins / 1000) * 2;
      const embed = new EmbedBuilder()
        .setTitle('🛍️ Canjear DS6 Coins')
        .setDescription(
          `**Tu saldo:** ${coins.toLocaleString()} DS6 Coins\n` +
          `**Descuento disponible:** $${maxDescuento} USD\n\n` +
          `**¿Cómo canjear?**\nEscribe \`!canjear N\` donde N es el número de bloques de 1,000 coins.\n\n` +
          `**Ejemplo:**\n• \`!canjear 1\` → Canjea 1,000 coins = **$2 USD de descuento**\n• \`!canjear 5\` → Canjea 5,000 coins = **$10 USD de descuento**\n\n` +
          (tiendaId ? `📖 Ver más información en <#${tiendaId}>` : '')
        )
        .setColor(0xF1C40F)
        .setFooter({ text: 'DS6 Bot v3.0' });
      return message.channel.send({ embeds: [embed] });
    }

    const blocks = parseInt(args[0]);
    if (isNaN(blocks) || blocks <= 0)
      return message.reply('❌ Uso: `!canjear N` donde N es el número de bloques de 1,000 coins. Ejemplo: `!canjear 1`');

    const cost = blocks * 1000;
    const discount = blocks * 2;

    if (coins < cost)
      return message.reply(`❌ No tienes suficientes coins. Necesitas **${cost.toLocaleString()} coins** pero tienes **${coins.toLocaleString()}**.`);

    spendCoinsAmount(guildId, userId, cost);

    // Notificar al Staff
    const soporteId = cfg.channels && cfg.channels.soporte;
    if (soporteId) {
      const staffCh = message.guild.channels.cache.get(soporteId);
      if (staffCh) {
        const staffEmbed = new EmbedBuilder()
          .setTitle('🛍️ Nuevo Canje de DS6 Coins')
          .setDescription(
            `**Usuario:** <@${userId}> (${message.author.username})\n` +
            `**Coins canjeados:** ${cost.toLocaleString()}\n` +
            `**Descuento:** $${discount} USD\n\n` +
            `El usuario ha solicitado un descuento de **$${discount} USD**.`
          )
          .setColor(0x9B59B6)
          .setTimestamp();
        await staffCh.send({ embeds: [staffEmbed] }).catch(() => {});
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ ¡Canje exitoso!')
      .setDescription(
        `Has canjeado **${cost.toLocaleString()} DS6 Coins** por un descuento de **$${discount} USD**.\n\n` +
        `📩 El Staff ha sido notificado y te contactará para aplicar el descuento en tu compra.\n\n` +
        `💰 **Saldo restante:** ${(coins - cost).toLocaleString()} DS6 Coins\n\n` +
        (tiendaId ? `📖 Más información en <#${tiendaId}>` : '')
      )
      .setColor(0x00E676)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • Descuento válido por 30 días' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !invitaciones
  // ══════════════════════════════════════════════════════
  if (command === 'invitaciones' || command === 'invites') {
    const invData = loadInvites(guildId);

    if (args[0] && args[0].toLowerCase() === 'top') {
      const sorted = Object.entries(invData.invites).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
      if (sorted.length === 0) return message.reply('📊 Aún no hay invitaciones registradas en este servidor.');
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      let desc = 'Los miembros con más invitaciones tienen **más probabilidad de ganar** en los sorteos.\n\n';
      for (let i = 0; i < sorted.length; i++) {
        const [uid, data] = sorted[i];
        const total = 1 + data.count;
        desc += `${medals[i]} **${data.name}** — ${data.count} invitación${data.count !== 1 ? 'es' : ''} | ${total} ticket${total !== 1 ? 's' : ''}\n`;
      }
      const embed = new EmbedBuilder()
        .setTitle('🏆 Ranking de Invitaciones')
        .setDescription(desc)
        .setColor(0xF1C40F)
        .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • Cada invitación = 1 ticket extra en sorteos' });
      return message.channel.send({ embeds: [embed] });
    }

    const uid = message.author.id;
    const userInvData = invData.invites[uid] || { count: 0, members: [] };
    const total = 1 + userInvData.count;
    const recent = (userInvData.members || []).slice(-5).map(m => `• ${m.name}`).join('\n') || 'Ninguno aún';

    const embed = new EmbedBuilder()
      .setTitle(`📨 Invitaciones de ${message.author.username}`)
      .setDescription(
        `Has invitado a **${userInvData.count} miembro(s)** al servidor.\n\n` +
        `🎟️ **Tickets en sorteos:** ${total} (1 base + ${userInvData.count} por invitaciones)\n` +
        `📈 **Más invitaciones = más probabilidad de ganar**\n\n` +
        `**Últimos invitados:**\n${recent}\n\n` +
        `💡 Invita amigos con tu link personal de Discord.\nCada miembro que se una usando tu link = **+1 ticket** en el próximo sorteo.`
      )
      .setColor(0xF1C40F)
      .setFooter({ text: 'DS6 Bot v3.0' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !verificar
  // ══════════════════════════════════════════════════════
  if (command === 'verificar') {
    const lang = getUserLang(message.member);
    const imvuUser = args[0];
    if (!imvuUser) return message.reply('❌ Uso: `!verificar TuUsuarioIMVU`');

    try {
      await message.channel.sendTyping();
      const subscriptions = getAllSubscriptions();
      const userLower = imvuUser.replace('@', '').toLowerCase();
      const userSubs = subscriptions.filter(s => {
        if (!s || typeof s !== 'object') return false;
        return [(s.owner || ''), (s.activatedBy || ''), (s.contractorUsername || ''), (s.username || '')].some(v => v.toLowerCase() === userLower);
      });

      if (userSubs.length === 0) {
        const embed = new EmbedBuilder()
          .setTitle('❌ No encontrado')
          .setDescription(`El usuario **@${imvuUser}** no tiene una suscripción activa en DS6Music.\n\n¿Quieres contratar el bot? → [ds6music.com/suscripcion](https://ds6music.com/suscripcion)`)
          .setColor(0xFF0000);
        return message.channel.send({ embeds: [embed] });
      }

      const planPriority = { ultimate: 5, supreme: 4, esmeralda: 3, '9month': 3, diamond: 2, diamante: 2, '3month': 2, '1month': 1, platino: 1, platinum: 1 };
      let highestPlan = 'platino', highestPriority = 0;
      for (const sub of userSubs) {
        const planRaw = (sub.plan || sub.planId || sub.type || '1month').toLowerCase();
        const priority = planPriority[planRaw] || 1;
        if (priority > highestPriority) { highestPriority = priority; highestPlan = planRaw; }
      }

      const planNames = { '1month': 'Platino', platino: 'Platino', platinum: 'Platino', '3month': 'Diamante', diamond: 'Diamante', diamante: 'Diamante', '9month': 'Esmeralda', esmeralda: 'Esmeralda', supreme: 'Supreme', ultimate: 'Supreme' };
      const planEmojis = { Platino: '🥈', Diamante: '💎', Esmeralda: '💚', Supreme: '👑' };
      const planDisplay = planNames[highestPlan] || 'Platino';
      const planEmoji = planEmojis[planDisplay] || '🥈';

      const cfg = loadConfig(guildId);
      const guild = message.guild;
      const member = await guild.members.fetch(message.author.id);
      const assignedRoles = [];

      const planRoleMap = { Platino: '🥈 Platino', Diamante: '💎 Diamante', Esmeralda: '💚 Esmeralda', Supreme: '👑 Supreme' };
      const rolesToAssign = ['🛍️ Cliente', '💎 VIP'];
      if (planRoleMap[planDisplay]) rolesToAssign.push(planRoleMap[planDisplay]);

      for (const roleName of rolesToAssign) {
        const roleId = cfg.roles && cfg.roles[roleName];
        const role = roleId ? guild.roles.cache.get(roleId) : guild.roles.cache.find(r => r.name === roleName);
        if (role && !member.roles.cache.has(role.id)) {
          await member.roles.add(role).catch(() => {});
          assignedRoles.push(roleName);
        } else if (role) assignedRoles.push(roleName);
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Verificado')
        .setDescription(
          `**@${imvuUser}** ha sido verificado.\n\n` +
          `${planEmoji} **Plan:** ${planDisplay}\n` +
          `🏠 **Salas activas:** ${userSubs.length}\n\n` +
          `**Roles asignados:**\n${assignedRoles.map(r => `• ${r}`).join('\n')}`
        )
        .setColor(0x00E676)
        .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • Verificación automática' });
      return message.channel.send({ embeds: [embed] });
    } catch(e) {
      return message.reply('❌ Error al verificar. Intenta de nuevo o abre un ticket.');
    }
  }


  // ══════════════════════════════════════════════════════
  //  COMANDO: !precio / !planes
  // ══════════════════════════════════════════════════════
  if (command === 'precio' || command === 'planes' || command === 'suscripcion') {
    const embed = new EmbedBuilder()
      .setTitle('🎵 Planes de Suscripción')
      .setDescription('Elige el plan que mejor se adapte a ti:')
      .addFields(
        { name: '🥈 PLATINO — $13 USD', value: '• 1 mes de bot activo 24/7\n• Reproduce cualquier canción con `!play`\n• Listas de reproducción personalizadas\n• Audio de alta calidad', inline: false },
        { name: '💎 DIAMANTE — $33 USD', value: '• Todo lo del plan Platino\n• Comandos exclusivos de sala\n• Historial de reproducción\n• Dedicatorias musicales\n• **Ahorra $6** vs 3 meses Platino', inline: false },
        { name: '💚 ESMERALDA — $90 USD', value: '• Todo lo del plan Diamante\n• **3 salas incluidas**\n• 9 meses continuos\n• Cola de canciones ilimitada\n• **Ahorra $9** vs 9 meses Platino', inline: false },
        { name: '👑 SUPREME — $200 USD', value: '• El plan más completo\n• **5 salas incluidas**\n• Soporte VIP prioritario\n• Acceso anticipado a nuevas funciones', inline: false },
        { name: '🔗 Contratar', value: 'https://ds6music.com/suscripcion', inline: false }
      )
      .setColor(0xF1C40F)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !perfil
  // ══════════════════════════════════════════════════════
  if (command === 'perfil' || command === 'profile') {
    const target = message.mentions.members.first() || message.member;
    const uid = target.id;
    const xpData = loadXP(guildId);
    const userXP = xpData[uid] ? xpData[uid].xp : 0;
    const level = getLevel(userXP);
    const coins = getCoinsAmount(guildId, uid);
    const invData = loadInvites(guildId);
    const invCount = invData.invites[uid] ? invData.invites[uid].count : 0;

    const planRoles = ['👑 Supreme', '💚 Esmeralda', '💎 Diamante', '🥈 Platino'];
    let plan = '🎮 Miembro';
    for (const pr of planRoles) {
      if (target.roles.cache.some(r => r.name === pr)) { plan = pr; break; }
    }

    const embed = new EmbedBuilder()
      .setTitle(`👤 Perfil de ${target.user.username}`)
      .setThumbnail(target.user.displayAvatarURL({ forceStatic: false }))
      .addFields(
        { name: '🏅 Nivel', value: `**${level}**`, inline: true },
        { name: '⭐ XP Total', value: `**${userXP}**`, inline: true },
        { name: '🪙 DS6 Coins', value: `**${coins.toLocaleString()}**`, inline: true },
        { name: '📨 Invitaciones', value: `**${invCount}**`, inline: true },
        { name: '🎟️ Tickets sorteo', value: `**${1 + invCount}**`, inline: true },
        { name: '💎 Plan', value: `**${plan}**`, inline: true },
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com' })
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !ticket
  // ══════════════════════════════════════════════════════
  if (command === 'ticket') {
    const query = args.join(' ');
    if (!query) return message.reply('❌ Uso: `!ticket Tu consulta aquí`\nEjemplo: `!ticket Necesito ayuda con mi suscripción`');

    const cfg = loadConfig(guildId);
    const guild = message.guild;
    const user = message.author;
    const member = message.member;

    // Verificar si el usuario ya tiene un ticket abierto
    const safeName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);
    const existingTicket = guild.channels.cache.find(c =>
      c.type === ChannelType.GuildText && c.name === `ticket-${safeName}`
    );
    if (existingTicket) {
      return message.reply(`❌ Ya tienes un ticket abierto: <#${existingTicket.id}>\nCiérralo antes de abrir uno nuevo.`);
    }

    // Buscar categoría de tickets si existe
    const ticketCatId = cfg.ticketCategoryId || null;
    const ticketCategory = ticketCatId ? guild.channels.cache.get(ticketCatId) : null;

    // Construir permisos del canal privado
    const permOverwrites = [
      // @everyone NO puede ver el canal
      { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      // El usuario que abrió el ticket sí puede verlo
      {
        id: user.id,
        type: 1,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
        ]
      },
      // El bot puede gestionar el canal
      {
        id: client.user.id,
        type: 1,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageMessages,
        ]
      },
    ];

    // Dar acceso a todos los roles con permisos de admin/staff
    const staffRoles = guild.roles.cache.filter(r =>
      r.id !== guild.id && (
        r.permissions.has(PermissionsBitField.Flags.Administrator) ||
        r.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
        r.permissions.has(PermissionsBitField.Flags.KickMembers) ||
        r.permissions.has(PermissionsBitField.Flags.BanMembers) ||
        ['staff', 'moderador', 'mod', 'admin', 'owner', 'dueño', 'helper'].some(n => r.name.toLowerCase().includes(n))
      )
    );
    for (const [, role] of staffRoles) {
      permOverwrites.push({
        id: role.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.AttachFiles,
        ]
      });
    }
    // También dar acceso al rol de staff configurado manualmente si existe
    if (cfg.ticketRoles && cfg.ticketRoles.staff) {
      permOverwrites.push({
        id: cfg.ticketRoles.staff,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ]
      });
    }

    // Crear el canal privado
    let ticketCh;
    try {
      ticketCh = await guild.channels.create({
        name: `ticket-${safeName}`,
        type: ChannelType.GuildText,
        parent: ticketCategory || null,
        topic: `🎫 Ticket de ${user.tag} | Consulta: ${query.slice(0, 100)}`,
        permissionOverwrites: permOverwrites,
      });
    } catch(e) {
      return message.reply(`❌ No se pudo crear el canal de ticket. Asegúrate de que el bot tenga el permiso **Gestionar canales**.\nError: ${e.message}`);
    }

    // Construir el embed del ticket dentro del canal privado
    const ticketNum = Date.now().toString().slice(-6);
    const staffMention = cfg.ticketRoles && cfg.ticketRoles.staff
      ? `<@&${cfg.ticketRoles.staff}>`
      : staffRoles.size > 0 ? (staffRoles.map(r => `<@&${r.id}>`)[0] || '') : '';

    const ticketEmbed = new EmbedBuilder()
      .setTitle(`🎫 Ticket #${ticketNum} — ${guild.name}`)
      .setDescription(
        `Hola <@${user.id}>, tu ticket fue creado correctamente.\n` +
        `El Staff te atenderá en breve. Por favor describe tu consulta con detalle.`
      )
      .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
      .addFields(
        { name: '👤 Usuario', value: `<@${user.id}> (${user.tag})`, inline: true },
        { name: '📅 Fecha', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
        { name: '❓ Consulta', value: query.slice(0, 1024), inline: false },
      )
      .setColor(0x9B59B6)
      .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Ticket #${ticketNum}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Cerrar Ticket').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('claim_ticket').setLabel('✋ Tomar Ticket').setStyle(ButtonStyle.Success),
    );

    const mentionContent = [`<@${user.id}>`, staffMention].filter(Boolean).join(' ');
    await ticketCh.send({ content: mentionContent, embeds: [ticketEmbed], components: [row] });

    // Responder al usuario con link al canal privado
    await message.reply(`✅ Tu ticket **#${ticketNum}** fue creado: <#${ticketCh.id}>\nSolo tú y el Staff pueden verlo. 🔒`);
    await sendLog(guild, `🎫 **Ticket #${ticketNum}** abierto por ${user.tag} → <#${ticketCh.id}> | Consulta: "${query.slice(0, 80)}"`, 0x9B59B6);
    return;
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !cerrar
  // ══════════════════════════════════════════════════════
  if (command === 'cerrar' || command === 'close') {
    if (!message.channel.name.startsWith('ticket-')) {
      return message.reply('❌ Este comando solo funciona dentro de un ticket.');
    }
    await message.channel.send('🔒 **Ticket cerrado.** El canal se eliminará en 5 segundos.');
    setTimeout(() => message.channel.delete().catch(() => {}), 5000);
    await sendLog(message.guild, `🔒 **Ticket cerrado** por ${message.author.tag}: #${message.channel.name}`, 0xFF4500);
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !kick
  // ══════════════════════════════════════════════════════
  if (command === 'kick') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos para usar este comando.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Uso: `!kick @usuario [razón]`');
    if (!target.kickable) return message.reply('❌ No puedo expulsar a este usuario (rol superior o no kickeable).');
    const reason = args.slice(1).join(' ') || 'Sin razón especificada';
    try {
      await target.send(`👢 Has sido expulsado de **${message.guild.name}**.\n**Razón:** ${reason}`).catch(() => {});
      await target.kick(reason);
      const embed = new EmbedBuilder()
        .setTitle('👢 Usuario Expulsado')
        .addFields(
          { name: 'Usuario', value: `${target.user.tag}`, inline: true },
          { name: 'Moderador', value: `${message.author.tag}`, inline: true },
          { name: 'Razón', value: reason, inline: false }
        ).setColor(0xFF6600).setTimestamp();
      await message.channel.send({ embeds: [embed] });
      await sendLog(message.guild, `👢 **Kick** | ${target.user.tag} expulsado por ${message.author.tag} | Razón: ${reason}`, 0xFF6600);
    } catch(e) { message.reply('❌ Error al expulsar: ' + e.message); }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !ban
  // ══════════════════════════════════════════════════════
  if (command === 'ban') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos para usar este comando.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Uso: `!ban @usuario [razón]`');
    if (!target.bannable) return message.reply('❌ No puedo banear a este usuario.');
    const reason = args.slice(1).join(' ') || 'Sin razón especificada';
    try {
      await target.send(`🔨 Has sido baneado de **${message.guild.name}**.\n**Razón:** ${reason}`).catch(() => {});
      await target.ban({ reason, deleteMessageSeconds: 86400 });
      const embed = new EmbedBuilder()
        .setTitle('🔨 Usuario Baneado')
        .addFields(
          { name: 'Usuario', value: `${target.user.tag}`, inline: true },
          { name: 'Moderador', value: `${message.author.tag}`, inline: true },
          { name: 'Razón', value: reason, inline: false }
        ).setColor(0xFF0000).setTimestamp();
      await message.channel.send({ embeds: [embed] });
      await sendLog(message.guild, `🔨 **Ban** | ${target.user.tag} baneado por ${message.author.tag} | Razón: ${reason}`, 0xFF0000);
    } catch(e) { message.reply('❌ Error al banear: ' + e.message); }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !unban
  // ══════════════════════════════════════════════════════
  if (command === 'unban') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    const userId = args[0];
    if (!userId) return message.reply('❌ Uso: `!unban [ID del usuario]`');
    try {
      await message.guild.members.unban(userId);
      await message.reply(`✅ Usuario **${userId}** desbaneado correctamente.`);
      await sendLog(message.guild, `✅ **Unban** | ID ${userId} desbaneado por ${message.author.tag}`, 0x00FF00);
    } catch(e) { message.reply('❌ No se pudo desbanear. Verifica el ID.'); }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !silenciar / !mute
  // ══════════════════════════════════════════════════════
  if (command === 'silenciar' || command === 'mute' || command === 'timeout') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Uso: `!silenciar @usuario [duración] [razón]`\nEjemplo: `!silenciar @Juan 10m Spam`');
    const durStr = args[1] || '10m';
    const durMs = parseDuration(durStr) || 600000;
    const reason = args.slice(2).join(' ') || 'Sin razón especificada';
    try {
      await target.timeout(durMs, reason);
      const embed = new EmbedBuilder()
        .setTitle('🔇 Usuario Silenciado')
        .addFields(
          { name: 'Usuario', value: `${target.user.tag}`, inline: true },
          { name: 'Duración', value: formatDuration(durMs), inline: true },
          { name: 'Moderador', value: `${message.author.tag}`, inline: true },
          { name: 'Razón', value: reason, inline: false }
        ).setColor(0xFFA500).setTimestamp();
      await message.channel.send({ embeds: [embed] });
      await target.send(`🔇 Has sido silenciado en **${message.guild.name}** por **${formatDuration(durMs)}**.\n**Razón:** ${reason}`).catch(() => {});
      await sendLog(message.guild, `🔇 **Silenciar** | ${target.user.tag} por ${formatDuration(durMs)} | Mod: ${message.author.tag} | Razón: ${reason}`, 0xFFA500);
    } catch(e) { message.reply('❌ Error: ' + e.message); }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !desilenciar / !unmute
  // ══════════════════════════════════════════════════════
  if (command === 'desilenciar' || command === 'unmute' || command === 'untimeout') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Uso: `!desilenciar @usuario`');
    try {
      await target.timeout(null);
      await message.reply(`✅ **${target.user.username}** ha sido desilenciado.`);
      await sendLog(message.guild, `✅ **Desilenciar** | ${target.user.tag} desilenciado por ${message.author.tag}`, 0x00FF00);
    } catch(e) { message.reply('❌ Error: ' + e.message); }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !warn
  // ══════════════════════════════════════════════════════
  if (command === 'warn') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Uso: `!warn @usuario [razón]`');
    const reason = args.slice(1).join(' ') || 'Sin razón especificada';
    const warns = loadWarns(guildId);
    if (!warns[target.id]) warns[target.id] = [];
    warns[target.id].push({ reason, mod: message.author.tag, date: new Date().toISOString() });
    saveWarns(guildId, warns);
    const total = warns[target.id].length;
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Advertencia Registrada')
      .addFields(
        { name: 'Usuario', value: `${target.user.tag}`, inline: true },
        { name: 'Advertencias', value: `**${total}**`, inline: true },
        { name: 'Moderador', value: `${message.author.tag}`, inline: true },
        { name: 'Razón', value: reason, inline: false }
      ).setColor(0xFFFF00).setTimestamp();
    await message.channel.send({ embeds: [embed] });
    await target.send(`⚠️ Has recibido una advertencia en **${message.guild.name}**.\n**Razón:** ${reason}\n**Total de advertencias:** ${total}`).catch(() => {});
    await sendLog(message.guild, `⚠️ **Warn** | ${target.user.tag} | Advertencia #${total} | Mod: ${message.author.tag} | Razón: ${reason}`, 0xFFFF00);
    // Auto-acción por múltiples warns
    if (total >= 5) {
      await target.ban({ reason: `5 advertencias acumuladas` }).catch(() => {});
      await message.channel.send(`🔨 **${target.user.username}** fue baneado automáticamente por acumular 5 advertencias.`);
    } else if (total >= 3) {
      await target.timeout(3600000, '3 advertencias acumuladas').catch(() => {});
      await message.channel.send(`🔇 **${target.user.username}** fue silenciado 1 hora por acumular 3 advertencias.`);
    }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !warnings
  // ══════════════════════════════════════════════════════
  if (command === 'warnings' || command === 'warns') {
    const target = message.mentions.members.first() || message.member;
    const warns = loadWarns(guildId);
    const userWarns = warns[target.id] || [];
    if (userWarns.length === 0) return message.reply(`✅ **${target.user.username}** no tiene advertencias.`);
    const list = userWarns.map((w, i) => `**${i+1}.** ${w.reason} — *${w.mod}* (${new Date(w.date).toLocaleDateString()})`).join('\n');
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ Advertencias de ${target.user.username}`)
      .setDescription(list)
      .addFields({ name: 'Total', value: `**${userWarns.length}** advertencia(s)`, inline: true })
      .setColor(0xFFFF00).setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !clearwarns
  // ══════════════════════════════════════════════════════
  if (command === 'clearwarns' || command === 'borrarwarns') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Uso: `!clearwarns @usuario`');
    const warns = loadWarns(guildId);
    warns[target.id] = [];
    saveWarns(guildId, warns);
    await message.reply(`✅ Advertencias de **${target.user.username}** eliminadas.`);
    await sendLog(message.guild, `🗑️ **ClearWarns** | Advertencias de ${target.user.tag} eliminadas por ${message.author.tag}`, 0x00FF00);
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !clear / !purge
  // ══════════════════════════════════════════════════════
  if (command === 'clear' || command === 'purge' || command === 'limpiar') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    const rawAmount = parseInt(args[0]);
    const amount = Math.min(Math.max(1, isNaN(rawAmount) ? 10 : rawAmount), 100);
    try {
      // Eliminar el mensaje del comando primero, luego borrar los mensajes del canal
      await message.delete().catch(() => {});
      // Obtener mensajes recientes y filtrar los que tienen más de 14 días (Discord no permite borrarlos)
      const messages = await message.channel.messages.fetch({ limit: amount });
      const deletable = messages.filter(m => (Date.now() - m.createdTimestamp) < 1209600000);
      if (deletable.size === 0) {
        const warn = await message.channel.send('❌ No hay mensajes recientes para eliminar (máximo 14 días).');
        setTimeout(() => warn.delete().catch(() => {}), 4000);
        return;
      }
      const deleted = await message.channel.bulkDelete(deletable, true);
      const msg = await message.channel.send(`🗑️ **${deleted.size}** mensaje(s) eliminados.`);
      setTimeout(() => msg.delete().catch(() => {}), 4000);
      await sendLog(message.guild, `🗑️ **Clear** | ${deleted.size} mensajes eliminados en <#${message.channel.id}> por ${message.author.tag}`, 0xFF6600);
    } catch(e) { message.reply('❌ Error: ' + e.message); }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !slowmode
  // ══════════════════════════════════════════════════════
  if (command === 'slowmode') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    const seconds = parseInt(args[0]);
    if (isNaN(seconds) || seconds < 0 || seconds > 21600) return message.reply('❌ Uso: `!slowmode [0-21600]` (segundos). 0 para desactivar.');
    try {
      await message.channel.setRateLimitPerUser(seconds);
      if (seconds === 0) await message.reply('✅ Slowmode desactivado en este canal.');
      else await message.reply(`⏱️ Slowmode configurado a **${seconds}s** en este canal.`);
    } catch(e) { message.reply('❌ Error: ' + e.message); }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !lock / !unlock
  // ══════════════════════════════════════════════════════
  if (command === 'lock') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    try {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
      await message.reply('🔒 **Canal bloqueado.** Solo el Staff puede escribir.');
      await sendLog(message.guild, `🔒 **Lock** | <#${message.channel.id}> bloqueado por ${message.author.tag}`, 0xFF0000);
    } catch(e) { message.reply('❌ Error: ' + e.message); }
    return;
  }

  if (command === 'unlock') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    try {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
      await message.reply('🔓 **Canal desbloqueado.** Todos pueden escribir.');
      await sendLog(message.guild, `🔓 **Unlock** | <#${message.channel.id}> desbloqueado por ${message.author.tag}`, 0x00FF00);
    } catch(e) { message.reply('❌ Error: ' + e.message); }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  MOD: !privado — Hacer un canal privado solo para admins/staff
  // ══════════════════════════════════════════════════════
  if (command === 'privado' || command === 'private' || command === 'staffonly') {
    if (!isBotOwner(message.author) && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels))
      return message.reply('❌ Solo los administradores pueden cambiar la privacidad de canales.');

    const targetCh = message.mentions.channels.first() || message.channel;
    const sub = args[0] ? args[0].toLowerCase() : 'on';
    // Si el primer arg es un canal mencionado, el sub es el segundo arg
    const subCmd = message.mentions.channels.first() ? (args[1] ? args[1].toLowerCase() : 'on') : sub;

    try {
      if (subCmd === 'off' || subCmd === 'publico' || subCmd === 'public') {
        // Restaurar acceso público
        await targetCh.permissionOverwrites.edit(message.guild.roles.everyone, {
          ViewChannel: null,
          SendMessages: null,
        });
        await message.reply(`🔓 <#${targetCh.id}> ahora es **público** — todos los miembros pueden verlo.`);
        await sendLog(message.guild, `🔓 **Canal público** | <#${targetCh.id}> restaurado por ${message.author.tag}`, 0x00FF00);
      } else {
        // Hacer privado: ocultar a @everyone, permitir a admins y staff
        // 1. Ocultar a @everyone
        await targetCh.permissionOverwrites.edit(message.guild.roles.everyone, {
          ViewChannel: false,
          SendMessages: false,
        });
        // 2. Dar acceso a roles con permisos de administrador
        const adminRoles = message.guild.roles.cache.filter(r =>
          r.permissions.has(PermissionsBitField.Flags.Administrator) ||
          r.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
          r.permissions.has(PermissionsBitField.Flags.ManageChannels)
        );
        for (const [, role] of adminRoles) {
          await targetCh.permissionOverwrites.edit(role, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          }).catch(() => {});
        }
        // 3. Dar acceso al bot mismo
        await targetCh.permissionOverwrites.edit(message.guild.members.me, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => {});

        const rolesLista = adminRoles.map(r => `<@&${r.id}>`).join(' ') || 'Administradores';
        const embed = new EmbedBuilder()
          .setTitle(`🔒 Canal Privado — Solo Staff`)
          .setDescription(`Este canal es **privado** y solo visible para el staff del servidor.\n\nLos miembros normales no pueden ver ni acceder a este canal.`)
          .addFields(
            { name: '👥 Roles con acceso', value: rolesLista, inline: false },
            { name: '💡 Tip', value: 'Usa `!privado #canal off` para hacerlo público de nuevo.', inline: false },
          )
          .setColor(0xFF0000)
          .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Configurado por ${message.author.username}` })
          .setTimestamp();
        await targetCh.send({ embeds: [embed] }).catch(() => {});
        await message.reply(`🔒 <#${targetCh.id}> ahora es **privado** — solo el staff puede verlo.`);
        await sendLog(message.guild, `🔒 **Canal privado** | <#${targetCh.id}> configurado como privado por ${message.author.tag}`, 0xFF0000);
      }
    } catch(e) {
      return message.reply(`❌ No se pudo cambiar la privacidad del canal. Asegúrate de que el bot tenga el permiso **Gestionar canales**.\nError: ${e.message}`);
    }
    return;
  }

  // ══════════════════════════════════════════════════════
  //  INFO: !userinfo
  // ══════════════════════════════════════════════════════
  if (command === 'userinfo' || command === 'whois') {
    const target = message.mentions.members.first() || message.member;
    const warns = loadWarns(guildId);
    const userWarns = (warns[target.id] || []).length;
    const roles = target.roles.cache.filter(r => r.id !== message.guild.id).map(r => `<@&${r.id}>`).join(' ') || 'Ninguno';
    const embed = new EmbedBuilder()
      .setTitle(`👤 Info de ${target.user.username}`)
      .setThumbnail(target.user.displayAvatarURL({ forceStatic: false }))
      .addFields(
        { name: '🏠 Apodo', value: target.nickname || target.user.username, inline: true },
        { name: '🔖 ID', value: target.id, inline: true },
        { name: '📅 En el servidor desde', value: `<t:${Math.floor(target.joinedTimestamp/1000)}:R>`, inline: true },
        { name: '🎂 Cuenta creada', value: `<t:${Math.floor(target.user.createdTimestamp/1000)}:R>`, inline: true },
        { name: '⚠️ Advertencias', value: `**${userWarns}**`, inline: true },
        { name: '🤖 Bot', value: target.user.bot ? 'Sí' : 'No', inline: true },
        { name: `🏷️ Roles (${target.roles.cache.size - 1})`, value: roles.length > 1024 ? roles.slice(0, 1020) + '...' : roles, inline: false },
      ).setColor(0x5865F2).setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  INFO: !serverinfo
  // ══════════════════════════════════════════════════════
  if (command === 'serverinfo' || command === 'server') {
    const guild = message.guild;
    await guild.members.fetch();
    const bots = guild.members.cache.filter(m => m.user.bot).size;
    const humans = guild.members.cache.filter(m => !m.user.bot).size;
    const online = guild.members.cache.filter(m => !m.user.bot && m.presence && m.presence.status !== 'offline').size;
    const embed = new EmbedBuilder()
      .setTitle(`🏗️ ${guild.name}`)
      .setThumbnail(guild.iconURL({ dynamic: false }))
      .addFields(
        { name: '🔖 ID', value: guild.id, inline: true },
        { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: '📅 Creado', value: `<t:${Math.floor(guild.createdTimestamp/1000)}:R>`, inline: true },
        { name: '👥 Miembros', value: `**${humans}** humanos | **${bots}** bots`, inline: true },
        { name: '🟢 En línea', value: `**${online}**`, inline: true },
        { name: '💬 Canales', value: `**${guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size}** texto | **${guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size}** voz`, inline: true },
        { name: '🏷️ Roles', value: `**${guild.roles.cache.size}**`, inline: true },
        { name: '😀 Emojis', value: `**${guild.emojis.cache.size}**`, inline: true },
        { name: '📶 Nivel de verificación', value: `**${guild.verificationLevel}**`, inline: true },
      ).setColor(0x5865F2).setTimestamp();
    if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  INFO: !avatar
  // ══════════════════════════════════════════════════════
  if (command === 'avatar' || command === 'pfp') {
    const target = message.mentions.users.first() || message.author;
    const embed = new EmbedBuilder()
      .setTitle(`🖼️ Avatar de ${target.username}`)
      .setImage(target.displayAvatarURL({ size: 512, forceStatic: false }))
      .setColor(0x5865F2);
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  DIVERSIÓN: !8ball
  // ══════════════════════════════════════════════════════
  if (command === '8ball') {
    const question = args.join(' ');
    if (!question) return message.reply('❌ Uso: `!8ball [tu pregunta]`');
    const answers = [
      '✅ Sí, definitivamente.', '✅ Por supuesto.', '✅ Sin duda alguna.', '✅ Sí.', '✅ Muy probable.',
      '🟡 Es posible.', '🟡 No estoy seguro/a.', '🟡 Pregunta de nuevo más tarde.', '🟡 No puedo predecirlo ahora.',
      '❌ No.', '❌ Definitivamente no.', '❌ Mis fuentes dicen que no.', '❌ No lo creo.', '❌ Muy poco probable.'
    ];
    const answer = answers[Math.floor(Math.random() * answers.length)];
    const embed = new EmbedBuilder()
      .setTitle('🎱 Bola Mágica 8')
      .addFields(
        { name: '❓ Pregunta', value: question, inline: false },
        { name: '🔮 Respuesta', value: `**${answer}**`, inline: false }
      ).setColor(0x9B59B6);
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  DIVERSIÓN: !dado / !moneda / !chiste
  // ══════════════════════════════════════════════════════
  if (command === 'dado' || command === 'dice' || command === 'roll') {
    const sides = parseInt(args[0]) || 6;
    const result = Math.floor(Math.random() * sides) + 1;
    return message.reply(`🎲 Tiraste un dado de **${sides}** caras y obtuviste: **${result}**`);
  }

  if (command === 'moneda' || command === 'coin' || command === 'flip') {
    const result = Math.random() < 0.5 ? '💴 **Cara**' : '💵 **Cruz**';
    return message.reply(`🪙 La moneda cayó en: ${result}`);
  }

  if (command === 'chiste' || command === 'joke') {
    const chistes = [
      '¿Por qué los pájaros vuelan hacia el sur en invierno? \n¡Porque caminando tardarían demasiado! 😂',
      '¿Qué le dijo el 0 al 8? \n¡Bonito cinturón! 😄',
      '¿Por qué el libro de matemáticas estaba triste? \n¡Porque tenía demasiados problemas! 📚',
      '¿Qué hace una abeja en el gimnasio? \n¡Zum-ba! 🐝',
      '¿Cómo se llama el campeón de buceo japonés? \nYamamoto Cochino 😂',
      '¿Qué le dijo el semaforo al carro? \n¡No me mires que me estoy cambiando! 🚦',
      '¿Por qué los esqueletos no pelean entre sí? \n¡Porque no tienen agallas! 💀',
      '¿Qué hace un pez cuando está aburrido? \n¡Nada! 🐟',
    ];
    const chiste = chistes[Math.floor(Math.random() * chistes.length)];
    const embed = new EmbedBuilder()
      .setTitle('😂 Chiste del día')
      .setDescription(chiste)
      .setColor(0xF1C40F);
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  DIVERSIÓN: !abrazo / !beso / !slap
  // ══════════════════════════════════════════════════════
  if (command === 'abrazo' || command === 'hug') {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Uso: `!abrazo @usuario`');
    const msgs = [
      `🤗 **${message.author.username}** le da un abrazo enorme a **${target.username}**!`,
      `🤗 **${message.author.username}** abraza fuerte a **${target.username}**. ¡Qué ternura!`,
      `🤗 ¡**${target.username}** recibe un abrazo de **${message.author.username}**!`,
    ];
    return message.channel.send(msgs[Math.floor(Math.random() * msgs.length)]);
  }

  if (command === 'beso' || command === 'kiss') {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Uso: `!beso @usuario`');
    const msgs = [
      `💋 **${message.author.username}** le da un beso a **${target.username}**! 😍`,
      `💋 ¡**${target.username}** recibe un beso de **${message.author.username}**!`,
    ];
    return message.channel.send(msgs[Math.floor(Math.random() * msgs.length)]);
  }

  if (command === 'slap' || command === 'golpear') {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Uso: `!slap @usuario`');
    const msgs = [
      `👋 **${message.author.username}** le da una bofetada a **${target.username}**! 😂`,
      `👋 ¡**${target.username}** recibe un golpe de **${message.author.username}**! 😂`,
    ];
    return message.channel.send(msgs[Math.floor(Math.random() * msgs.length)]);
  }

  // ══════════════════════════════════════════════════════
  //  ETIQUETAS: !tag
  // ══════════════════════════════════════════════════════
  if (command === 'tag' || command === 'etiqueta') {
    const tags = loadTags(guildId);
    const sub = args[0] ? args[0].toLowerCase() : null;

    if (!sub) return message.reply('❌ Uso: `!tag [nombre]` | `!tag add [nombre] [texto]` | `!tag del [nombre]` | `!tag list`');

    if (sub === 'add' || sub === 'crear' || sub === 'set') {
      if (!isStaff(message.member)) return message.reply('❌ Solo el Staff puede crear etiquetas.');
      const name = args[1] ? args[1].toLowerCase() : null;
      const content = args.slice(2).join(' ');
      if (!name || !content) return message.reply('❌ Uso: `!tag add [nombre] [contenido]`');
      tags[name] = { content, author: message.author.tag, date: new Date().toISOString() };
      saveTags(guildId, tags);
      return message.reply(`✅ Etiqueta **${name}** creada correctamente.`);
    }

    if (sub === 'del' || sub === 'delete' || sub === 'eliminar') {
      if (!isStaff(message.member)) return message.reply('❌ Solo el Staff puede eliminar etiquetas.');
      const name = args[1] ? args[1].toLowerCase() : null;
      if (!name || !tags[name]) return message.reply(`❌ Etiqueta **${name}** no encontrada.`);
      delete tags[name];
      saveTags(guildId, tags);
      return message.reply(`✅ Etiqueta **${name}** eliminada.`);
    }

    if (sub === 'list' || sub === 'lista') {
      const list = Object.keys(tags);
      if (list.length === 0) return message.reply('🏷️ No hay etiquetas creadas en este servidor. Usa `!tag add [nombre] [texto]` para crear una.');
      const embed = new EmbedBuilder()
        .setTitle('🏷️ Etiquetas del servidor')
        .setDescription(list.map(t => `\`!tag ${t}\``).join('  '))
        .setColor(0x5865F2)
        .setFooter({ text: `${list.length} etiqueta(s) disponibles` });
      return message.channel.send({ embeds: [embed] });
    }

    // Ver etiqueta
    const tagName = sub;
    if (!tags[tagName]) return message.reply(`❌ Etiqueta **${tagName}** no encontrada. Usa \`!tag list\` para ver las disponibles.`);
    return message.channel.send(tags[tagName].content);
  }

  // ══════════════════════════════════════════════════════
  //  CONFIG: !bienvenida
  // ══════════════════════════════════════════════════════
  if (command === 'bienvenida' || command === 'welcome') {
    if (!isBotOwner(message.author) && !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && !isStaff(message.member))
      return message.reply('❌ Solo los administradores pueden configurar la bienvenida.');

    const welcomeCfg = loadWelcome(guildId);
    const sub = args[0] ? args[0].toLowerCase() : 'ver';

    if (sub === 'ver' || sub === 'info') {
      const embed = new EmbedBuilder()
        .setTitle('🎉 Configuración de Bienvenida')
        .addFields(
          { name: '✅ Activada', value: welcomeCfg.enabled ? 'Sí' : 'No', inline: true },
          { name: '💬 Canal', value: welcomeCfg.channel ? `<#${welcomeCfg.channel}>` : 'Auto-detectado', inline: true },
          { name: '📨 DM activado', value: welcomeCfg.dmEnabled !== false ? 'Sí' : 'No', inline: true },
          { name: '📝 Mensaje', value: `\`${welcomeCfg.message || 'Por defecto'}\``, inline: false },
          { name: '📝 Mensaje DM', value: `\`${welcomeCfg.dmMessage || 'Por defecto'}\``, inline: false },
        ).setColor(0x00E676)
        .setFooter({ text: 'Variables: {user} {username} {server} {count}' });
      return message.channel.send({ embeds: [embed] });
    }

    if (sub === 'on' || sub === 'activar') {
      welcomeCfg.enabled = true; saveWelcome(guildId, welcomeCfg);
      return message.reply('✅ Bienvenida activada.');
    }
    if (sub === 'off' || sub === 'desactivar') {
      welcomeCfg.enabled = false; saveWelcome(guildId, welcomeCfg);
      return message.reply('✅ Bienvenida desactivada.');
    }
    if (sub === 'canal' || sub === 'channel') {
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply('❌ Uso: `!bienvenida canal #canal`');
      welcomeCfg.channel = ch.id; saveWelcome(guildId, welcomeCfg);
      return message.reply(`✅ Canal de bienvenida configurado a <#${ch.id}>.`);
    }
    if (sub === 'mensaje' || sub === 'message' || sub === 'msg') {
      const newMsg = args.slice(1).join(' ');
      if (!newMsg) return message.reply('❌ Uso: `!bienvenida mensaje [texto]`\nVariables: `{user}` `{username}` `{server}` `{count}`');
      welcomeCfg.message = newMsg; saveWelcome(guildId, welcomeCfg);
      return message.reply(`✅ Mensaje de bienvenida actualizado:\n> ${newMsg}`);
    }
    if (sub === 'dm') {
      const sub2 = args[1] ? args[1].toLowerCase() : '';
      if (sub2 === 'off') { welcomeCfg.dmEnabled = false; saveWelcome(guildId, welcomeCfg); return message.reply('✅ DM de bienvenida desactivado.'); }
      if (sub2 === 'on')  { welcomeCfg.dmEnabled = true;  saveWelcome(guildId, welcomeCfg); return message.reply('✅ DM de bienvenida activado.'); }
      const newDmMsg = args.slice(1).join(' ');
      if (!newDmMsg) return message.reply('❌ Uso: `!bienvenida dm [texto]` o `!bienvenida dm on/off`');
      welcomeCfg.dmMessage = newDmMsg; saveWelcome(guildId, welcomeCfg);
      return message.reply(`✅ Mensaje DM de bienvenida actualizado.`);
    }
    if (sub === 'color') {
      const hex = args[1] ? parseInt(args[1].replace('#',''), 16) : null;
      if (!hex || isNaN(hex)) return message.reply('❌ Uso: `!bienvenida color #FF0000`');
      welcomeCfg.color = hex; saveWelcome(guildId, welcomeCfg);
      return message.reply(`✅ Color de bienvenida actualizado.`);
    }
    if (sub === 'titulo' || sub === 'title') {
      const newTitle = args.slice(1).join(' ');
      if (!newTitle) return message.reply('❌ Uso: `!bienvenida titulo [texto]`');
      welcomeCfg.title = newTitle; saveWelcome(guildId, welcomeCfg);
      return message.reply(`✅ Título de bienvenida actualizado.`);
    }
    if (sub === 'banner') {
      const url = args[1];
      if (!url) return message.reply('❌ Uso: `!bienvenida banner [URL de imagen]`');
      welcomeCfg.banner = url; saveWelcome(guildId, welcomeCfg);
      return message.reply(`✅ Banner de bienvenida configurado.`);
    }
    if (sub === 'reset') {
      saveWelcome(guildId, { enabled: true, channel: null, message: null, dmEnabled: true, dmMessage: null, color: 0xF1C40F, thumbnail: true });
      return message.reply('✅ Configuración de bienvenida reiniciada a valores por defecto.');
    }

    return message.reply('❌ Subcomandos: `ver`, `on`, `off`, `canal #canal`, `mensaje [texto]`, `dm [texto/on/off]`, `color #hex`, `titulo [texto]`, `banner [url]`, `reset`');
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !editar — Personalización de mensajes del servidor
  // ══════════════════════════════════════════════════════
  if (command === 'editar' || command === 'edit' || command === 'personalizar') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && !isStaff(message.member))
      return message.reply('❌ Solo los administradores pueden personalizar los mensajes del servidor.');

    const cfg = loadConfig(guildId);
    if (!cfg.mensajes) cfg.mensajes = {};

    const sub = args[0] ? args[0].toLowerCase() : null;
    // Preservar saltos de línea y espacios: leer directamente de message.content
    // Formato: !editar [sub] [texto con saltos de línea]
    const rawContent = message.content.trim();
    const prefixAndCmd = rawContent.match(/^!(?:editar|edit|personalizar)\s*/i)?.[0] || '';
    const afterCmd = rawContent.slice(prefixAndCmd.length);
    const subMatch = afterCmd.match(/^(\S+)\s*/i);
    const subStr = subMatch ? subMatch[0] : '';
    const texto = sub ? afterCmd.slice(subStr.length) : '';

    const TIPOS_VALIDOS = {
      bienvenida: { emoji: '🎉', desc: 'Mensaje de bienvenida en canal', vars: '{user} {username} {server} {count} {fecha}', default: '¡Bienvenido/a {user} a **{server}**! 🎉 Eres el miembro #**{count}**.' },
      despedida:  { emoji: '👋', desc: 'Mensaje cuando alguien sale del servidor', vars: '{username} {server} {count} {fecha}', default: '**{username}** ha abandonado **{server}**. Ahora somos **{count}** miembros.' },
      reglas:     { emoji: '📜', desc: 'Reglas del servidor (se envía al canal de reglas)', vars: '{server} {fecha}', default: '**Reglas de {server}**\n\n1. Respeta a todos los miembros.\n2. No spam ni flood.\n3. Sigue las normas de Discord.\n4. Diviértete y sé positivo.' },
      anuncio:    { emoji: '📢', desc: 'Plantilla de anuncios (se usa con !anunciar)', vars: '{server} {fecha} {autor}', default: '📢 **Anuncio de {server}**\n\n{texto}' },
      dm:         { emoji: '📨', desc: 'Mensaje de DM al entrar al servidor', vars: '{username} {server} {fecha}', default: '¡Hola **{username}**! 👋 Bienvenido/a a **{server}**. Usa `!ayuda` para ver los comandos.' },
      nivel:      { emoji: '⬆️', desc: 'Mensaje de subida de nivel', vars: '{user} {username} {nivel} {server}', default: '🎉 <@{userId}> ha alcanzado el **Nivel {nivel}** en **{server}**! 🚀' },
    };

    // !editar ver [tipo] — ver todos o uno específico
    if (!sub || sub === 'ver' || sub === 'info' || sub === 'lista') {
      const tipo = texto ? texto.toLowerCase() : null;
      if (tipo && TIPOS_VALIDOS[tipo]) {
        const t = TIPOS_VALIDOS[tipo];
        const actual = cfg.mensajes[tipo] || t.default;
        const embed = new EmbedBuilder()
          .setTitle(`${t.emoji} Mensaje de ${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`)
          .addFields(
            { name: '📝 Mensaje actual', value: `\`\`\`${actual.substring(0, 900)}\`\`\``, inline: false },
            { name: '🔧 Variables disponibles', value: `\`${t.vars}\``, inline: false },
            { name: '📋 Descripción', value: t.desc, inline: false },
            { name: '🔄 Por defecto', value: `\`\`\`${t.default.substring(0, 500)}\`\`\``, inline: false },
          )
          .setColor(0x5865F2)
          .setFooter({ text: `DS6 Bot v3.0 • Usa !editar ${tipo} [texto] para cambiar` });
        return message.channel.send({ embeds: [embed] });
      }
      // Mostrar todos
      const embed = new EmbedBuilder()
        .setTitle(`✏️ Mensajes personalizables — ${message.guild.name}`)
        .setDescription('Usa `!editar [tipo] [texto]` para personalizar cada mensaje.\nUsa `!editar ver [tipo]` para ver el mensaje actual de un tipo específico.')
        .addFields(
          ...Object.entries(TIPOS_VALIDOS).map(([k, v]) => ({
            name: `${v.emoji} ${k.charAt(0).toUpperCase() + k.slice(1)}`,
            value: `${v.desc}\n**Actual:** \`${(cfg.mensajes[k] || '(por defecto)').substring(0, 60)}...\`\n**Vars:** \`${v.vars}\``,
            inline: false
          }))
        )
        .setColor(0x5865F2)
        .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • !editar reset [tipo] para restaurar' })
        .setTimestamp();
      return message.channel.send({ embeds: [embed] });
    }

    // !editar reset [tipo] — restaurar al valor por defecto
    if (sub === 'reset' || sub === 'restaurar' || sub === 'default') {
      const tipo = texto ? texto.toLowerCase() : null;
      if (!tipo || !TIPOS_VALIDOS[tipo])
        return message.reply(`❌ Especifica qué tipo restaurar: \`!editar reset [tipo]\`\nTipos: \`${Object.keys(TIPOS_VALIDOS).join('\` \`')}\``);
      delete cfg.mensajes[tipo];
      saveConfig(guildId, cfg);
      return message.reply(`✅ Mensaje de **${tipo}** restaurado al valor por defecto.`);
    }

    // !editar [tipo] [texto] — guardar mensaje personalizado
    if (!TIPOS_VALIDOS[sub])
      return message.reply(`❌ Tipo no válido. Tipos disponibles: \`${Object.keys(TIPOS_VALIDOS).join('\` \`')}\`\n\nUso: \`!editar [tipo] [texto]\`\nEjemplo: \`!editar bienvenida ¡Hola {user}! Bienvenido a {server} 🎉\``);

    if (!texto)
      return message.reply(`❌ Debes escribir el texto del mensaje.\n\nUso: \`!editar ${sub} [texto]\`\nVariables: \`${TIPOS_VALIDOS[sub].vars}\``);

    cfg.mensajes[sub] = texto;
    saveConfig(guildId, cfg);

    // Preview del mensaje con variables reemplazadas
    const preview = texto
      .replace(/{user}/g, `<@${message.author.id}>`)
      .replace(/{username}/g, message.author.username)
      .replace(/{server}/g, message.guild.name)
      .replace(/{count}/g, message.guild.memberCount)
      .replace(/{fecha}/g, new Date().toLocaleDateString('es-ES'))
      .replace(/{autor}/g, message.author.username)
      .replace(/{nivel}/g, '5')
      .replace(/{userId}/g, message.author.id);

    const embed = new EmbedBuilder()
      .setTitle(`✅ Mensaje de ${sub} actualizado`)
      .addFields(
        { name: '📝 Guardado', value: `\`\`\`${texto.substring(0, 900)}\`\`\``, inline: false },
        { name: '👁️ Vista previa (con tus datos)', value: preview.substring(0, 1000), inline: false },
      )
      .setColor(0x00E676)
      .setFooter({ text: `DS6 Bot v3.0 • Usa !editar ver ${sub} para ver más detalles` });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !link — Generar link permanente del servidor
  // ══════════════════════════════════════════════════════
  if (command === 'link' || command === 'invite' || command === 'enlace') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && !isStaff(message.member))
      return message.reply('❌ Solo los administradores pueden generar el link del servidor.');

    try {
      // Buscar canal de texto adecuado para crear el invite
      const cfg = loadConfig(guildId);
      const targetChId = cfg.channels?.general || cfg.channels?.chatES || cfg.channels?.bienvenidos;
      const targetCh = targetChId
        ? message.guild.channels.cache.get(targetChId)
        : message.guild.channels.cache.find(c => c.type === 0 && c.permissionsFor(message.guild.members.me).has('CreateInstantInvite'));

      if (!targetCh)
        return message.reply('❌ No se encontró un canal de texto para generar el link. Asegúrate de que el bot tenga permisos.');

      // Crear invite permanente (maxAge: 0 = nunca expira, maxUses: 0 = usos ilimitados)
      const invite = await targetCh.createInvite({
        maxAge: 0,
        maxUses: 0,
        unique: false,
        reason: `Link permanente generado por ${message.author.tag}`
      });

      const embed = new EmbedBuilder()
        .setTitle(`🔗 Link permanente de ${message.guild.name}`)
        .setDescription(`**https://discord.gg/${invite.code}**\n\n✅ Este link **nunca expira** y tiene **usos ilimitados**.\nCompartelo con quien quieras para que se unan al servidor.`)
        .addFields(
          { name: '📌 Canal', value: `<#${targetCh.id}>`, inline: true },
          { name: '⏳ Expira', value: 'Nunca', inline: true },
          { name: '👥 Usos máximos', value: 'Ilimitados', inline: true },
        )
        .setThumbnail(message.guild.iconURL({ dynamic: true }) || null)
        .setColor(0x5865F2)
        .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Generado por ${message.author.username}` })
        .setTimestamp();
      return message.channel.send({ embeds: [embed] });
    } catch(e) {
      return message.reply(`❌ No se pudo generar el link. Asegúrate de que el bot tenga el permiso **Crear invitaciones** en el servidor.\nError: ${e.message}`);
    }
  }

  // ══════════════════════════════════════════════════════
  //  CONFIG: !autoroles
  // ══════════════════════════════════════════════════════
  if (command === 'autoroles' || command === 'autorole') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles) && !isStaff(message.member))
      return message.reply('❌ Solo los administradores pueden configurar auto-roles.');
    const arCfg = loadAutoRoles(guildId);
    const sub = args[0] ? args[0].toLowerCase() : 'ver';
    if (sub === 'ver' || sub === 'list') {
      if (arCfg.roles.length === 0) return message.reply('🏷️ No hay auto-roles configurados.\n\nUsa `!autoroles add NombreDelRol` para crear y agregar un rol automáticamente.');
      const list = arCfg.roles.map(id => `<@&${id}>`).join(' ');
      return message.reply(`🏷️ **Auto-roles actuales:** ${list}\n\nEstos roles se asignan automáticamente cuando alguien entra al servidor.`);
    }
    if (sub === 'add' || sub === 'agregar') {
      // Primero intentar con mención de rol
      let role = message.mentions.roles.first();
      // Si no hay mención, buscar por nombre o crear el rol
      if (!role) {
        const roleName = args.slice(1).join(' ').trim();
        if (!roleName) return message.reply('❌ Uso: `!autoroles add NombreDelRol`\nEjemplo: `!autoroles add Miembro`');
        // Buscar rol existente por nombre (insensible a mayúsculas)
        role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (!role) {
          // Crear el rol si no existe
          try {
            role = await message.guild.roles.create({
              name: roleName,
              colors: { primaryColor: 0x5865F2 },
              reason: `Auto-rol creado por ${message.author.tag} con !autoroles add`
            });
            await message.reply(`✨ Rol **${role.name}** creado automáticamente y agregado a los auto-roles.`);
          } catch(e) {
            return message.reply(`❌ No pude crear el rol. Asegúrate de que el bot tiene permiso de **Gestionar Roles**.\nError: ${e.message}`);
          }
        }
      }
      if (arCfg.roles.includes(role.id)) return message.reply(`❌ El rol **${role.name}** ya está en la lista de auto-roles.`);
      arCfg.roles.push(role.id);
      saveAutoRoles(guildId, arCfg);
      return message.reply(`✅ Rol **${role.name}** agregado a los auto-roles. Los nuevos miembros recibirán este rol automáticamente.`);
    }
    if (sub === 'del' || sub === 'remove' || sub === 'quitar') {
      let role = message.mentions.roles.first();
      if (!role) {
        const roleName = args.slice(1).join(' ').trim();
        if (!roleName) return message.reply('❌ Uso: `!autoroles del NombreDelRol`');
        role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (!role) return message.reply(`❌ No encontré un rol con ese nombre.`);
      }
      arCfg.roles = arCfg.roles.filter(id => id !== role.id);
      saveAutoRoles(guildId, arCfg);
      return message.reply(`✅ Rol **${role.name}** eliminado de los auto-roles.`);
    }
    if (sub === 'clear' || sub === 'limpiar') {
      arCfg.roles = []; saveAutoRoles(guildId, arCfg);
      return message.reply('✅ Todos los auto-roles han sido eliminados.');
    }
    if (sub === 'color' || sub === 'colour') {
      const roleName = args[1] ? args.slice(1, -1).join(' ').trim() : null;
      const colorInput = args[args.length - 1];
      if (!roleName || !colorInput) return message.reply('❌ Uso: `!autoroles color NombreDelRol #HEX`\nEjemplo: `!autoroles color Coco #FF0000`\n\nColores rápidos: `rojo` `azul` `verde` `amarillo` `morado` `naranja` `rosa` `blanco` `negro` `cyan`');
      const colorMap = { rojo: '#FF0000', azul: '#0099FF', verde: '#00FF00', amarillo: '#FFFF00', morado: '#9B59B6', naranja: '#FF6600', rosa: '#FF69B4', blanco: '#FFFFFF', negro: '#000000', cyan: '#00FFFF', gris: '#808080', dorado: '#FFD700', plateado: '#C0C0C0' };
      const hexColor = colorMap[colorInput.toLowerCase()] || colorInput;
      if (!/^#[0-9A-Fa-f]{6}$/.test(hexColor)) return message.reply('❌ Color inválido. Usa un código HEX como `#FF0000` o un nombre: `rojo`, `azul`, `verde`, `amarillo`, `morado`, `naranja`, `rosa`, `blanco`, `negro`, `cyan`, `dorado`');
      const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
      if (!role) return message.reply(`❌ No encontré el rol **${roleName}**. Usa \`!autoroles ver\` para ver los roles configurados.`);
      try {
        await role.setColors({ primaryColor: hexColor });
        return message.reply(`✅ Color del rol **${role.name}** cambiado a **${hexColor}**.`);
      } catch(e) {
        return message.reply(`❌ No pude cambiar el color. Asegúrate de que el bot tiene permiso de **Gestionar Roles** y que el rol esté por debajo del bot.`);
      }
    }
    return message.reply('🏷️ **Uso de !autoroles:**\n`!autoroles ver` — Ver auto-roles actuales\n`!autoroles add NombreDelRol` — Agregar (crea el rol si no existe)\n`!autoroles del NombreDelRol` — Eliminar de la lista\n`!autoroles color NombreDelRol #HEX` — Cambiar color del rol\n`!autoroles clear` — Eliminar todos');
  }

  // ══════════════════════════════════════════════════════
  //  CONFIG: !antispam
  // ══════════════════════════════════════════════════════
  if (command === 'antispam') {
    if (!isBotOwner(message.author) && !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
      return message.reply('❌ Solo los administradores pueden configurar el anti-spam.');
    const cfg = loadConfig(guildId);
    if (!cfg.antispam) cfg.antispam = { enabled: false, limit: 5, window: 5, muteDuration: '5m' };
    const sub = args[0] ? args[0].toLowerCase() : 'ver';

    if (sub === 'ver' || sub === 'info') {
      const embed = new EmbedBuilder()
        .setTitle('🛡️ Configuración Anti-Spam')
        .addFields(
          { name: '✅ Activado', value: cfg.antispam.enabled ? 'Sí' : 'No', inline: true },
          { name: '📊 Límite', value: `${cfg.antispam.limit} mensajes`, inline: true },
          { name: '⏱️ Ventana', value: `${cfg.antispam.window} segundos`, inline: true },
          { name: '🔇 Duración mute', value: cfg.antispam.muteDuration, inline: true },
        ).setColor(0xFF6600);
      return message.channel.send({ embeds: [embed] });
    }
    if (sub === 'on') { cfg.antispam.enabled = true; saveConfig(guildId, cfg); return message.reply('✅ Anti-spam activado.'); }
    if (sub === 'off') { cfg.antispam.enabled = false; saveConfig(guildId, cfg); return message.reply('✅ Anti-spam desactivado.'); }
    if (sub === 'limite' || sub === 'limit') {
      const n = parseInt(args[1]);
      if (!n || n < 2) return message.reply('❌ Uso: `!antispam limite [número]` (mínimo 2)');
      cfg.antispam.limit = n; saveConfig(guildId, cfg);
      return message.reply(`✅ Límite de spam: **${n} mensajes**.`);
    }
    if (sub === 'ventana' || sub === 'window') {
      const n = parseInt(args[1]);
      if (!n || n < 1) return message.reply('❌ Uso: `!antispam ventana [segundos]`');
      cfg.antispam.window = n; saveConfig(guildId, cfg);
      return message.reply(`✅ Ventana de tiempo: **${n} segundos**.`);
    }
    if (sub === 'mute' || sub === 'silencio') {
      const dur = args[1];
      if (!dur || !parseDuration(dur)) return message.reply('❌ Uso: `!antispam mute [duración]` (ej: 5m, 1h, 1d)');
      cfg.antispam.muteDuration = dur; saveConfig(guildId, cfg);
      return message.reply(`✅ Duración de silencio por spam: **${dur}**.`);
    }
    return message.reply('❌ Subcomandos: `ver`, `on`, `off`, `limite [N]`, `ventana [seg]`, `mute [dur]`');
  }

  // ══════════════════════════════════════════════════════
  //  CONFIG: !config (panel principal)
  // ══════════════════════════════════════════════════════
  if (command === 'config' || command === 'configuracion') {
    if (!isBotOwner(message.author) && !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
      return message.reply('❌ Solo los administradores pueden ver la configuración.');

    const cfg = loadConfig(guildId);
    const welcomeCfg = loadWelcome(guildId);
    const arCfg = loadAutoRoles(guildId);
    const tags = loadTags(guildId);

    const embed = new EmbedBuilder()
      .setTitle(`⚙️ Panel de Configuración — ${message.guild.name}`)
      .setDescription('Usa los comandos de abajo para personalizar el bot en tu servidor.')
      .addFields(
        { name: '🎉 Bienvenida', value:
          `Estado: **${welcomeCfg.enabled ? '✅ Activa' : '❌ Inactiva'}**\n` +
          `Canal: ${welcomeCfg.channel ? `<#${welcomeCfg.channel}>` : 'Auto'}\n` +
          `DM: **${welcomeCfg.dmEnabled !== false ? 'Sí' : 'No'}**\n` +
          `→ \`!bienvenida\` para editar`, inline: true },
        { name: '🏷️ Auto-roles', value:
          `Roles: **${arCfg.roles.length}** configurados\n` +
          arCfg.roles.slice(0,3).map(id => `<@&${id}>`).join(' ') + (arCfg.roles.length > 3 ? '...' : '') + '\n' +
          `→ \`!autoroles\` para editar`, inline: true },
        { name: '🛡️ Anti-spam', value:
          `Estado: **${cfg.antispam && cfg.antispam.enabled ? '✅ Activo' : '❌ Inactivo'}**\n` +
          `Límite: **${cfg.antispam ? cfg.antispam.limit : 5}** msg / **${cfg.antispam ? cfg.antispam.window : 5}**s\n` +
          `Mute: **${cfg.antispam ? cfg.antispam.muteDuration : '5m'}**\n` +
          `→ \`!antispam\` para editar`, inline: true },
        { name: '💬 Canales configurados', value:
          Object.entries(cfg.channels || {}).slice(0,6).map(([k,v]) => `**${k}**: <#${v}>`).join('\n') || 'Ninguno\nUsa `!setup` para detectar', inline: true },
        { name: '🏷️ Etiquetas', value: `**${Object.keys(tags).length}** etiquetas\n→ \`!tag list\` para ver`, inline: true },
        { name: '🎉 Sorteo', value: `Meta: **${cfg.sorteoMeta || 150}** miembros\nActivo: **${cfg.sorteoActive ? 'Sí' : 'No'}**`, inline: true },
      )
      .setColor(0x5865F2)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • Usa !ayuda para ver todos los comandos' })
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !addcoins (solo Owner/Admin)
  // ══════════════════════════════════════════════════════
  if (command === 'addcoins') {
    if (!isBotOwner(message.author) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
    const target = message.mentions.members.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount)) return message.reply('❌ Uso: `!addcoins @usuario cantidad`');
    addCoinsAmount(guildId, target.id, amount);
    return message.reply(`✅ Se añadieron **${amount.toLocaleString()} DS6 Coins** a ${target.user.username}.`);
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !addxp (solo Owner/Admin)
  // ══════════════════════════════════════════════════════
  if (command === 'addxp') {
    if (!isBotOwner(message.author) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
    const target = message.mentions.members.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount)) return message.reply('❌ Uso: `!addxp @usuario cantidad`');
    const xpData = loadXP(guildId);
    if (!xpData[target.id]) xpData[target.id] = { xp: 0, level: 1 };
    xpData[target.id].xp += amount;
    xpData[target.id].level = getLevel(xpData[target.id].xp);
    saveXP(guildId, xpData);
    return message.reply(`✅ Se añadieron **${amount} XP** a ${target.user.username}.`);
  }

  // ══════════════════════════════════════════════════════
  //  SISTEMA DE IDIOMAS: !idioma
  // ══════════════════════════════════════════════════════
  if (command === 'idioma' || command === 'language' || command === 'lang') {
    const sub = args[0] ? args[0].toLowerCase() : null;
    const langFile = path.join(guildDir(guildId), 'user_langs.json');
    const userLangs = loadJSON(langFile, {});
    if (!sub) {
      const current = userLangs[message.author.id] || 'es';
      const names = { es: '🇪🇸 Español', en: '🇺🇸 English', pt: '🇧🇷 Português' };
      return message.reply('🌐 Tu idioma actual es: **' + (names[current] || names['es']) + '**\n\nCambia con: `!idioma es` / `!idioma en` / `!idioma pt`');
    }
    const validLangs = { es: '🇪🇸 Español', en: '🇺🇸 English', pt: '🇧🇷 Português' };
    if (!validLangs[sub]) return message.reply('❌ Idiomas disponibles: `!idioma es` | `!idioma en` | `!idioma pt`');
    userLangs[message.author.id] = sub;
    saveJSON(langFile, userLangs);
    const confirmMsgs = {
      es: '✅ Idioma cambiado a **🇪🇸 Español**.',
      en: '✅ Language changed to **🇺🇸 English**.',
      pt: '✅ Idioma alterado para **🇧🇷 Português**.'
    };
    return message.reply(confirmMsgs[sub]);
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !comandos (menú completo)
  // ══════════════════════════════════════════════════════
  if (command === 'comandos' || command === 'commands' || command === 'menu') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Comandos de DS6 Bot v3.0')
      .setDescription('Todos los comandos disponibles. Prefijo: `!`')
      .addFields(
        { name: '🎮 Diversión', value: '`!8ball` `!dado` `!moneda` `!chiste`\n`!abrazo` `!beso` `!slap` `!meme`\n`!rps` `!trivia` `!verdadoreto`\n`!bailar` `!llorar` `!comer` `!dormir`', inline: true },
        { name: '💰 Economía', value: '`!coins` `!daily` `!trabajo`\n`!transferir` `!robar` `!topcoins`\n`!invitaciones` `!canjear`', inline: true },
        { name: '📊 Perfil', value: '`!nivel` `!top` `!perfil`\n`!userinfo` `!avatar`\n`!serverinfo` `!botinfo`\n`!ping`', inline: true },
        { name: '🛡️ Moderación (Staff)', value: '`!kick` `!ban` `!unban`\n`!silenciar` `!desilenciar`\n`!warn` `!warnings` `!clearwarns`\n`!clear` `!lock` `!unlock`\n`!slowmode` `!nick` `!banlist`\n`!privado`', inline: true },
        { name: '⚙️ Config (Admin)', value: '`!setup` `!config` `!bienvenida`\n`!autoroles` `!antispam`\n`!setcanal` `!setrol` `!sorteo`\n`!idioma` `!tag`\n`!editar` `!link`', inline: true },
        { name: '🎫 Tickets & Más', value: '`!ticket [consulta]`\n`!cerrar` (en canal ticket)\n`!poll` `!calc` `!recordatorio`\n`!traducir` `!reglas` `!precio`', inline: true },
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • !ayuda para más detalles' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cmd_diversion').setLabel('🎮 Diversión').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cmd_economia').setLabel('💰 Economía').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cmd_mod').setLabel('🛡️ Moderación').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cmd_config').setLabel('⚙️ Config').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cmd_util').setLabel('🔧 Utilidades').setStyle(ButtonStyle.Primary),
    );
    return message.channel.send({ embeds: [embed], components: [row] });
  }

  // ══════════════════════════════════════════════════════
  //  DIVERSIÓN: !rps
  // ══════════════════════════════════════════════════════
  if (command === 'rps' || command === 'ppt') {
    const choices = ['🪨 Piedra', '📄 Papel', '✂️ Tijera'];
    const choiceMap = { 'piedra': 0, 'rock': 0, 'papel': 1, 'paper': 1, 'tijera': 2, 'scissors': 2, 'tijeras': 2 };
    const userChoice = args[0] ? args[0].toLowerCase() : null;
    if (!userChoice || choiceMap[userChoice] === undefined)
      return message.reply('❌ Uso: `!rps piedra/papel/tijera`');
    const userIdx = choiceMap[userChoice];
    const botIdx = Math.floor(Math.random() * 3);
    const results = [[0, -1, 1], [1, 0, -1], [-1, 1, 0]];
    const result = results[userIdx][botIdx];
    let outcome;
    if (result === 0) outcome = '🤝 **¡Empate!**';
    else if (result === 1) { outcome = '🎉 **¡Ganaste!** +10 DS6 Coins'; addCoinsAmount(guildId, message.author.id, 10); }
    else outcome = '😢 **¡Perdiste!** Mejor suerte la próxima vez.';
    const embed = new EmbedBuilder().setTitle('🎮 Piedra, Papel o Tijera')
      .addFields(
        { name: '👤 Tu elección', value: choices[userIdx], inline: true },
        { name: '🤖 Bot eligió', value: choices[botIdx], inline: true },
        { name: '🏆 Resultado', value: outcome, inline: false }
      ).setColor(result === 1 ? 0x00E676 : result === -1 ? 0xFF4500 : 0xFFD700);
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  DIVERSIÓN: !meme
  // ══════════════════════════════════════════════════════
  if (command === 'meme') {
    const memes = [
      'Cuando el bot funciona a la primera... nadie lo cree. 😂',
      'Yo: "Voy a dormir temprano" — Yo a las 3am escribiendo en Discord 😴',
      'Cuando alguien dice "solo un mensaje más" — 2 horas después... 👀',
      'El anti-spam cuando alguien escribe rápido: 🚫 SILENCIADO',
      'Yo con mis DS6 Coins: 💰 Soy rico... en el servidor.',
      'Cuando subes al nivel 50: 👑 ¡Leyenda del servidor!',
      'Cuando alguien invita a 10 amigos: 🎉 ¡Sorteo activado!',
      'Staff: "No hagas spam" — El chat 5 segundos después: 💬💬💬💬💬',
    ];
    return message.channel.send('😂 **' + memes[Math.floor(Math.random() * memes.length)] + '**');
  }

  // ══════════════════════════════════════════════════════
  //  DIVERSIÓN: !verdadoreto
  // ══════════════════════════════════════════════════════
  if (command === 'verdadoreto' || command === 'tor') {
    const sub = args[0] ? args[0].toLowerCase() : (Math.random() < 0.5 ? 'verdad' : 'reto');
    const verdades = [
      '¿Cuál es tu mayor miedo?', '¿Alguna vez has mentido en este servidor?',
      '¿Quién es tu persona favorita del servidor?', '¿Cuál es tu mayor secreto que puedas contar?',
      '¿Alguna vez tuviste un crush en alguien del servidor?', '¿Cuál es la cosa más vergonzosa que te ha pasado?',
    ];
    const retos = [
      'Escribe un poema de 4 líneas sobre el servidor.',
      'Menciona a 3 personas y di algo bonito de cada una.',
      'Cambia tu apodo a algo gracioso por 1 hora.',
      'Envía un meme en el chat.',
      'Escribe un mensaje completamente en mayúsculas por 5 minutos.',
      'Haz una pregunta filosófica al chat.',
    ];
    const isTruth = sub === 'verdad' || sub === 'truth' || sub === 'v';
    const list = isTruth ? verdades : retos;
    const item = list[Math.floor(Math.random() * list.length)];
    const target = message.mentions.users.first();
    const targetText = target ? `<@${target.id}>` : `<@${message.author.id}>`;
    const embed = new EmbedBuilder()
      .setTitle(isTruth ? '💬 ¡VERDAD!' : '🎯 ¡RETO!')
      .setDescription(`${targetText}\n\n**${item}**`)
      .setColor(isTruth ? 0x3498DB : 0xE74C3C)
      .setFooter({ text: '!verdadoreto verdad | !verdadoreto reto' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  DIVERSIÓN: !trivia
  // ══════════════════════════════════════════════════════
  if (command === 'trivia') {
    const preguntas = [
      { q: '¿Cuántos planetas tiene el sistema solar?', a: '8', opts: ['7', '8', '9', '10'] },
      { q: '¿Cuál es el país más grande del mundo?', a: 'Rusia', opts: ['China', 'Rusia', 'Canadá', 'Brasil'] },
      { q: '¿En qué año llegó el hombre a la Luna?', a: '1969', opts: ['1965', '1969', '1972', '1975'] },
      { q: '¿Cuál es el océano más grande?', a: 'Pacífico', opts: ['Atlántico', 'Índico', 'Pacífico', 'Ártico'] },
      { q: '¿Cuántos lados tiene un hexágono?', a: '6', opts: ['5', '6', '7', '8'] },
      { q: '¿Cuál es el animal más rápido del mundo?', a: 'Guepardo', opts: ['León', 'Guepardo', 'Halcón', 'Caballo'] },
    ];
    const p = preguntas[Math.floor(Math.random() * preguntas.length)];
    const shuffled = [...p.opts].sort(() => Math.random() - 0.5);
    const letters = ['🅰️', '🅱️', '🇨', '🇩'];
    let desc = `**${p.q}**\n\n`;
    shuffled.forEach((opt, i) => { desc += `${letters[i]} ${opt}\n`; });
    desc += `\n⏱️ Responde con la letra en los próximos **15 segundos**!`;
    const embed = new EmbedBuilder().setTitle('🧠 ¡Trivia!').setDescription(desc).setColor(0x9B59B6).setFooter({ text: 'Responde con A, B, C o D' });
    await message.channel.send({ embeds: [embed] });
    const filter = m => m.author.id === message.author.id && ['a', 'b', 'c', 'd'].includes(m.content.toLowerCase());
    try {
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
      const idx = ['a', 'b', 'c', 'd'].indexOf(collected.first().content.toLowerCase());
      if (shuffled[idx] === p.a) { addCoinsAmount(guildId, message.author.id, 25); return message.channel.send(`✅ <@${message.author.id}> ¡**Correcto!** La respuesta era **${p.a}**. +25 DS6 Coins 🎉`); }
      else return message.channel.send(`❌ <@${message.author.id}> **Incorrecto.** La respuesta correcta era **${p.a}**.`);
    } catch(e) { return message.channel.send(`⏱️ <@${message.author.id}> ¡Se acabó el tiempo! La respuesta era **${p.a}**.`); }
  }

  // ══════════════════════════════════════════════════════
  //  DIVERSIÓN: acciones sociales extra
  // ══════════════════════════════════════════════════════
  if (command === 'highfive' || command === 'choca') {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Uso: `!highfive @usuario`');
    return message.channel.send(`🙌 **${message.author.username}** choca los cinco con **${target.username}**!`);
  }
  if (command === 'llorar' || command === 'cry') {
    const target = message.mentions.users.first();
    if (target) return message.channel.send(`😭 **${message.author.username}** llora en el hombro de **${target.username}**...`);
    return message.channel.send(`😭 **${message.author.username}** está llorando... ¿Alguien le da un abrazo?`);
  }
  if (command === 'bailar' || command === 'dance') {
    return message.channel.send(`💃🕺🎶 **${message.author.username}** está bailando! 🎵`);
  }
  if (command === 'dormir' || command === 'sleep') {
    return message.channel.send(`😴 **${message.author.username}** se fue a dormir... ¡Buenas noches! 🌙`);
  }
  if (command === 'comer' || command === 'eat') {
    const comidas = ['🍕', '🍔', '🌮', '🍜', '🍣', '🍩', '🍦', '🥗'];
    const comida = comidas[Math.floor(Math.random() * comidas.length)];
    return message.channel.send(`${comida} **${message.author.username}** está comiendo ${comida}. ¡Buen provecho!`);
  }

  // ══════════════════════════════════════════════════════
  //  UTILIDADES: !poll / !encuesta
  // ══════════════════════════════════════════════════════
  if (command === 'poll' || command === 'encuesta' || command === 'votacion') {
    if (!isStaff(message.member) && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Solo el Staff puede crear encuestas.');
    const content = args.join(' ');
    if (!content) return message.reply('❌ Uso: `!poll [pregunta]` o `!poll [pregunta] | opción1 | opción2`');
    const parts = content.split('|').map(p => p.trim());
    const question = parts[0];
    const options = parts.slice(1);
    if (options.length === 0) {
      const embed = new EmbedBuilder().setTitle('📊 Encuesta').setDescription(`**${question}**`).setColor(0x3498DB).setFooter({ text: `Por ${message.author.username}` }).setTimestamp();
      const pollMsg = await message.channel.send({ embeds: [embed] });
      await pollMsg.react('✅'); await pollMsg.react('❌');
      await message.delete().catch(() => {});
    } else if (options.length <= 5) {
      const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
      let desc = `**${question}**\n\n`;
      options.forEach((opt, i) => { desc += `${emojis[i]} ${opt}\n`; });
      const embed = new EmbedBuilder().setTitle('📊 Encuesta').setDescription(desc).setColor(0x3498DB).setFooter({ text: `Por ${message.author.username}` }).setTimestamp();
      const pollMsg = await message.channel.send({ embeds: [embed] });
      for (let i = 0; i < options.length; i++) await pollMsg.react(emojis[i]);
      await message.delete().catch(() => {});
    } else return message.reply('❌ Máximo 5 opciones.');
    return;
  }

  // ══════════════════════════════════════════════════════
  //  UTILIDADES: !calc
  // ══════════════════════════════════════════════════════
  if (command === 'calc' || command === 'calcular' || command === 'math') {
    const expr = args.join(' ').replace(/[^0-9+\-*/.() ]/g, '');
    if (!expr) return message.reply('❌ Uso: `!calc [expresión]` (ej: `!calc 5 * 3 + 2`)');
    try {
      const result = Function('"use strict"; return (' + expr + ')')();
      if (typeof result !== 'number' || !isFinite(result)) throw new Error('inválido');
      const embed = new EmbedBuilder().setTitle('🧮 Calculadora')
        .addFields({ name: '📝 Expresión', value: '`' + expr + '`', inline: true }, { name: '✅ Resultado', value: '**' + result.toLocaleString() + '**', inline: true })
        .setColor(0x00E676);
      return message.channel.send({ embeds: [embed] });
    } catch(e) { return message.reply('❌ Expresión inválida. Usa: `+ - * / ( )`'); }
  }

  // ══════════════════════════════════════════════════════
  //  UTILIDADES: !recordatorio
  // ══════════════════════════════════════════════════════
  if (command === 'recordatorio' || command === 'remind' || command === 'reminder') {
    const durStr = args[0];
    const text = args.slice(1).join(' ');
    if (!durStr || !text) return message.reply('❌ Uso: `!recordatorio [tiempo] [mensaje]` (ej: `!recordatorio 10m Revisar el servidor`)');
    const ms = parseDuration(durStr);
    if (!ms || ms > 86400000 * 7) return message.reply('❌ Tiempo inválido. Usa: `5s`, `10m`, `2h`, `1d` (máximo 7 días)');
    await message.reply(`⏰ ¡Listo! Te recordaré en **${formatDuration(ms)}**: *${text}*`);
    setTimeout(async () => {
      try {
        const embed = new EmbedBuilder().setTitle('⏰ ¡Recordatorio!').setDescription(`<@${message.author.id}>, aquí está tu recordatorio:\n\n**${text}**`).setColor(0xF1C40F).setTimestamp();
        await message.channel.send({ content: `<@${message.author.id}>`, embeds: [embed] });
      } catch(e) {}
    }, ms);
    return;
  }

  // ══════════════════════════════════════════════════════
  //  UTILIDADES: !traducir
  // ══════════════════════════════════════════════════════
  if (command === 'traducir' || command === 'translate' || command === 'tr') {
    // Idiomas soportados con sus códigos
    const IDIOMAS = {
      'es': 'Español', 'en': 'Inglés', 'pt': 'Portugués', 'fr': 'Francés',
      'de': 'Alemán', 'it': 'Italiano', 'ja': 'Japonés', 'ko': 'Coreano',
      'zh': 'Chino', 'ru': 'Ruso', 'ar': 'Árabe', 'hi': 'Hindi',
      'nl': 'Holandés', 'pl': 'Polaco', 'tr': 'Turco', 'sv': 'Sueco',
      'da': 'Danés', 'fi': 'Finlés', 'no': 'Noruego', 'uk': 'Ucraniano',
    };
    const ALIAS = {
      'espanol': 'es', 'español': 'es', 'spanish': 'es',
      'ingles': 'en', 'inglés': 'en', 'english': 'en',
      'portugues': 'pt', 'portugués': 'pt', 'portuguese': 'pt',
      'frances': 'fr', 'francés': 'fr', 'french': 'fr',
      'aleman': 'de', 'alemán': 'de', 'german': 'de',
      'italiano': 'it', 'italian': 'it',
      'japones': 'ja', 'japonés': 'ja', 'japanese': 'ja',
      'coreano': 'ko', 'korean': 'ko',
      'chino': 'zh', 'chinese': 'zh',
      'ruso': 'ru', 'russian': 'ru',
      'arabe': 'ar', 'árabe': 'ar', 'arabic': 'ar',
    };

    // Uso: !traducir [idioma_destino] [texto]
    // Uso: !traducir [idioma_origen] [idioma_destino] [texto]
    // Uso: !traducir (sin args) — muestra ayuda
    if (!args[0]) {
      const embed = new EmbedBuilder()
        .setTitle('🌐 Comando !traducir')
        .setDescription(
          '**Traduce texto a cualquier idioma de forma instantánea.**\n\n' +
          '**Uso básico:**\n' +
          '`!traducir [idioma] [texto]`\n' +
          'Ejemplo: `!traducir en Hola, ¿cómo estás?`\n\n' +
          '**Uso avanzado (especificar origen):**\n' +
          '`!traducir [origen] [destino] [texto]`\n' +
          'Ejemplo: `!traducir es en Hola mundo`\n\n' +
          '**Idiomas disponibles:**\n' +
          Object.entries(IDIOMAS).map(([k, v]) => `\`${k}\` ${v}`).join(' • ')
        )
        .setColor(0x5865F2)
        .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com' });
      return message.channel.send({ embeds: [embed] });
    }

    // Detectar si el primer arg es un idioma válido
    let fromLang = 'auto';
    let toLang = null;
    let textToTranslate = '';

    const arg0 = args[0].toLowerCase();
    const arg1 = args[1] ? args[1].toLowerCase() : null;

    const resolveCode = (s) => ALIAS[s] || (IDIOMAS[s] ? s : null);

    const code0 = resolveCode(arg0);
    const code1 = arg1 ? resolveCode(arg1) : null;

    if (code0 && code1) {
      // !traducir es en texto...
      fromLang = code0;
      toLang = code1;
      textToTranslate = args.slice(2).join(' ');
    } else if (code0) {
      // !traducir en texto...
      toLang = code0;
      textToTranslate = args.slice(1).join(' ');
    } else {
      return message.reply(`❌ Idioma no reconocido: \`${arg0}\`\n\nUsa \`!traducir\` para ver los idiomas disponibles.`);
    }

    if (!textToTranslate.trim())
      return message.reply(`❌ Debes escribir el texto a traducir.\nEjemplo: \`!traducir ${toLang} Hola mundo\``);

    if (textToTranslate.length > 500)
      return message.reply('❌ El texto es demasiado largo. Máximo 500 caracteres.');

    // Mostrar indicador de escritura
    await message.channel.sendTyping().catch(() => {});

    try {
      // Llamar a la API de MyMemory (gratuita, sin clave)
      const langPair = `${fromLang}|${toLang}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${langPair}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!data || data.responseStatus !== 200)
        return message.reply('❌ No se pudo traducir el texto. Intenta de nuevo.');

      const translated = data.responseData.translatedText;
      const detectedFrom = fromLang === 'auto'
        ? (data.responseData.detectedLanguage || 'auto')
        : fromLang;

      const fromName = IDIOMAS[detectedFrom] || detectedFrom.toUpperCase();
      const toName = IDIOMAS[toLang] || toLang.toUpperCase();

      const embed = new EmbedBuilder()
        .setTitle('🌐 Traducción')
        .addFields(
          { name: `📝 Original (${fromName})`, value: `\`\`\`${textToTranslate.substring(0, 900)}\`\`\``, inline: false },
          { name: `✅ Traducción (${toName})`, value: `\`\`\`${translated.substring(0, 900)}\`\`\``, inline: false },
        )
        .setColor(0x5865F2)
        .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Traducido por ${message.author.username}` })
        .setTimestamp();
      return message.channel.send({ embeds: [embed] });
    } catch(e) {
      return message.reply('❌ Error al conectar con el servicio de traducción. Intenta de nuevo en unos segundos.');
    }
  }

  // ══════════════════════════════════════════════════════
  //  UTILIDADES: !ping
  // ══════════════════════════════════════════════════════
  if (command === 'ping' || command === 'latencia') {
    const sent = await message.channel.send('🏓 Calculando...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const apiLatency = Math.round(client.ws.ping);
    await sent.edit({ content: null, embeds: [new EmbedBuilder().setTitle('🏓 Pong!')
      .addFields(
        { name: '⚡ Latencia del bot', value: `**${latency}ms**`, inline: true },
        { name: '💓 API Discord', value: `**${apiLatency}ms**`, inline: true },
        { name: '✅ Estado', value: latency < 200 ? '🟢 Excelente' : latency < 500 ? '🟡 Normal' : '🔴 Lento', inline: true },
      ).setColor(0x00E676)] });
    return;
  }

  // ══════════════════════════════════════════════════════
  //  UTILIDADES: !botinfo / !info
  // ══════════════════════════════════════════════════════
  if (command === 'botinfo' || command === 'about' || command === 'info') {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const embed = new EmbedBuilder()
      .setTitle('🤖 DS6 Bot — Información')
      .setThumbnail(client.user.displayAvatarURL({ forceStatic: false }))
      .addFields(
        { name: '📛 Nombre', value: client.user.tag, inline: true },
        { name: '🆔 ID', value: client.user.id, inline: true },
        { name: '📡 Servidores', value: `**${client.guilds.cache.size}**`, inline: true },
        { name: '👥 Usuarios', value: `**${client.users.cache.size}**`, inline: true },
        { name: '⏱️ Uptime', value: `**${days}d ${hours}h ${mins}m**`, inline: true },
        { name: '🏓 Ping', value: `**${Math.round(client.ws.ping)}ms**`, inline: true },
        { name: '📦 Versión', value: '**v3.0**', inline: true },
        { name: '🔗 Web', value: '[ds6music.com](https://ds6music.com)', inline: true },
        { name: '📋 Prefijo', value: '**!**', inline: true },
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6 Bot v3.0' })
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  UTILIDADES: !reglas
  // ══════════════════════════════════════════════════════
  if (command === 'reglas' || command === 'rules') {
    const cfg = loadConfig(guildId);
    const reglasId = cfg.channels && cfg.channels.reglas;
    if (reglasId) return message.reply(`📋 Las reglas están en <#${reglasId}>. ¡Léelas antes de participar!`);
    const embed = new EmbedBuilder()
      .setTitle(`📋 Reglas de ${message.guild.name}`)
      .setDescription(
        '**1.** Sé respetuoso con todos los miembros.\n' +
        '**2.** No hagas spam ni publiques contenido inapropiado.\n' +
        '**3.** No publiques links sin permiso del Staff.\n' +
        '**4.** Usa los canales para su propósito correspondiente.\n' +
        '**5.** No hagas publicidad sin autorización.\n' +
        '**6.** Sigue las normas de Discord (TOS).\n\n' +
        '*El incumplimiento puede resultar en mute, kick o ban.*'
      ).setColor(0xFF0000).setFooter({ text: 'Configura el canal con !setcanal reglas #canal' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  ECONOMÍA: !trabajo
  // ══════════════════════════════════════════════════════
  if (command === 'trabajo' || command === 'work' || command === 'trabajar') {
    const workFile = path.join(guildDir(guildId), 'work.json');
    const workData = loadJSON(workFile, {});
    const now = Date.now();
    const cooldown = 4 * 60 * 60 * 1000;
    if (workData[message.author.id] && now - workData[message.author.id] < cooldown) {
      const remaining = cooldown - (now - workData[message.author.id]);
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      return message.reply(`⏳ Ya trabajaste. Vuelve en **${hrs}h ${mins}m** para trabajar de nuevo.`);
    }
    const trabajos = [
      { nombre: 'DJ en una fiesta', emoji: '🎧', min: 80, max: 200 },
      { nombre: 'Diseñador gráfico', emoji: '🎨', min: 100, max: 250 },
      { nombre: 'Streamer de IMVU', emoji: '📺', min: 60, max: 180 },
      { nombre: 'Moderador de Discord', emoji: '🛡️', min: 70, max: 160 },
      { nombre: 'Programador de bots', emoji: '💻', min: 150, max: 350 },
      { nombre: 'Cantante', emoji: '🎤', min: 90, max: 220 },
    ];
    const trabajo = trabajos[Math.floor(Math.random() * trabajos.length)];
    const earned = Math.floor(Math.random() * (trabajo.max - trabajo.min + 1)) + trabajo.min;
    addCoinsAmount(guildId, message.author.id, earned);
    workData[message.author.id] = now;
    saveJSON(workFile, workData);
    const embed = new EmbedBuilder()
      .setTitle(`${trabajo.emoji} ¡Trabajaste como ${trabajo.nombre}!`)
      .setDescription(`Has ganado **${earned} DS6 Coins**. Vuelve en **4 horas** para trabajar de nuevo.`)
      .addFields(
        { name: '💰 Ganado', value: `**${earned} DS6 Coins**`, inline: true },
        { name: '💳 Saldo total', value: `**${getCoinsAmount(guildId, message.author.id).toLocaleString()} DS6 Coins**`, inline: true },
      ).setColor(0x00E676).setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  ECONOMÍA: !robar
  // ══════════════════════════════════════════════════════
  if (command === 'robar' || command === 'steal' || command === 'rob') {
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Uso: `!robar @usuario`');
    if (target.id === message.author.id) return message.reply('❌ No puedes robarte a ti mismo.');
    if (target.user.bot) return message.reply('❌ No puedes robarle a un bot.');
    const robFile = path.join(guildDir(guildId), 'rob.json');
    const robData = loadJSON(robFile, {});
    const now = Date.now();
    const cooldown = 2 * 60 * 60 * 1000;
    if (robData[message.author.id] && now - robData[message.author.id] < cooldown) {
      const remaining = cooldown - (now - robData[message.author.id]);
      const hrs = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      return message.reply(`⏳ Estás en período de enfriamiento. Vuelve en **${hrs}h ${mins}m**.`);
    }
    const targetCoins = getCoinsAmount(guildId, target.id);
    if (targetCoins < 100) return message.reply(`❌ **${target.user.username}** no tiene suficientes coins (mínimo 100).`);
    robData[message.author.id] = now;
    saveJSON(robFile, robData);
    const success = Math.random() < 0.45;
    if (success) {
      const stolen = Math.floor(targetCoins * (0.1 + Math.random() * 0.2));
      spendCoinsAmount(guildId, target.id, stolen);
      addCoinsAmount(guildId, message.author.id, stolen);
      return message.channel.send(`🦹 **${message.author.username}** le robó **${stolen} DS6 Coins** a **${target.user.username}**! 😈`);
    } else {
      const fine = Math.floor(50 + Math.random() * 100);
      const myCoins = getCoinsAmount(guildId, message.author.id);
      if (myCoins >= fine) spendCoinsAmount(guildId, message.author.id, fine);
      return message.channel.send(`👮 **${message.author.username}** intentó robar a **${target.user.username}** pero fue atrapado/a y multado/a con **${fine} DS6 Coins**! 😂`);
    }
  }

  // ══════════════════════════════════════════════════════
  //  ECONOMÍA: !transferir
  // ══════════════════════════════════════════════════════
  if (command === 'transferir' || command === 'pagar' || command === 'pay' || command === 'transfer') {
    const target = message.mentions.members.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount) || amount <= 0) return message.reply('❌ Uso: `!transferir @usuario [cantidad]`');
    if (target.id === message.author.id) return message.reply('❌ No puedes transferirte coins a ti mismo.');
    if (target.user.bot) return message.reply('❌ No puedes transferir coins a un bot.');
    const myCoins = getCoinsAmount(guildId, message.author.id);
    if (myCoins < amount) return message.reply(`❌ No tienes suficientes coins. Tienes **${myCoins.toLocaleString()} DS6 Coins**.`);
    spendCoinsAmount(guildId, message.author.id, amount);
    addCoinsAmount(guildId, target.id, amount);
    const embed = new EmbedBuilder().setTitle('💸 Transferencia de DS6 Coins')
      .addFields(
        { name: '📤 De', value: message.author.username, inline: true },
        { name: '📥 Para', value: target.user.username, inline: true },
        { name: '💰 Cantidad', value: `**${amount.toLocaleString()} DS6 Coins**`, inline: true },
        { name: '💳 Tu nuevo saldo', value: `**${(myCoins - amount).toLocaleString()} DS6 Coins**`, inline: true },
      ).setColor(0x00E676).setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  ECONOMÍA: !topcoins
  // ══════════════════════════════════════════════════════
  if (command === 'topcoins' || command === 'richlist' || command === 'ricos') {
    const coinsData = loadCoins(guildId);
    const sorted = Object.entries(coinsData).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (sorted.length === 0) return message.reply('💰 Aún no hay datos de coins en este servidor.');
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    let desc = '';
    for (let i = 0; i < sorted.length; i++) {
      const [uid, coins] = sorted[i];
      const member = message.guild.members.cache.get(uid);
      const name = member ? member.user.username : `Usuario ${uid.slice(-4)}`;
      desc += `${medals[i]} **${name}** — ${coins.toLocaleString()} DS6 Coins\n`;
    }
    const embed = new EmbedBuilder().setTitle(`💰 Top 10 Más Ricos — ${message.guild.name}`).setDescription(desc).setColor(0xF1C40F).setFooter({ text: 'Gana coins con !daily, !trabajo y !trivia' });
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !banlist
  // ══════════════════════════════════════════════════════
  if (command === 'banlist' || command === 'bans') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    try {
      const bans = await message.guild.bans.fetch();
      if (bans.size === 0) return message.reply('✅ No hay usuarios baneados en este servidor.');
      const list = [...bans.values()].slice(0, 20).map((b, i) => `${i+1}. **${b.user.tag}** — ${b.reason || 'Sin razón'}`).join('\n');
      const embed = new EmbedBuilder().setTitle(`🔨 Usuarios Baneados — ${message.guild.name}`).setDescription(list + (bans.size > 20 ? `\n... y ${bans.size - 20} más.` : '')).setColor(0xFF0000).setFooter({ text: `Total: ${bans.size} bans` });
      return message.channel.send({ embeds: [embed] });
    } catch(e) { return message.reply('❌ Error al obtener la lista de bans.'); }
  }

  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !rol
  // ══════════════════════════════════════════════════════
  if (command === 'rol' || command === 'role' || command === 'darro' || command === 'giverole') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos para gestionar roles.');
    const sub = args[0] ? args[0].toLowerCase() : null;
    if (!sub) return message.reply('🏷️ **Uso de !rol:**\n`!rol add @usuario NombreDelRol` — Dar un rol a un miembro\n`!rol del @usuario NombreDelRol` — Quitar un rol a un miembro\n`!rol ver @usuario` — Ver los roles de un miembro');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Debes mencionar a un usuario. Ej: `!rol add @usuario NombreDelRol`');
    if (sub === 'add' || sub === 'agregar' || sub === 'dar') {
      const roleName = args.slice(2).join(' ').trim();
      if (!roleName) return message.reply('❌ Uso: `!rol add @usuario NombreDelRol`\nEjemplo: `!rol add @Juan Miembro`');
      let role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
      if (!role) {
        // Crear el rol si no existe
        try {
          role = await message.guild.roles.create({
            name: roleName,
            colors: { primaryColor: 0x5865F2 },
            reason: `Rol creado por ${message.author.tag} con !rol add`
          });
        } catch(e) {
          return message.reply(`❌ No pude crear el rol **${roleName}**. Verifica que el bot tiene permiso de **Gestionar Roles**.`);
        }
      }
      if (target.roles.cache.has(role.id)) return message.reply(`❌ **${target.user.username}** ya tiene el rol **${role.name}**.`);
      try {
        await target.roles.add(role);
        const embed = new EmbedBuilder()
          .setTitle('🏷️ Rol Asignado')
          .addFields(
            { name: '👤 Usuario', value: `${target.user.username}`, inline: true },
            { name: '🏷️ Rol', value: `**${role.name}**`, inline: true },
            { name: '🛡️ Moderador', value: `${message.author.username}`, inline: true },
          ).setColor(0x00E676).setTimestamp();
        return message.channel.send({ embeds: [embed] });
      } catch(e) {
        return message.reply(`❌ No pude asignar el rol. Asegúrate de que el rol del bot esté por encima de **${role.name}** en la lista de roles.`);
      }
    }
    if (sub === 'del' || sub === 'remove' || sub === 'quitar') {
      const roleName = args.slice(2).join(' ').trim();
      if (!roleName) return message.reply('❌ Uso: `!rol del @usuario NombreDelRol`');
      const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
      if (!role) return message.reply(`❌ No encontré el rol **${roleName}** en este servidor.`);
      if (!target.roles.cache.has(role.id)) return message.reply(`❌ **${target.user.username}** no tiene el rol **${role.name}**.`);
      try {
        await target.roles.remove(role);
        const embed = new EmbedBuilder()
          .setTitle('🗑️ Rol Removido')
          .addFields(
            { name: '👤 Usuario', value: `${target.user.username}`, inline: true },
            { name: '🏷️ Rol', value: `**${role.name}**`, inline: true },
            { name: '🛡️ Moderador', value: `${message.author.username}`, inline: true },
          ).setColor(0xFF6600).setTimestamp();
        return message.channel.send({ embeds: [embed] });
      } catch(e) {
        return message.reply(`❌ No pude quitar el rol. Asegúrate de que el rol del bot esté por encima de **${role.name}** en la lista de roles.`);
      }
    }
    if (sub === 'ver' || sub === 'info' || sub === 'list') {
      const roles = target.roles.cache
        .filter(r => r.id !== message.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => `<@&${r.id}>`)
        .join(' ');
      const embed = new EmbedBuilder()
        .setTitle(`🏷️ Roles de ${target.user.username}`)
        .setDescription(roles || 'Sin roles asignados')
        .setThumbnail(target.user.displayAvatarURL({ forceStatic: false }))
        .setColor(0x5865F2).setTimestamp();
      return message.channel.send({ embeds: [embed] });
    }
    return message.reply('🏷️ **Uso de !rol:**\n`!rol add @usuario NombreDelRol` — Dar un rol\n`!rol del @usuario NombreDelRol` — Quitar un rol\n`!rol ver @usuario` — Ver roles del usuario');
  }
  // ══════════════════════════════════════════════════════
  //  MODERACIÓN: !nick
  // ══════════════════════════════════════════════════════
  if (command === 'nick' || command === 'apodo' || command === 'nickname') {
    if (!isStaff(message.member)) return message.reply('❌ No tienes permisos.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Uso: `!nick @usuario [nuevo apodo]` o `!nick @usuario reset`');
    const newNick = args.slice(1).join(' ');
    try {
      if (!newNick || newNick.toLowerCase() === 'reset') {
        await target.setNickname(null, `Apodo reseteado por ${message.author.tag}`);
        return message.reply(`✅ Apodo de **${target.user.username}** reseteado.`);
      }
      await target.setNickname(newNick, `Apodo cambiado por ${message.author.tag}`);
      return message.reply(`✅ Apodo de **${target.user.username}** cambiado a **${newNick}**.`);
    } catch(e) { return message.reply('❌ No tengo permisos para cambiar ese apodo.'); }
  }

  // ══════════════════════════════════════════════════════
  //  CONFIGURACIÓN: !setcanal
  // ══════════════════════════════════════════════════════
  if (command === 'setcanal' || command === 'setchannel') {
    if (!isBotOwner(message.author) && !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
      return message.reply('❌ Solo los administradores pueden configurar canales.');
    const cfg = loadConfig(guildId);
    const tipo = args[0] ? args[0].toLowerCase() : null;
    const canal = message.mentions.channels.first();
    // Normalizar aliases de tipos
    const aliasMap = {
      'bienvenida': 'bienvenidos', 'welcome': 'bienvenidos', 'bienvenido': 'bienvenidos',
      'log': 'logs', 'staff': 'logs', 'moderacion': 'logs', 'mod': 'logs',
      'ticket': 'soporte', 'tickets': 'soporte', 'support': 'soporte', 'ayuda': 'soporte',
      'sorteo': 'sorteos', 'giveaway': 'sorteos',
      'anuncio': 'anuncios', 'announce': 'anuncios', 'noticias': 'anuncios',
      'top': 'top3', 'salas': 'top3',
      'chat': 'chatES', 'chates': 'chatES', 'chaten': 'chatEN',
      'regla': 'reglas', 'rules': 'reglas', 'normas': 'reglas',
    };
    if (aliasMap[tipo]) tipo = aliasMap[tipo];
    const validTypes = ['bienvenidos', 'logs', 'sorteos', 'soporte', 'anuncios', 'top3', 'general', 'chatES', 'chatEN', 'reglas'];
    if (!tipo || !validTypes.includes(tipo))
      return message.reply(`❌ Uso: \`!setcanal [tipo] #canal\`\nTipos válidos: \`${validTypes.join('`, `')}\``);
    if (!canal) return message.reply('❌ Menciona el canal con #canal');
    if (!cfg.channels) cfg.channels = {};
    cfg.channels[tipo] = canal.id;
    saveConfig(guildId, cfg);

    // Enviar mensaje apropiado al canal configurado según su tipo
    const targetChannel = canal;
    const guildName = message.guild.name;

    if (tipo === 'soporte') {
      await setupTicketMessage(message.guild).catch(e => console.error('[Tickets]', e.message));
      return message.reply(`✅ Canal de **soporte** configurado a <#${canal.id}>. El panel de tickets ha sido enviado.`);
    }

    if (tipo === 'bienvenidos') {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`👋 Canal de Bienvenida — ${guildName}`)
        .setDescription(`Este canal está configurado para recibir a los nuevos miembros del servidor.\n\nCada vez que alguien se una al servidor, el bot enviará aquí un mensaje de bienvenida personalizado.`)
        .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Canal de bienvenida activo` });
      await targetChannel.send({ embeds: [embed] }).catch(() => {});
    }

    if (tipo === 'logs') {
      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle(`📋 Canal de Logs — ${guildName}`)
        .setDescription(`Este canal está configurado para recibir los registros de moderación del servidor.\n\nAquí se registrarán: kicks, bans, mutes, advertencias, mensajes eliminados y cambios de configuración.`)
        .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Canal de logs activo` });
      await targetChannel.send({ embeds: [embed] }).catch(() => {});
    }

    if (tipo === 'sorteos') {
      const embed = new EmbedBuilder()
        .setColor(0xFF73FA)
        .setTitle(`🎉 Canal de Sorteos — ${guildName}`)
        .setDescription('Este canal está configurado para los sorteos del servidor.\n\nLos administradores pueden crear sorteos con:\n```\n!sortear [duración] [ganadores] [premio]\n```\nEjemplo: !sortear 1h 1 20,000 Créditos IMVU\n\nLos miembros participan reaccionando con 🎉')
        .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Canal de sorteos activo` });
      await targetChannel.send({ embeds: [embed] }).catch(() => {});
    }

    if (tipo === 'anuncios') {
      const embed = new EmbedBuilder()
        .setColor(0xEB459E)
        .setTitle(`📢 Canal de Anuncios — ${guildName}`)
        .setDescription(`Este canal está configurado para los anuncios oficiales del servidor.\n\nSolo el staff puede publicar aquí. Los miembros recibirán notificaciones de los anuncios importantes.`)
        .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Canal de anuncios activo` });
      await targetChannel.send({ embeds: [embed] }).catch(() => {});
    }

    if (tipo === 'top3') {
      const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`🏆 Top 3 Salas Más Activas — ${guildName}`)
        .setDescription(`Este canal mostrará las 3 salas de DS6Music con más oyentes en tiempo real.\n\nSe actualiza automáticamente cada 10 minutos.`)
        .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Canal Top 3 activo` });
      await targetChannel.send({ embeds: [embed] }).catch(() => {});
    }

    if (tipo === 'reglas') {
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle(`📜 Reglas del Servidor — ${guildName}`)
        .setDescription('Este canal está configurado para las reglas del servidor.\n\nUsa !reglas para publicar las reglas o escríbelas directamente aquí.\n\nTodos los miembros deben leer y respetar las normas del servidor.')
        .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Canal de reglas activo` });
      await targetChannel.send({ embeds: [embed] }).catch(() => {});
    }

    if (tipo === 'general' || tipo === 'chatES' || tipo === 'chatEN') {
      const lang = tipo === 'chatEN' ? 'English' : 'Español';
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`💬 Canal de Chat — ${guildName}`)
        .setDescription(`Este canal está configurado como canal de chat principal (${lang}).\n\nLos miembros pueden usar aquí todos los comandos del bot con el prefijo !`)
        .setFooter({ text: `DS6 Bot v3.0 • ds6music.com • Canal de chat activo` });
      await targetChannel.send({ embeds: [embed] }).catch(() => {});
    }

    return message.reply(`✅ Canal de **${tipo}** configurado a <#${canal.id}>. Se ha enviado un mensaje de activación al canal.`);
  }

  // ══════════════════════════════════════════════════════
  //  CONFIGURACIÓN: !setrol / !levelroles
  // ══════════════════════════════════════════════════════
  if (command === 'setrol' || command === 'setrole' || command === 'levelroles') {
    if (!isBotOwner(message.author) && !message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
      return message.reply('❌ Solo los administradores pueden configurar roles de nivel.');
    const cfg = loadConfig(guildId);
    const nivel = args[0];
    const rol = message.mentions.roles.first();
    if (!nivel || !rol) {
      const current = Object.entries(cfg.levelRoles || {}).map(([lvl, id]) => `Nivel ${lvl}: <@&${id}>`).join('\n') || 'Ninguno configurado';
      const embed = new EmbedBuilder().setTitle('🏅 Roles de Nivel').setDescription(`**Roles actuales:**\n${current}\n\n**Uso:** \`!setrol [nivel] @rol\`\n**Ejemplo:** \`!setrol 5 @Activo\``).setColor(0xF1C40F);
      return message.channel.send({ embeds: [embed] });
    }
    if (!cfg.levelRoles) cfg.levelRoles = {};
    cfg.levelRoles[nivel] = rol.id;
    saveConfig(guildId, cfg);
    return message.reply(`✅ Rol de nivel **${nivel}** configurado a **${rol.name}**.`);
  }

  // ══════════════════════════════════════════════════════
  //  SORTEOS: !sortear (admin)
  // ══════════════════════════════════════════════════════
  if (command === 'sortear' || command === 'sorteo' || command === 'giveaway') {
    if (!isBotOwner(message.author) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Solo los administradores pueden crear sorteos.');
    // Formato: !sortear [duración] [ganadores] [premio...]
    // Ejemplo: !sortear 1h 1 20000 créditos IMVU
    // Ejemplo: !sortear 30m 3 Mes gratis de DS6Music
    const sub = args[0] ? args[0].toLowerCase() : '';
    // Cancelar sorteo activo
    if (sub === 'cancelar' || sub === 'cancel' || sub === 'stop') {
      if (!activeSorteos.has(guildId)) return message.reply('❌ No hay ningún sorteo activo en este servidor.');
      const s = activeSorteos.get(guildId);
      clearTimeout(s.timer);
      activeSorteos.delete(guildId);
      return message.reply('🚫 Sorteo cancelado.');
    }
    // Ver sorteo activo
    if (sub === 'ver' || sub === 'info' || sub === 'status') {
      if (!activeSorteos.has(guildId)) return message.reply('ℹ️ No hay ningún sorteo activo en este servidor.');
      const s = activeSorteos.get(guildId);
      const remaining = Math.max(0, s.endsAt - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      return message.reply(`🎉 **Sorteo activo:** ${s.premio}\n👥 Participantes: ${s.participants.size}\n🏆 Ganadores: ${s.ganadores}\n⏰ Termina en: ${mins}m ${secs}s`);
    }
    // Crear nuevo sorteo: !sortear [duración] [nGanadores] [premio...]
    if (activeSorteos.has(guildId)) return message.reply('❌ Ya hay un sorteo activo. Usa `!sortear cancelar` para cancelarlo primero.');
    const durStr = args[0];
    const nGanadores = parseInt(args[1]);
    const premio = args.slice(2).join(' ');
    if (!durStr || !nGanadores || !premio) {
      return message.reply(
        '❌ **Uso:** `!sortear [duración] [nGanadores] [premio]`\n\n' +
        '**Ejemplos:**\n' +
        '• `!sortear 1h 1 20,000 Créditos IMVU`\n' +
        '• `!sortear 30m 3 Premio especial`\n' +
        '• `!sortear 2h 1 Suscripción Premium`\n\n' +
        '**Duraciones:** `10m`, `30m`, `1h`, `2h`, `12h`, `1d`'
      );
    }
    const durMs = parseDuration(durStr);
    if (!durMs || durMs < 10000 || durMs > 86400000 * 7) return message.reply('❌ Duración inválida. Mínimo 10 segundos, máximo 7 días.');
    if (nGanadores < 1 || nGanadores > 20) return message.reply('❌ Número de ganadores debe ser entre 1 y 20.');
    const endsAt = Date.now() + durMs;
    const durText = formatDuration(durMs);
    const embed = new EmbedBuilder()
      .setTitle('🎉 ¡SORTEO INICIADO!')
      .setDescription(
        `**🎁 Premio:** ${premio}\n` +
        `**🏆 Ganadores:** ${nGanadores}\n` +
        `**⏰ Duración:** ${durText}\n` +
        `**📅 Termina:** <t:${Math.floor(endsAt / 1000)}:R>\n\n` +
        `Reacciona con 🎉 para participar!`
      )
      .setColor(0xFFD700)
      .setFooter({ text: `Sorteo creado por ${message.author.tag} • DS6 Bot` })
      .setTimestamp();
    const sorteoMsg = await message.channel.send({ embeds: [embed] });
    await sorteoMsg.react('🎉');
    const sorteoData = {
      premio, ganadores: nGanadores, durMs, endsAt,
      channelId: message.channel.id, messageId: sorteoMsg.id,
      participants: new Set(),
      timer: setTimeout(async () => {
        try {
          // Recoger participantes de la reacción
          const ch = message.guild.channels.cache.get(sorteoData.channelId);
          if (!ch) return;
          const msg = await ch.messages.fetch(sorteoData.messageId).catch(() => null);
          const reaction = msg ? msg.reactions.cache.get('🎉') : null;
          let users = reaction ? await reaction.users.fetch() : new Map();
          const eligible = [...users.values()].filter(u => !u.bot);
          activeSorteos.delete(guildId);
          if (eligible.length === 0) {
            return ch.send('😔 El sorteo terminó pero **nadie participó**. ¡Mejor suerte la próxima vez!');
          }
          // Elegir ganadores únicos al azar
          const shuffled = eligible.sort(() => Math.random() - 0.5);
          const winners = shuffled.slice(0, Math.min(nGanadores, shuffled.length));
          const mentions = winners.map(u => `<@${u.id}>`).join(', ');
          const resultEmbed = new EmbedBuilder()
            .setTitle('🏆 ¡SORTEO FINALIZADO — RESULTADOS!')
            .setDescription(
              `**🎁 Premio:** ${premio}\n\n` +
              `**🎉 Ganador${winners.length > 1 ? 'es' : ''}:**\n${mentions}\n\n` +
              `**👥 Participantes totales:** ${eligible.length}\n` +
              `> Contacten al Staff para reclamar su premio.`
            )
            .setColor(0x00E676)
            .setFooter({ text: 'DS6 Bot • Sorteo oficial' })
            .setTimestamp();
          await ch.send({ content: `🎊 ¡Felicitaciones ${mentions}!`, embeds: [resultEmbed] });
        } catch(e) { console.error('[Sorteo] Error al finalizar:', e.message); }
      }, durMs)
    };
    activeSorteos.set(guildId, sorteoData);
    return;
  }

  } catch(e) { console.error('[CMD Error]', e.message); }
});
// ══════════════════════════════════════════════════════
//  INTERACCIONES (Botones, Slash Commands, Context Menus)
// ══════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction) => {

  // ── BOTONES ──
  if (interaction.isButton()) {
    // Botón de comandos en el mensaje de bienvenida del servidor
    if (interaction.customId === 'welcome_comandos') {
      const embed = new EmbedBuilder()
        .setTitle('📋 Comandos de DS6 Bot v3.0')
        .setColor(0x8B0000)
        .addFields(
          { name: '⚙️ Configuración', value: '`!setup` `!config` `!bienvenida` `!autoroles` `!antispam`', inline: false },
          { name: '🛡️ Moderación', value: '`!kick` `!ban` `!unban` `!silenciar` `!warn` `!clear` `!lock`', inline: false },
          { name: '💰 Economía', value: '`!coins` `!daily` `!trabajo` `!robar` `!transferir` `!topcoins`', inline: false },
          { name: '⭐ Niveles', value: '`!nivel` `!top` `!perfil` `!xp`', inline: false },
          { name: '🎮 Diversión', value: '`!8ball` `!trivia` `!rps` `!dado` `!moneda` `!chiste` `!meme`', inline: false },
          { name: '🎫 Soporte', value: '`!ticket` `!cerrar` `!tag`', inline: false },
          { name: '🔧 Utilidades', value: '`!userinfo` `!serverinfo` `!avatar` `!ping` `!botinfo` `!poll`', inline: false },
        )
        .setFooter({ text: 'DS6 Bot v3.0 • Usa !ayuda para más detalles • ds6music.com' });
      return await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] }).catch(() => {});
    }

    if (!interaction.guild) return;
    const guildId = interaction.guild.id;
    const cfg = loadConfig(guildId);

    if (interaction.customId === 'open_ticket') {
      await interaction.deferReply({ flags: ['Ephemeral'] });
      try {
        const guild = interaction.guild;
        const user  = interaction.user;
        const ticketCatId = cfg.ticketCategoryId;

        const existing = guild.channels.cache.find(
          c => c.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}` &&
               (!ticketCatId || c.parentId === ticketCatId)
        );
        if (existing) return interaction.editReply({ content: `❌ Ya tienes un ticket abierto: <#${existing.id}>` });

        const permOverwrites = [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, type: 1, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: client.user.id, type: 1, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] },
        ];
        if (cfg.ticketRoles && cfg.ticketRoles.staff) permOverwrites.push({ id: cfg.ticketRoles.staff, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
        if (cfg.ticketRoles && cfg.ticketRoles.owner) permOverwrites.push({ id: cfg.ticketRoles.owner, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });

        const ticketCh = await guild.channels.create({
          name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          type: ChannelType.GuildText,
          parent: ticketCatId || null,
          permissionOverwrites: permOverwrites
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Cerrar Ticket').setStyle(ButtonStyle.Danger)
        );
        const welcomeEmbed = new EmbedBuilder()
          .setTitle(`🎫 Ticket de ${user.username}`)
          .setDescription(`Hola <@${user.id}>, el Staff te atenderá **inmediatamente**.\n\nDescribe tu consulta y espera la respuesta.`)
          .setColor(0x9B59B6)
          .setTimestamp();

        const mentions = [
          `<@${user.id}>`,
          cfg.ticketRoles && cfg.ticketRoles.staff ? `<@&${cfg.ticketRoles.staff}>` : '',
          cfg.ticketRoles && cfg.ticketRoles.owner ? `<@&${cfg.ticketRoles.owner}>` : '',
        ].filter(Boolean).join(' ');

        await ticketCh.send({ content: mentions, embeds: [welcomeEmbed], components: [closeRow] });
        await interaction.editReply({ content: `✅ Tu ticket fue creado: <#${ticketCh.id}>` });
        await sendLog(guild, `🎫 **Nuevo ticket** de ${user.tag} → <#${ticketCh.id}>`, 0x9B59B6);
      } catch(e) {
        await interaction.editReply({ content: '❌ Error al crear el ticket. Intenta de nuevo.' });
      }
      return;
    }

    // 🔒 CERRAR TICKET (cubre close_ticket y close_ticket_XXXXXX de tickets viejos)
    if (interaction.customId === 'close_ticket' || interaction.customId.startsWith('close_ticket_')) {
      await interaction.deferReply({ flags: ['Ephemeral'] });
      try {
        const ch = interaction.channel;
        const msg = interaction.message;
        const user = interaction.user;
        const member = interaction.member;

        // Cualquiera puede cerrar: el que abrió el ticket, staff o admin
        // Solo bloqueamos si es un miembro sin ningún permiso especial
        // (en canal de soporte público, solo staff/admin)
        const isTicketChannel = ch.name.startsWith('ticket-');
        const canClose = isTicketChannel ||
          isStaff(member) ||
          member.permissions.has(PermissionsBitField.Flags.Administrator) ||
          member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
          member.permissions.has(PermissionsBitField.Flags.ManageGuild);

        if (!canClose) {
          return interaction.editReply({ content: '❌ Solo el Staff puede cerrar tickets.' });
        }

        // Embed de cierre bonito
        const closeEmbed = new EmbedBuilder()
          .setTitle('🔒 Ticket Cerrado')
          .setDescription(`Este ticket ha sido **cerrado** por <@${user.id}>.`)
          .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
          .addFields(
            { name: '👤 Cerrado por', value: `**${user.username}**`, inline: true },
            { name: '📅 Fecha', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
          )
          .setColor(0xFF4500)
          .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com' })
          .setTimestamp();

        // Deshabilitar botones del mensaje original
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Ticket Cerrado').setStyle(ButtonStyle.Danger).setDisabled(true),
          new ButtonBuilder().setCustomId('claim_ticket').setLabel('🔒 Cerrado').setStyle(ButtonStyle.Secondary).setDisabled(true),
        );
        await msg.edit({ components: [disabledRow] }).catch(() => {});

        if (isTicketChannel) {
          // Canal privado de ticket: enviar embed y eliminar en 8s
          await ch.send({ embeds: [closeEmbed] });
          setTimeout(() => ch.delete().catch(() => {}), 8000);
        } else {
          // Canal de soporte: solo deshabilitar botones y enviar embed en el canal
          await ch.send({ embeds: [closeEmbed] }).catch(() => {});
        }

        await interaction.editReply({ content: '✅ Ticket cerrado correctamente.' });
        await sendLog(interaction.guild, `🔒 **Ticket cerrado** por ${user.tag} en <#${ch.id}>`, 0xFF4500);
      } catch(e) {
        try { await interaction.editReply({ content: '❌ Error al cerrar el ticket: ' + e.message }); } catch(_) {}
      }
      return;
    }

    // ✋ TOMAR TICKET (cubre claim_ticket y claim_ticket_XXXXXX de tickets viejos)
    if (interaction.customId === 'claim_ticket' || interaction.customId.startsWith('claim_ticket_')) {
      await interaction.deferReply({ flags: ['Ephemeral'] });
      try {
        const user = interaction.user;
        const member = interaction.member;
        const msg = interaction.message;

        // Solo staff/admin puede tomar tickets
        if (!isStaff(member) &&
            !member.permissions.has(PermissionsBitField.Flags.Administrator) &&
            !member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
          return interaction.editReply({ content: '❌ Solo el Staff puede tomar tickets.' });
        }

        // Verificar si ya fue tomado (botón deshabilitado)
        const alreadyClaimed = msg.components[0]?.components?.find(c => c.customId === 'claim_ticket')?.disabled;
        if (alreadyClaimed) {
          return interaction.editReply({ content: '❌ Este ticket ya fue tomado por otro miembro del Staff.' });
        }

        // Actualizar botones del mensaje original
        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 Cerrar Ticket').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('claim_ticket').setLabel(`✅ Tomado`).setStyle(ButtonStyle.Success).setDisabled(true),
        );
        await msg.edit({ components: [updatedRow] }).catch(() => {});

        // Embed bonito de "ticket tomado"
        const claimEmbed = new EmbedBuilder()
          .setTitle('✋ Ticket Tomado')
          .setDescription(`<@${user.id}> ha tomado este ticket y se encargará de atenderte.\n\nPor favor espera mientras el Staff revisa tu consulta.`)
          .setThumbnail(user.displayAvatarURL({ forceStatic: false }))
          .addFields(
            { name: '👮 Staff asignado', value: `**${member.nickname || user.username}**`, inline: true },
            { name: '🏷️ Etiqueta', value: `\`${user.tag}\``, inline: true },
            { name: '📅 Hora', value: `<t:${Math.floor(Date.now()/1000)}:t>`, inline: true },
          )
          .setColor(0x57F287)
          .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • El Staff está en camino' })
          .setTimestamp();

        await interaction.channel.send({ embeds: [claimEmbed] }).catch(() => {});
        await interaction.editReply({ content: `✅ Has tomado el ticket. Ahora eres el responsable de atenderlo.` });
        await sendLog(interaction.guild, `✋ **Ticket tomado** por ${user.tag} en <#${interaction.channel.id}>`, 0x57F287);
      } catch(e) {
        try { await interaction.editReply({ content: '❌ Error al tomar el ticket: ' + e.message }); } catch(_) {}
      }
      return;
    }

    // ── Botones del menú !comandos ──
    const cmdButtons = {
      'cmd_diversion': {
        title: '🎮 Comandos de Diversión',
        color: 0x3498DB,
        desc: '`!8ball [pregunta]` — Bola mágica\n`!dado [caras]` — Tirar dado (ej: `!dado 20`)\n`!moneda` — Cara o cruz\n`!chiste` — Chiste aleatorio\n`!abrazo @user` — Abrazar\n`!beso @user` — Besar\n`!slap @user` — Golpear\n`!meme` — Meme aleatorio\n`!rps piedra/papel/tijera` — Piedra Papel Tijera (+10 coins si ganas)\n`!trivia` — Pregunta trivia (+25 coins si aciertas)\n`!verdadoreto [verdad/reto] [@user]` — Verdad o Reto\n`!bailar` `!llorar` `!dormir` `!comer` `!highfive @user`'
      },
      'cmd_economia': {
        title: '💰 Comandos de Economía',
        color: 0xF1C40F,
        desc: '`!coins` — Ver tus DS6 Coins\n`!daily` — Recompensa diaria (cada 24h)\n`!trabajo` — Trabajar y ganar coins (cada 4h)\n`!robar @user` — Intentar robar coins (45% éxito, cada 2h)\n`!transferir @user [cantidad]` — Transferir coins\n`!topcoins` — Top 10 más ricos del servidor\n`!invitaciones` — Ver tus tickets de sorteo\n`!canjear [código]` — Canjear código de recompensa'
      },
      'cmd_mod': {
        title: '🛡️ Comandos de Moderación (Solo Staff)',
        color: 0xFF4500,
        desc: '`!kick @user [razón]` — Expulsar usuario\n`!ban @user [razón]` — Banear usuario\n`!unban [ID]` — Desbanear por ID\n`!silenciar @user [tiempo] [razón]` — Silenciar (ej: `10m`, `2h`)\n`!desilenciar @user` — Quitar silencio\n`!warn @user [razón]` — Advertir (auto-mute x3, auto-ban x5)\n`!warnings @user` — Ver advertencias\n`!clearwarns @user` — Borrar advertencias\n`!clear [1-100]` — Borrar mensajes\n`!lock` / `!unlock` — Bloquear/desbloquear canal\n`!slowmode [seg]` — Modo lento\n`!nick @user [apodo]` — Cambiar apodo\n`!banlist` — Ver lista de bans'
      },
      'cmd_config': {
        title: '⚙️ Comandos de Configuración (Solo Admin)',
        color: 0x9B59B6,
        desc: '`!setup` — Configurar el bot automáticamente\n`!config` — Ver configuración actual\n`!bienvenida canal #canal` — Canal de bienvenida\n`!bienvenida mensaje [texto]` — Mensaje personalizado\n`!bienvenida on/off` — Activar/desactivar bienvenida\n`!autoroles add @rol` — Agregar auto-rol\n`!autoroles ver` — Ver auto-roles\n`!antispam on/off` — Activar anti-spam\n`!setcanal [tipo] #canal` — Configurar canal\n`!setrol [nivel] @rol` — Configurar rol de nivel\n`!sorteo meta [N]` — Cambiar meta del sorteo\n`!idioma es/en/pt` — Cambiar idioma del bot'
      },
      'cmd_util': {
        title: '🔧 Comandos de Utilidades',
        color: 0x00E676,
        desc: '`!tag add [nombre] [respuesta]` — Crear etiqueta\n`!tag [nombre]` — Mostrar etiqueta\n`!tag list` — Ver todas las etiquetas\n`!poll [pregunta] | opción1 | opción2` — Encuesta\n`!calc [expresión]` — Calculadora\n`!recordatorio [tiempo] [texto]` — Recordatorio\n`!ping` — Ver latencia del bot\n`!botinfo` — Información del bot\n`!userinfo [@user]` — Info de usuario\n`!serverinfo` — Info del servidor\n`!avatar [@user]` — Ver avatar\n`!reglas` — Ver reglas del servidor\n`!ticket [consulta]` — Crear ticket de soporte'
      }
    };

    if (cmdButtons[interaction.customId]) {
      const btn = cmdButtons[interaction.customId];
      const embed = new EmbedBuilder().setTitle(btn.title).setDescription(btn.desc).setColor(btn.color).setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • Prefijo: ! • !comandos para volver' });
      return await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
    }

    return; // botón no reconocido
  }

  // ── SLASH COMMANDS ──
  if (interaction.isChatInputCommand()) {
    const slashGuildId = interaction.guild?.id;
    const slashUserId = interaction.user.id;

    // /info
    if (interaction.commandName === 'info') {
      const uptime = process.uptime();
      const d = Math.floor(uptime / 86400);
      const h = Math.floor((uptime % 86400) / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const ping = Math.round(client.ws.ping);
      const embed = new EmbedBuilder()
        .setTitle('🤖 DS6 Bot — Información')
        .setDescription('> Bot oficial de la comunidad DS6 — Economía, niveles, moderación, diversión y más.')
        .setColor(0x5865F2)
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
          { name: '📛 Nombre', value: `**${client.user.tag}**`, inline: true },
          { name: '📡 Servidores', value: `**${client.guilds.cache.size}**`, inline: true },
          { name: '📦 Versión', value: '**v3.0**', inline: true },
          { name: '⏱️ Uptime', value: `**${d}d ${h}h ${m}m**`, inline: true },
          { name: '🏓 Ping', value: `**${ping > 0 ? ping : '< 1'}ms**`, inline: true },
          { name: '🌐 Sitio Web', value: '[ds6music.com](https://ds6music.com)', inline: true },
          { name: '\u200b', value: '\u200b', inline: false },
          { name: '🤖 DS6 Bot', value: 'Bot multi-servidor con moderación, economía, niveles, tickets y más.', inline: false }
        )
        .setFooter({ text: '❤️ Desarrollado con pasión por Daddy • DS6 Bot v3.0 • ds6music.com' })
        .setTimestamp();
      return await interaction.reply({ embeds: [embed] });
    }

    // /ping
    if (interaction.commandName === 'ping') {
      return await interaction.reply({ content: `🏓 Pong! Latencia: **${client.ws.ping}ms**`, flags: ['Ephemeral'] });
    }

    // /ayuda
    if (interaction.commandName === 'ayuda') {
      const embed = new EmbedBuilder()
        .setTitle('📋 DS6 Bot — Comandos')
        .setColor(0x5865F2)
        .setDescription('Usa `!comandos` para ver el menú interactivo completo con botones por categoría.')
        .addFields(
          { name: '💰 Economía', value: '`!coins` `!daily` `!trabajo` `!transferir` `!topcoins`', inline: false },
          { name: '📊 Niveles', value: '`!nivel` `!top` `!perfil`', inline: false },
          { name: '🎮 Diversión', value: '`!8ball` `!rps` `!trivia` `!chiste` `!dado` `!abrazo`', inline: false },
          { name: '🛡️ Moderación', value: '`!kick` `!ban` `!silenciar` `!warn` `!clear` `!lock`', inline: false },
          { name: '⚙️ Config', value: '`!setup` `!bienvenida` `!autoroles` `!config` `!sorteo`', inline: false },
          { name: '🔧 Utilidades', value: '`!ping` `!botinfo` `!userinfo` `!serverinfo` `!ticket`', inline: false }
        )
        .setFooter({ text: 'DS6 Bot v3.0 • Prefijo: !' });
      return await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
    }

    // /nivel
    if (interaction.commandName === 'nivel') {
      if (!slashGuildId) return await interaction.reply({ content: 'Este comando solo funciona en servidores.', flags: ['Ephemeral'] });
      const xpData = loadXP(slashGuildId);
      const user = xpData[slashUserId] || { xp: 0, level: 0 };
      const nextLevelXp = (user.level + 1) * 100;
      const embed = new EmbedBuilder()
        .setTitle(`📊 Nivel de ${interaction.user.username}`)
        .setColor(0x00E676)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: '⭐ Nivel', value: `${user.level}`, inline: true },
          { name: '✨ XP', value: `${user.xp} / ${nextLevelXp}`, inline: true }
        )
        .setFooter({ text: 'DS6 Bot v3.0' });
      return await interaction.reply({ embeds: [embed] });
    }

    // /coins
    if (interaction.commandName === 'coins') {
      if (!slashGuildId) return await interaction.reply({ content: 'Este comando solo funciona en servidores.', flags: ['Ephemeral'] });
      const coinsData = loadCoins(slashGuildId);
      const coins = coinsData[slashUserId] || 0;
      const embed = new EmbedBuilder()
        .setTitle(`💰 Coins de ${interaction.user.username}`)
        .setColor(0xF1C40F)
        .setDescription(`Tienes **${coins.toLocaleString()} DS6 Coins** 🪙`)
        .setFooter({ text: 'DS6 Bot v3.0 • Usa !daily para ganar más coins' });
      return await interaction.reply({ embeds: [embed] });
    }

    // /perfil
    if (interaction.commandName === 'perfil') {
      if (!slashGuildId) return await interaction.reply({ content: 'Este comando solo funciona en servidores.', flags: ['Ephemeral'] });
      const xpData = loadXP(slashGuildId);
      const coinsData = loadCoins(slashGuildId);
      const invDataRaw = loadInvites(slashGuildId);
      const user = xpData[slashUserId] || { xp: 0, level: 0 };
      const coins = coinsData[slashUserId] || 0;
      const inv = invDataRaw.invites[slashUserId] || { count: 0 };
      const member = interaction.member;
      const embed = new EmbedBuilder()
        .setTitle(`👤 Perfil de ${interaction.user.username}`)
        .setColor(0x5865F2)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: '⭐ Nivel', value: `${user.level}`, inline: true },
          { name: '✨ XP', value: `${user.xp}`, inline: true },
          { name: '💰 Coins', value: `${coins.toLocaleString()}`, inline: true },
          { name: '📨 Invitaciones', value: `${inv.count || 0}`, inline: true },
          { name: '📅 En el servidor desde', value: member ? `<t:${Math.floor(member.joinedTimestamp/1000)}:R>` : 'N/A', inline: true }
        )
        .setFooter({ text: 'DS6 Bot v3.0' });
      return await interaction.reply({ embeds: [embed] });
    }

    // /top
    if (interaction.commandName === 'top') {
      if (!slashGuildId) return await interaction.reply({ content: 'Este comando solo funciona en servidores.', flags: ['Ephemeral'] });
      const xpData = loadXP(slashGuildId);
      const sorted = Object.entries(xpData).sort((a,b) => (b[1].xp||0)-(a[1].xp||0)).slice(0,10);
      const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
      const desc = sorted.length ? sorted.map((e,i) => `${medals[i]} <@${e[0]}> — Nivel **${e[1].level||0}** • ${e[1].xp||0} XP`).join('\n') : 'No hay datos aún.';
      const embed = new EmbedBuilder()
        .setTitle('🏆 Top 10 — Ranking XP')
        .setColor(0xF1C40F)
        .setDescription(desc)
        .setFooter({ text: 'DS6 Bot v3.0' });
      return await interaction.reply({ embeds: [embed] });
    }

    // /invitaciones
    if (interaction.commandName === 'invitaciones') {
      if (!slashGuildId) return await interaction.reply({ content: 'Este comando solo funciona en servidores.', flags: ['Ephemeral'] });
      const invDataRaw = loadInvites(slashGuildId);
      const inv = invDataRaw.invites[slashUserId] || { count: 0 };
      const tickets = 1 + (inv.count || 0);
      const embed = new EmbedBuilder()
        .setTitle(`📨 Invitaciones de ${interaction.user.username}`)
        .setColor(0x5865F2)
        .addFields(
          { name: '👥 Invitaciones', value: `${inv.count || 0}`, inline: true },
          { name: '🎫 Tickets de sorteo', value: `${tickets}`, inline: true }
        )
        .setFooter({ text: 'DS6 Bot v3.0 • Más invitaciones = más tickets' });
      return await interaction.reply({ embeds: [embed] });
    }

    return; // slash command no reconocido
  }

  // ── CONTEXT MENU COMMANDS ──
  if (interaction.isUserContextMenuCommand() || interaction.isMessageContextMenuCommand()) {
    const targetUser = interaction.isUserContextMenuCommand() ? interaction.targetUser : null;
    const ctxGuildId = interaction.guild?.id;

    // Ver Perfil DS6 (clic derecho en usuario)
    if (interaction.commandName === 'Ver Perfil DS6') {
      const uid = targetUser.id;
      const xpData = ctxGuildId ? loadXP(ctxGuildId) : {};
      const coinsData = ctxGuildId ? loadCoins(ctxGuildId) : {};
      const invDataRaw = ctxGuildId ? loadInvites(ctxGuildId) : { invites: {} };
      const userXp = xpData[uid] || { xp: 0, level: 0 };
      const coins = coinsData[uid] || 0;
      const inv = invDataRaw.invites[uid] || { count: 0 };
      const member = ctxGuildId ? interaction.guild.members.cache.get(uid) : null;
      const embed = new EmbedBuilder()
        .setTitle(`👤 Perfil de ${targetUser.username}`)
        .setColor(0x5865F2)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: '⭐ Nivel', value: `${userXp.level}`, inline: true },
          { name: '✨ XP', value: `${userXp.xp}`, inline: true },
          { name: '💰 DS6 Coins', value: `${coins.toLocaleString()}`, inline: true },
          { name: '📨 Invitaciones', value: `${inv.count || 0}`, inline: true },
          { name: '🎫 Tickets sorteo', value: `${1 + (inv.count || 0)}`, inline: true },
          { name: '📅 En el servidor', value: member ? `<t:${Math.floor(member.joinedTimestamp/1000)}:R>` : 'N/A', inline: true }
        )
        .setFooter({ text: 'DS6 Bot v3.0' });
      return await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
    }

    // Ver Coins DS6 (clic derecho en usuario)
    if (interaction.commandName === 'Ver Coins DS6') {
      const uid = targetUser.id;
      const coinsData = ctxGuildId ? loadCoins(ctxGuildId) : {};
      const coins = coinsData[uid] || 0;
      const embed = new EmbedBuilder()
        .setTitle(`💰 Coins de ${targetUser.username}`)
        .setColor(0xF1C40F)
        .setThumbnail(targetUser.displayAvatarURL())
        .setDescription(`**${targetUser.username}** tiene **${coins.toLocaleString()} DS6 Coins** 🪙`)
        .setFooter({ text: 'DS6 Bot v3.0' });
      return await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
    }

    // Ver Nivel DS6 (clic derecho en usuario)
    if (interaction.commandName === 'Ver Nivel DS6') {
      const uid = targetUser.id;
      const xpData = ctxGuildId ? loadXP(ctxGuildId) : {};
      const userXp = xpData[uid] || { xp: 0, level: 0 };
      const nextLvl = (userXp.level + 1) * 100;
      const embed = new EmbedBuilder()
        .setTitle(`📊 Nivel de ${targetUser.username}`)
        .setColor(0x00E676)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: '⭐ Nivel', value: `${userXp.level}`, inline: true },
          { name: '✨ XP', value: `${userXp.xp} / ${nextLvl}`, inline: true }
        )
        .setFooter({ text: 'DS6 Bot v3.0' });
      return await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
    }

    // Ver Invitaciones DS6 (clic derecho en usuario)
    if (interaction.commandName === 'Ver Invitaciones DS6') {
      const uid = targetUser.id;
      const invDataRaw2 = ctxGuildId ? loadInvites(ctxGuildId) : { invites: {} };
      const inv = invDataRaw2.invites[uid] || { count: 0 };
      const embed = new EmbedBuilder()
        .setTitle(`📨 Invitaciones de ${targetUser.username}`)
        .setColor(0x5865F2)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: '👥 Invitaciones', value: `${inv.count || 0}`, inline: true },
          { name: '🎫 Tickets sorteo', value: `${1 + (inv.count || 0)}`, inline: true }
        )
        .setFooter({ text: 'DS6 Bot v3.0' });
      return await interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
    }

    // Reportar Mensaje (clic derecho en mensaje)
    if (interaction.commandName === 'Reportar Mensaje') {
      const msg = interaction.targetMessage;
      const logCh = ctxGuildId ? loadConfig(ctxGuildId).channels?.logs : null;
      const logChannel = logCh ? interaction.guild?.channels.cache.get(logCh) : null;
      const embed = new EmbedBuilder()
        .setTitle('⚠️ Mensaje Reportado')
        .setColor(0xFF4500)
        .addFields(
          { name: '👤 Autor', value: `${msg.author.tag}`, inline: true },
          { name: '📍 Canal', value: `<#${msg.channelId}>`, inline: true },
          { name: '📝 Contenido', value: msg.content || '*[Sin texto]*', inline: false }
        )
        .setFooter({ text: `Reportado por ${interaction.user.tag}` })
        .setTimestamp();
      if (logChannel) await logChannel.send({ embeds: [embed] }).catch(() => {});
      return await interaction.reply({ content: '✅ Mensaje reportado al staff del servidor.', flags: ['Ephemeral'] });
    }

    return; // context menu no reconocido
  }

});

// ══════════════════════════════════════════════════════
//  MENSAJES PRIVADOS (DM)
// ══════════════════════════════════════════════════════
const dmGreeted = new Set(); // evitar spam de bienvenida

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.guild) return; // solo DMs

  const content = message.content.trim();
  const isDMCommand = content.startsWith('!');
  const args = isDMCommand ? content.slice(1).trim().split(/\s+/) : [];
  const command = isDMCommand ? args.shift().toLowerCase() : null;

  // ── Bienvenida automática al primer mensaje ──
  if (!dmGreeted.has(message.author.id)) {
    dmGreeted.add(message.author.id);
    const welcomeEmbed = new EmbedBuilder()
      .setTitle('👋 ¡Hola! Soy DS6 Bot')
      .setThumbnail(client.user.displayAvatarURL({ forceStatic: false }))
      .setDescription(
        `¡Bienvenido/a a mis mensajes privados, **${message.author.username}**! 🎵\n\n` +
        `Soy el bot oficial de **DS6**, creado y desarrollado por\n` +
        `> 👑 **Daddy** — Senior Developer & Fundador de DS6Music\n` +
        `> 🌐 [ds6music.com](https://ds6music.com)\n\n` +
        `Puedes usar los siguientes comandos aquí en privado:\n\n` +
        `\`!comandos\` — Ver todos los comandos disponibles\n` +
        `\`!ayuda\` — Guía de uso del bot\n` +
        `\`!ping\` — Ver latencia\n` +
        `\`!botinfo\` — Información del bot\n` +
        `\`!invitar\` — Link para agregar el bot a tu servidor\n\n` +
        `Para usar el bot al máximo, **agrégalo a tu servidor** y usa \`!setup\` para configurarlo. 🚀`
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6 Bot v3.0 • Desarrollado por Daddy • ds6music.com' })
      .setTimestamp();
    await message.author.send({ embeds: [welcomeEmbed] }).catch(() => {});
    if (!isDMCommand) return;
  }

  if (!isDMCommand) {
    // Mensaje genérico sin comando
    return message.author.send('💬 Escribe `!comandos` para ver todo lo que puedo hacer, o `!ayuda` para más información.').catch(() => {});
  }

  // ── Comandos disponibles en DM ──
  if (command === 'comandos' || command === 'commands' || command === 'menu') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Comandos DS6 Bot v3.0')
      .setDescription('Lista de todos los comandos. Prefijo: `!`\nÚsalos en tu servidor para acceder a todas las funciones.')
      .addFields(
        { name: '🎮 Diversión', value: '`!8ball` `!dado` `!moneda` `!chiste`\n`!abrazo` `!beso` `!slap` `!meme`\n`!rps` `!trivia` `!verdadoreto`\n`!bailar` `!llorar` `!comer` `!dormir`', inline: true },
        { name: '💰 Economía', value: '`!coins` `!daily` `!trabajo`\n`!transferir` `!robar` `!topcoins`\n`!invitaciones` `!canjear`', inline: true },
        { name: '📊 Perfil', value: '`!nivel` `!top` `!perfil`\n`!userinfo` `!avatar`\n`!serverinfo` `!botinfo`\n`!ping`', inline: true },
        { name: '🛡️ Moderación (Staff)', value: '`!kick` `!ban` `!unban`\n`!silenciar` `!desilenciar`\n`!warn` `!warnings` `!clearwarns`\n`!clear` `!lock` `!unlock`\n`!slowmode` `!nick` `!banlist`\n`!privado`', inline: true },
        { name: '⚙️ Config (Admin)', value: '`!setup` `!config` `!bienvenida`\n`!autoroles` `!antispam`\n`!setcanal` `!setrol` `!sorteo`\n`!idioma` `!tag`\n`!editar` `!link`', inline: true },
        { name: '🎫 Tickets & Más', value: '`!ticket [consulta]`\n`!poll` `!calc` `!recordatorio`\n`!traducir` `!reglas` `!precio`', inline: true },
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6 Bot v3.0 • Desarrollado por Daddy • ds6music.com' })
      .setTimestamp();
    return message.author.send({ embeds: [embed] }).catch(() => {});
  }

  if (command === 'ayuda' || command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📖 Guía de DS6 Bot')
      .setDescription(
        '**¿Cómo usar el bot?**\n\n' +
        '1️⃣ Agrega el bot a tu servidor con `!invitar`\n' +
        '2️⃣ Usa `!setup` para configurarlo automáticamente\n' +
        '3️⃣ Los miembros pueden usar `!nivel`, `!coins`, `!daily`\n' +
        '4️⃣ El staff puede moderar con `!kick`, `!ban`, `!warn`\n' +        '5️⃣ Personaliza con `!bienvenida`, `!autoroles`, `!config`\n' +
        '6️⃣ Edita mensajes del servidor con `!editar`\n' +
        '7️⃣ Genera el link permanente con `!link`\n\n' +
        '**Sistema de economía:**\n' +
        '• Gana DS6 Coins chateando, con `!daily` y `!trabajo`\n' +
        '• Úsalos en sorteos y más funciones\n\n' +
        '**Sistema de niveles:**\n' +
        '• Gana XP por cada mensaje enviado\n' +
        '• Sube de nivel y desbloquea roles especiales\n\n' +
        '**Personalizar mensajes:**\n' +
        '• `!editar bienvenida [texto]` — mensaje de bienvenida\n' +
        '• `!editar despedida [texto]` — mensaje de despedida\n' +
        '• `!editar reglas [texto]` — reglas del servidor\n' +
        '• `!editar anuncio [texto]` — plantilla de anuncios\n' +
        '• `!editar ver` — ver todos los mensajes configurados\n\n' +
        '**Soporte:** Escíribele a **Daddy** en Discord o visita [ds6music.com](https://ds6music.com)'
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6 Bot v3.0 • Desarrollado por Daddy • ds6music.com' });
    return message.author.send({ embeds: [embed] }).catch(() => {});
  }

  if (command === 'ping') {
    return message.author.send(`🏓 **Pong!** Latencia: **${Math.round(client.ws.ping)}ms**`).catch(() => {});
  }

  if (command === 'botinfo' || command === 'info') {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const embed = new EmbedBuilder()
      .setTitle('🤖 DS6 Bot — Información')
      .setThumbnail(client.user.displayAvatarURL({ forceStatic: false }))
      .addFields(
        { name: '📛 Nombre', value: client.user.tag, inline: true },
        { name: '📡 Servidores', value: `**${client.guilds.cache.size}**`, inline: true },
        { name: '⏱️ Uptime', value: `**${days}d ${hours}h ${mins}m**`, inline: true },
        { name: '🏓 Ping', value: `**${Math.round(client.ws.ping)}ms**`, inline: true },
        { name: '📦 Versión', value: '**v3.0**', inline: true },
        { name: '🤖 DS6 Bot', value: 'Bot multi-servidor v3.0', inline: true },
        { name: '🔗 Web', value: '[ds6music.com](https://ds6music.com)', inline: false },
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6 Bot v3.0 • Desarrollado por Daddy • ds6music.com' })
      .setTimestamp();
    return message.author.send({ embeds: [embed] }).catch(() => {});
  }

  if (command === 'invitar' || command === 'invite' || command === 'agregar') {
    const embed = new EmbedBuilder()
      .setTitle('➕ Agregar DS6 Bot a tu servidor')
      .setDescription(
        '¡Agrega el bot a tu servidor de Discord!\n\n' +
        '🔗 **[Haz clic aquí para agregar el bot](https://discord.com/oauth2/authorize?client_id=1503654573615612065&scope=bot+applications.commands&permissions=8)**\n\n' +
        'Una vez agregado, usa `!setup` para configurarlo automáticamente.\n\n' +
        '**DS6 Bot v3.0** — Bot multi-servidor\n' +
        '**Web:** [ds6music.com](https://ds6music.com)'
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com' });
    return message.author.send({ embeds: [embed] }).catch(() => {});
  }

  // Comando no reconocido en DM
  return message.author.send(`❓ Comando \`!${command}\` no disponible en mensajes privados.\nEscribe \`!comandos\` para ver qué puedo hacer aquí, o úsame en un servidor para acceder a todas las funciones.`).catch(() => {});
});

// ══════════════════════════════════════════════════════
//  EVENTOS DE INVITACIONES
// ══════════════════════════════════════════════════════
client.on(Events.InviteCreate, (invite) => {
  const cache = inviteCaches.get(invite.guild.id) || new Map();
  cache.set(invite.code, invite.uses || 0);
  inviteCaches.set(invite.guild.id, cache);
});

client.on(Events.InviteDelete, (invite) => {
  const cache = inviteCaches.get(invite.guild.id);
  if (cache) cache.delete(invite.code);
});

// ══════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════
client.login(TOKEN).catch(err => {
  console.error('Error al conectar:', err.message);
  process.exit(1);
});
