// ═══════════════════════════════════════════════════════
//  DS6Music Discord Bot — Multi-Servidor v2.0
//  Funciona en cualquier servidor de Discord
// ═══════════════════════════════════════════════════════
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActivityType,
        PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle,
        ChannelType } = require('discord.js');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ── Token ──
const TOKEN = process.env.DISCORD_TOKEN; // Requerido: variable de entorno DISCORD_TOKEN

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
      .setTitle('🎉 ¡Sorteos DS6Music!')
      .setColor(0xF1C40F)
      .setDescription(
        `Participamos en sorteos oficiales de **DS6Music**.\n¡Mantente atento para ganar premios increíbles!\n\n` +
        `**🎁 ¿Qué se sortea?**\n• Créditos IMVU\n• Meses de suscripción al bot DS6Music\n• Premios especiales anunciados en cada sorteo\n\n` +
        `**📋 ¿Cómo participar?**\nSolo necesitas ser miembro del servidor.\n¡El ganador es elegido automáticamente al azar entre todos los miembros!\n\n` +
        `**🎟️ ¿Quieres más probabilidades de ganar?**\nInvita amigos al servidor — **cada miembro que invites te da +1 ticket extra** en el sorteo.\nUsa \`!invitaciones\` para ver cuántos puntos tienes.\n\n` +
        `**🏆 PRÓXIMO GRAN SORTEO — 35,000 Créditos IMVU**\n` +
        `> 🥇 1er lugar: **20,000 créditos**\n> 🥈 2do lugar: **10,000 créditos**\n> 🥉 3er lugar: **5,000 créditos**\n\n` +
        `> 🎯 Se activa automáticamente cuando el servidor llegue a **${meta} miembros**.\n` +
        `> 📊 Progreso actual: **${memberCount} / ${meta} miembros** — ¡Invita a tus amigos!\n\n` +
        `**[${bar}] ${pct}%**\n\n` +
        `**📊 Ver tu ranking de invitaciones**\n\`!invitaciones\` — Ver tus puntos e invitados\n\`!invitaciones top\` — Ver el ranking completo del servidor\n\n` +
        `**🏅 Ganadores anteriores**\nLos resultados de cada sorteo se anuncian aquí mismo.`
      )
      .setFooter({ text: `DS6Music • ds6music.com • ¡Buena suerte!` })
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
async function ejecutarSorteo(guild, channel) {
  try {
    const cfg = loadConfig(guild.id);
    await guild.members.fetch();
    const invData = loadInvites(guild.id);

    // Construir pool de tickets ponderado
    const ticketPool = [];
    const members = guild.members.cache.filter(m => !m.user.bot);

    for (const [, member] of members) {
      const uid = member.id;
      const invCount = invData.invites[uid] ? invData.invites[uid].count : 0;
      const tickets = 1 + invCount;
      for (let i = 0; i < tickets; i++) ticketPool.push({ id: uid, name: member.user.username });
    }

    if (ticketPool.length < 3) {
      if (channel) await channel.send('❌ No hay suficientes participantes para el sorteo (mínimo 3).');
      return;
    }

    // Elegir 3 ganadores únicos
    const winners = [];
    const usedIds = new Set();
    const shuffled = ticketPool.sort(() => Math.random() - 0.5);

    for (const entry of shuffled) {
      if (!usedIds.has(entry.id)) {
        usedIds.add(entry.id);
        winners.push(entry);
        if (winners.length === 3) break;
      }
    }

    const prizes = [
      { place: '🥇 1er lugar', credits: '20,000', emoji: '🥇' },
      { place: '🥈 2do lugar', credits: '10,000', emoji: '🥈' },
      { place: '🥉 3er lugar', credits: '5,000', emoji: '🥉' },
    ];

    const sorteoChId = cfg.channels && cfg.channels.sorteos;
    const sorteoChannel = sorteoChId ? guild.channels.cache.get(sorteoChId) : channel;
    if (!sorteoChannel) return;

    // Anuncio dramático
    await sorteoChannel.send('🎰 **¡INICIANDO SORTEO!** Eligiendo ganadores...');
    await new Promise(r => setTimeout(r, 2000));
    await sorteoChannel.send('🎲 Mezclando tickets...');
    await new Promise(r => setTimeout(r, 2000));
    await sorteoChannel.send('🎯 ¡Seleccionando ganadores!');
    await new Promise(r => setTimeout(r, 2000));

    let desc = `**🎊 ¡SORTEO COMPLETADO!**\n\n**Total de participantes:** ${members.size}\n**Total de tickets en el pool:** ${ticketPool.length}\n\n`;
    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      const p = prizes[i];
      const invCount = invData.invites[w.id] ? invData.invites[w.id].count : 0;
      desc += `${p.emoji} **${p.place}** — <@${w.id}>\n`;
      desc += `   🎁 Premio: **${p.credits} Créditos IMVU**\n`;
      desc += `   🎟️ Tickets tenía: ${1 + invCount} (1 base + ${invCount} por invitaciones)\n\n`;
    }
    desc += `\n> 🏆 **Total del sorteo: 35,000 Créditos IMVU**\n> Los ganadores deben contactar al Staff para reclamar su premio.`;

    const embed = new EmbedBuilder()
      .setTitle('🏆 ¡GRAN SORTEO DS6Music — RESULTADOS!')
      .setDescription(desc)
      .setColor(0xFFD700)
      .setFooter({ text: `DS6Music • Sorteo oficial • ds6music.com` })
      .setTimestamp();

    await sorteoChannel.send({ embeds: [embed] });

    // Mencionar a los ganadores
    const mentions = winners.map(w => `<@${w.id}>`).join(' ');
    await sorteoChannel.send(`🎉 ¡Felicitaciones ${mentions}! Contacten al Staff para reclamar su premio.`);

    // Marcar sorteo como realizado
    cfg.sorteoActive = false;
    cfg.sorteoMeta = (cfg.sorteoMeta || 150) + 150; // Próximo hito
    saveConfig(guild.id, cfg);

    // Actualizar panel
    await updateSorteoPanel(guild);
    console.log(`[Sorteo] Completado en guild ${guild.id} — Ganadores: ${winners.map(w => w.name).join(', ')}`);
  } catch(e) { console.error('[Sorteo] Error:', e.message); }
}

// ══════════════════════════════════════════════════════
//  TOP 3 SALAS (solo servidor principal DS6Music)
// ══════════════════════════════════════════════════════
const MAIN_GUILD_ID = process.env.MAIN_GUILD_ID || ''; // Opcional: ID del servidor principal

async function updateTop3Rooms(guild) {
  try {
    const cfg = loadConfig(guild.id);
    const top3ChId = cfg.channels && cfg.channels.top3;
    if (!top3ChId) return;
    const ch = guild.channels.cache.get(top3ChId);
    if (!ch) return;

    const data = await httpGet('http://localhost:3000/api/status');
    if (!data) return;

    const subsMap = {};
    for (const sub of getAllSubscriptions()) {
      const rid = sub.roomId || sub.contractorUsername;
      if (rid) subsMap[rid] = sub;
    }

    let entries = [];
    if (Array.isArray(data)) entries = data;
    else if (data.rooms) {
      if (Array.isArray(data.rooms)) entries = data.rooms;
      else entries = Object.entries(data.rooms).map(([roomId, room]) => ({ ...room, roomId }));
    } else entries = Object.values(data);

    const roomMap = new Map();
    for (const entry of entries) {
      const listeners = entry.clientCount || entry.listeners || 0;
      const roomId = entry.roomId || '';
      const parts = roomId.split('-');
      const userId = parts.length >= 3 ? parts[1] : '';
      const botNum = parts.length >= 3 ? parts[parts.length - 1] : '';
      const sub = subsMap[roomId] || {};
      const ownerName = sub.contractorUsername || sub.owner || sub.activatedBy || '';
      const songObj = entry.currentSong || {};
      const song = songObj.title || entry.song || '';
      const artist = songObj.artist || entry.artist || '';
      const queue = entry.queueLength || entry.cola || 0;
      const status = entry.status || 'idle';
      const imvuRoomUrl = (userId && botNum) ? `https://go.imvu.com/chat/${roomId}` : '';
      const streamUrl = roomId ? `https://ds6music.com/stream/${roomId}` : '';
      if (listeners > 0 || (status === 'streaming' && queue > 0)) {
        if (!roomMap.has(roomId) || roomMap.get(roomId).listeners < listeners)
          roomMap.set(roomId, { roomId, roomName: ownerName || roomId, ownerName, listeners, song, artist, streamUrl, imvuRoomUrl, queue, status });
      }
    }

    const top3 = Array.from(roomMap.values()).sort((a, b) => b.listeners - a.listeners || b.queue - a.queue).slice(0, 3);
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

    const msgs = await ch.messages.fetch({ limit: 10 });
    for (const [, msg] of msgs) {
      if (msg.author.id === client.user.id) await msg.delete().catch(() => {});
    }

    const embed = new EmbedBuilder()
      .setTitle('🎫 Sistema de Soporte — Abre un Ticket')
      .setColor(0x9B59B6)
      .addFields(
        { name: '📋 ¿Para qué sirve?', value: '• Problemas con tu suscripción\n• Dudas sobre cómo contratar DS6Music\n• Soporte técnico con el bot\n• Consultas sobre la tienda DaddyShop\n• Cualquier otra consulta privada', inline: false },
        { name: '⚡ Tiempo de respuesta', value: 'Nuestro Staff responde **inmediatamente**.', inline: false },
        { name: '📌 Normas', value: '• Un ticket por consulta\n• Sé respetuoso con el Staff\n• Haz clic en el botón para abrir tu ticket privado', inline: false }
      )
      .setFooter({ text: 'DS6Music Support Team' });

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

  // Migrar datos del servidor principal
  migrateMainGuildData(MAIN_GUILD_ID);

  // Inicializar cada servidor
  for (const [, guild] of client.guilds.cache) {
    try {
      await guild.members.fetch();
      await refreshInviteCache(guild);
      setTimeout(() => updateSorteoPanel(guild).catch(() => {}), 5000);
      if (guild.id === MAIN_GUILD_ID) {
        setTimeout(() => setupTicketMessage(guild).catch(() => {}), 6000);
        setTimeout(() => updateTop3Rooms(guild).catch(() => {}), 8000);
      }
    } catch(e) { console.log(`[Ready] Error init guild ${guild.id}:`, e.message); }
  }

  // Intervalos globales
  setInterval(() => {
    for (const [, guild] of client.guilds.cache) {
      updateSorteoPanel(guild).catch(() => {});
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
          `Creado por 👑 **Daddy** — Senior Developer & Fundador de DS6`
        )
        .setColor(0x8B0000)
        .setFooter({ text: 'DS6 Bot v3.0 • Usa !setup para comenzar • ds6music.com' })
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
          `Creado con ❤️ por 👑 **Daddy** — Senior Developer & Fundador de DS6\n` +
          `**🔗 Web:** https://ds6music.com`
        )
        .setColor(0xF1C40F)
        .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com' });
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

    // Actualizar panel de sorteos
    await updateSorteoPanel(guild);

    // Verificar hito de miembros para sorteo automático
    await guild.members.fetch();
    const realMembers = guild.members.cache.filter(m => !m.user.bot).size;
    const meta = cfg.sorteoMeta || 150;
    if (realMembers >= meta && !cfg.sorteoActive) {
      cfg.sorteoActive = true;
      saveConfig(guildId, cfg);
      console.log(`[Sorteo] ¡Hito alcanzado! ${realMembers}/${meta} miembros en ${guild.name}`);
      const sorteoChId = cfg.channels && cfg.channels.sorteos;
      const sorteoChannel = sorteoChId ? guild.channels.cache.get(sorteoChId) : null;
      if (sorteoChannel) {
        await sorteoChannel.send(`🎉 **¡El servidor ha alcanzado ${meta} miembros!** ¡Iniciando el sorteo automáticamente!`);
        await new Promise(r => setTimeout(r, 3000));
      }
      await ejecutarSorteo(guild, sorteoChannel);
    }

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
    await updateSorteoPanel(member.guild);
  } catch(e) {}
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
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
        !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply('❌ Solo los **administradores** del servidor pueden usar `!setup`.');
    }

    await message.channel.send('⚙️ **Configurando DS6 Bot en tu servidor...**');

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

    // Fallback: si no se encontró canal de soporte, usar el canal actual
    if (!found.soporte) found.soporte = message.channel.id;
    // Fallback: si no se encontró canal general, usar el canal actual
    if (!found.chatES) found.chatES = message.channel.id;
    // Fallback: si no se encontró canal de logs, usar el canal actual
    if (!found.logs) found.logs = message.channel.id;

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
    if (cfg.channels.sorteos) await updateSorteoPanel(guild).catch(() => {});
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
        `**📋 Próximos pasos:**\n• Usa \`!comandos\` para ver todos los comandos\n• Los miembros pueden usar \`!nivel\`, \`!coins\`, \`!daily\`\n• El sorteo se activará al llegar a **${cfg.sorteoMeta} miembros** (actualmente ${currentMembers})`
      )
      .setColor(0x00E676)
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • !config para más opciones' });

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
      .setFooter({ text: 'DS6 Bot v3.0 • ds6music.com • !config para personalizar' });
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
      .setFooter({ text: 'DS6 Bot v3.0 • Gana XP chateando' });
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
      .setFooter({ text: 'DS6 Bot v3.0 • Chatea para subir en el ranking' });
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
      .setFooter({ text: 'DS6 Bot v3.0 • Gana coins chateando y con !daily' });
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
  //  COMANDO: !transferir
  // ══════════════════════════════════════════════════════
  if (command === 'transferir' || command === 'dar' || command === 'transfer') {
    const target = message.mentions.members.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount) || amount <= 0)
      return message.reply('❌ Uso: `!transferir @usuario cantidad`\nEjemplo: `!transferir @Juan 500`');
    if (target.id === message.author.id)
      return message.reply('❌ No puedes transferirte coins a ti mismo.');
    if (!spendCoinsAmount(guildId, message.author.id, amount))
      return message.reply(`❌ No tienes suficientes DS6 Coins. Usa \`!coins\` para ver tu saldo.`);

    addCoinsAmount(guildId, target.id, amount);
    const embed = new EmbedBuilder()
      .setTitle('🪙 Transferencia de DS6 Coins')
      .setDescription(`✅ **${message.author.username}** le envió **${amount.toLocaleString()} DS6 Coins** a **${target.user.username}**`)
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
            `El usuario ha solicitado un descuento de **$${discount} USD** en su próxima compra de DS6Music.`
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
      .setFooter({ text: 'DS6 Bot v3.0 • Descuento válido por 30 días' });
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
        .setFooter({ text: 'DS6 Bot v3.0 • Cada invitación = 1 ticket extra en sorteos' });
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
        .setTitle('✅ Verificado como Cliente DS6Music')
        .setDescription(
          `**@${imvuUser}** ha sido verificado como cliente de DS6Music.\n\n` +
          `${planEmoji} **Plan:** ${planDisplay}\n` +
          `🏠 **Salas activas:** ${userSubs.length}\n\n` +
          `**Roles asignados:**\n${assignedRoles.map(r => `• ${r}`).join('\n')}`
        )
        .setColor(0x00E676)
        .setFooter({ text: 'DS6 Bot v3.0 • Verificación automática' });
      return message.channel.send({ embeds: [embed] });
    } catch(e) {
      return message.reply('❌ Error al verificar. Intenta de nuevo o abre un ticket.');
    }
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !sorteo (Staff/Admin)
  // ══════════════════════════════════════════════════════
  if (command === 'sorteo') {
    const hasPermission = message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
      message.member.roles.cache.some(r => ['Owner', 'Staff', 'Moderador', 'Admin', 'Administrator'].some(n => r.name.toLowerCase().includes(n.toLowerCase())));
    if (!hasPermission) return message.reply('❌ Solo el **Staff** y el **Owner** pueden iniciar sorteos.');

    if (args[0] && args[0].toLowerCase() === 'reset') {
      const cfg = loadConfig(guildId);
      cfg.sorteoActive = false;
      saveConfig(guildId, cfg);
      return message.reply('✅ Estado del sorteo reiniciado. El próximo hito activará el sorteo automáticamente.');
    }

    const memberCount = message.guild.memberCount;
    const cfg = loadConfig(guildId);
    const MIN_MEMBERS = cfg.sorteoMeta || 150;
    if (memberCount < MIN_MEMBERS) {
      return message.reply(`⏳ El servidor necesita **${MIN_MEMBERS} miembros** para el sorteo. Actualmente: **${memberCount}**. Faltan **${MIN_MEMBERS - memberCount}** miembros.`);
    }

    await message.channel.send('🎰 **Iniciando sorteo manual...**');
    await ejecutarSorteo(message.guild, message.channel);
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !precio / !planes
  // ══════════════════════════════════════════════════════
  if (command === 'precio' || command === 'planes' || command === 'suscripcion') {
    const embed = new EmbedBuilder()
      .setTitle('🎵 Planes de Suscripción DS6Music')
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
    let soporteId = cfg.channels && cfg.channels.soporte;

    // Si no hay canal de soporte configurado, intentar encontrarlo automáticamente
    if (!soporteId) {
      const autoSoporte = message.guild.channels.cache.find(c =>
        c.type === ChannelType.GuildText &&
        (c.name.toLowerCase().includes('soporte') || c.name.toLowerCase().includes('ticket') ||
         c.name.toLowerCase().includes('support') || c.name.toLowerCase().includes('ayuda'))
      );
      if (autoSoporte) {
        soporteId = autoSoporte.id;
        if (!cfg.channels) cfg.channels = {};
        cfg.channels.soporte = soporteId;
        saveConfig(guildId, cfg);
      } else {
        // Usar el canal actual como fallback
        soporteId = message.channel.id;
        if (!cfg.channels) cfg.channels = {};
        cfg.channels.soporte = soporteId;
        saveConfig(guildId, cfg);
      }
    }

    const soporteCh = message.guild.channels.cache.get(soporteId);
    if (!soporteCh) {
      // Canal guardado no existe, usar canal actual
      soporteId = message.channel.id;
      cfg.channels.soporte = soporteId;
      saveConfig(guildId, cfg);
    }

    const ticketNum = Date.now().toString().slice(-6);
    const staffMention = cfg.ticketRoles && cfg.ticketRoles.staff ? `<@&${cfg.ticketRoles.staff}>` : '@Staff';
    const embed = new EmbedBuilder()
      .setTitle(`🎫 Ticket #${ticketNum} — ${message.guild.name}`)
      .setDescription(
        `**👤 Usuario:** <@${message.author.id}> (${message.author.tag})\n` +
        `**❓ Consulta:** ${query}\n\n` +
        `${staffMention} — Un miembro del Staff te atenderá en breve.`
      )
      .addFields(
        { name: '📅 Fecha', value: `<t:${Math.floor(Date.now()/1000)}:F>`, inline: true },
        { name: '📍 Canal origen', value: `<#${message.channel.id}>`, inline: true },
      )
      .setColor(0x9B59B6)
      .setThumbnail(message.author.displayAvatarURL({ forceStatic: false }))
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`close_ticket_${ticketNum}`).setLabel('🔒 Cerrar Ticket').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`claim_ticket_${ticketNum}`).setLabel('✋ Tomar Ticket').setStyle(ButtonStyle.Success),
    );

    const targetCh = message.guild.channels.cache.get(soporteId) || message.channel;
    await targetCh.send({ content: staffMention, embeds: [embed], components: [row] });

    if (targetCh.id !== message.channel.id) {
      await message.reply(`✅ Tu ticket **#${ticketNum}** fue creado en <#${soporteId}>. El Staff te atenderá pronto. 🎫`);
    } else {
      await message.reply(`✅ Tu ticket **#${ticketNum}** fue registrado. El Staff te atenderá pronto. 🎫\n💡 Tip: Usa \`!setcanal soporte #canal\` para configurar un canal dedicado de soporte.`);
    }
    await sendLog(message.guild, `🎫 **Ticket #${ticketNum}** creado por ${message.author.tag}: "${query}"`, 0x9B59B6);
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
    const amount = Math.min(parseInt(args[0]) || 10, 100);
    if (isNaN(amount) || amount < 1) return message.reply('❌ Uso: `!clear [1-100]`');
    try {
      await message.delete().catch(() => {});
      const deleted = await message.channel.bulkDelete(amount, true);
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
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) && !isStaff(message.member))
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
  //  CONFIG: !autoroles
  // ══════════════════════════════════════════════════════
  if (command === 'autoroles' || command === 'autorole') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles) && !isStaff(message.member))
      return message.reply('❌ Solo los administradores pueden configurar auto-roles.');

    const arCfg = loadAutoRoles(guildId);
    const sub = args[0] ? args[0].toLowerCase() : 'ver';

    if (sub === 'ver' || sub === 'list') {
      if (arCfg.roles.length === 0) return message.reply('🏷️ No hay auto-roles configurados. Usa `!autoroles add @rol` para agregar uno.');
      const list = arCfg.roles.map(id => `<@&${id}>`).join(' ');
      return message.reply(`🏷️ **Auto-roles actuales:** ${list}\n\nEstos roles se asignan automáticamente cuando alguien entra al servidor.`);
    }
    if (sub === 'add' || sub === 'agregar') {
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Uso: `!autoroles add @rol`');
      if (arCfg.roles.includes(role.id)) return message.reply('❌ Ese rol ya está en la lista de auto-roles.');
      arCfg.roles.push(role.id);
      saveAutoRoles(guildId, arCfg);
      return message.reply(`✅ Rol **${role.name}** agregado a los auto-roles.`);
    }
    if (sub === 'del' || sub === 'remove' || sub === 'quitar') {
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Uso: `!autoroles del @rol`');
      arCfg.roles = arCfg.roles.filter(id => id !== role.id);
      saveAutoRoles(guildId, arCfg);
      return message.reply(`✅ Rol **${role.name}** eliminado de los auto-roles.`);
    }
    if (sub === 'clear' || sub === 'limpiar') {
      arCfg.roles = []; saveAutoRoles(guildId, arCfg);
      return message.reply('✅ Todos los auto-roles han sido eliminados.');
    }
    return message.reply('❌ Subcomandos: `ver`, `add @rol`, `del @rol`, `clear`');
  }

  // ══════════════════════════════════════════════════════
  //  CONFIG: !antispam
  // ══════════════════════════════════════════════════════
  if (command === 'antispam') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
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
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
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
      .setFooter({ text: 'DS6 Bot v3.0 • Usa !ayuda para ver todos los comandos' })
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ══════════════════════════════════════════════════════
  //  COMANDO: !addcoins (solo Owner/Admin)
  // ══════════════════════════════════════════════════════
  if (command === 'addcoins') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
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
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
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
        { name: '🛡️ Moderación (Staff)', value: '`!kick` `!ban` `!unban`\n`!silenciar` `!desilenciar`\n`!warn` `!warnings` `!clearwarns`\n`!clear` `!lock` `!unlock`\n`!slowmode` `!nick` `!banlist`', inline: true },
        { name: '⚙️ Config (Admin)', value: '`!setup` `!config` `!bienvenida`\n`!autoroles` `!antispam`\n`!setcanal` `!setrol` `!sorteo`\n`!idioma` `!tag`', inline: true },
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
      .setFooter({ text: 'DS6 Bot v3.0 • Hecho con ❤️ por DS6Music' })
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
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild))
      return message.reply('❌ Solo los administradores pueden configurar canales.');
    const cfg = loadConfig(guildId);
    const tipo = args[0] ? args[0].toLowerCase() : null;
    const canal = message.mentions.channels.first();
    const validTypes = ['bienvenidos', 'logs', 'sorteos', 'soporte', 'anuncios', 'top3', 'general', 'chatES', 'chatEN', 'reglas'];
    if (!tipo || !validTypes.includes(tipo))
      return message.reply(`❌ Uso: \`!setcanal [tipo] #canal\`\nTipos válidos: \`${validTypes.join('`, `')}\``);
    if (!canal) return message.reply('❌ Menciona el canal con #canal');
    if (!cfg.channels) cfg.channels = {};
    cfg.channels[tipo] = canal.id;
    saveConfig(guildId, cfg);
    return message.reply(`✅ Canal de **${tipo}** configurado a <#${canal.id}>.`);
  }

  // ══════════════════════════════════════════════════════
  //  CONFIGURACIÓN: !setrol / !levelroles
  // ══════════════════════════════════════════════════════
  if (command === 'setrol' || command === 'setrole' || command === 'levelroles') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
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
  //  CONFIGURACIÓN: !sorteo (admin)
  // ══════════════════════════════════════════════════════
  if (command === 'sorteo' || command === 'giveaway') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Solo los administradores pueden gestionar sorteos.');
    const sub = args[0] ? args[0].toLowerCase() : 'info';
    if (sub === 'info' || sub === 'ver') {
      const cfg = loadConfig(guildId);
      await message.guild.members.fetch().catch(() => {});
      const memberCount = message.guild.members.cache.filter(m => !m.user.bot).size;
      const embed = new EmbedBuilder().setTitle('🎉 Estado del Sorteo')
        .addFields(
          { name: '📊 Miembros actuales', value: `**${memberCount}**`, inline: true },
          { name: '🎯 Meta', value: `**${cfg.sorteoMeta || 150}**`, inline: true },
          { name: '✅ Activo', value: cfg.sorteoActive ? 'Sí' : 'No', inline: true },
        ).setColor(0xF1C40F);
      return message.channel.send({ embeds: [embed] });
    }
    if (sub === 'meta' || sub === 'setmeta') {
      const n = parseInt(args[1]);
      if (!n || n < 10) return message.reply('❌ Uso: `!sorteo meta [número]` (mínimo 10)');
      const cfg = loadConfig(guildId);
      cfg.sorteoMeta = n;
      saveConfig(guildId, cfg);
      await updateSorteoPanel(message.guild).catch(() => {});
      return message.reply(`✅ Meta del sorteo actualizada a **${n} miembros**.`);
    }
    if (sub === 'iniciar' || sub === 'start') {
      await message.reply('🎰 **Iniciando sorteo manual...**');
      await ejecutarSorteo(message.guild, message.channel);
      return;
    }
    if (sub === 'panel' || sub === 'update') {
      await updateSorteoPanel(message.guild);
      return message.reply('✅ Panel de sorteo actualizado.');
    }
    return message.reply('❌ Subcomandos: `info`, `meta [N]`, `iniciar`, `panel`');
  }

  } catch(e) { console.error('[CMD Error]', e.message); }
});

// ══════════════════════════════════════════════════════
//  BOTONES (Tickets)
// ══════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

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
    return interaction.reply({ embeds: [embed], flags: ['Ephemeral'] }).catch(() => {});
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
  }

  if (interaction.customId === 'close_ticket') {
    await interaction.deferReply({ flags: ['Ephemeral'] });
    try {
      const ch = interaction.channel;
      if (!ch.name.startsWith('ticket-')) return interaction.editReply({ content: '❌ Este comando solo funciona dentro de un ticket.' });
      await interaction.editReply({ content: '🔒 Cerrando ticket...' });
      await ch.send('🔒 **Ticket cerrado.** El canal se eliminará en 5 segundos.');
      setTimeout(() => ch.delete().catch(() => {}), 5000);
      await sendLog(interaction.guild, `🔒 **Ticket cerrado** por ${interaction.user.tag}: #${ch.name}`, 0xFF4500);
    } catch(e) {}
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
    const embed = new EmbedBuilder().setTitle(btn.title).setDescription(btn.desc).setColor(btn.color).setFooter({ text: 'DS6 Bot v3.0 • Prefijo: ! • !comandos para volver' });
    return interaction.reply({ embeds: [embed], flags: ['Ephemeral'] });
  }
});

// ══════════════════════════════════════════════════════
//  SLASH COMMAND: /info
// ══════════════════════════════════════════════════════
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'info') {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const ping = Math.round(client.ws.ping);
    const embed = new EmbedBuilder()
      .setTitle('🤖 DS6 Bot — Información')
      .setThumbnail(client.user.displayAvatarURL({ forceStatic: false }))
      .setDescription('Bot oficial de la comunidad **DS6Music** — Economía, niveles, moderación, diversión y más.')
      .addFields(
        { name: '📛 Nombre', value: `**${client.user.tag}**`, inline: true },
        { name: '📡 Servidores', value: `**${client.guilds.cache.size}**`, inline: true },
        { name: '📦 Versión', value: '**v3.0**', inline: true },
        { name: '⏱️ Uptime', value: `**${days}d ${hours}h ${mins}m**`, inline: true },
        { name: '🏓 Ping', value: `**${ping > 0 ? ping : '< 1'}ms**`, inline: true },
        { name: '🌐 Sitio Web', value: '[ds6music.com](https://ds6music.com)', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '👑 Creado por', value: '**Daddy** — *Senior Developer & Fundador de DS6Music*\n🎵 La mente detrás de todo lo que ves aquí.', inline: false },
      )
      .setColor(0x8B0000)
      .setFooter({ text: '❤️ Desarrollado con pasión por Daddy • DS6 Bot v3.0 • ds6music.com' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
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
        { name: '🛡️ Moderación (Staff)', value: '`!kick` `!ban` `!unban`\n`!silenciar` `!desilenciar`\n`!warn` `!warnings` `!clearwarns`\n`!clear` `!lock` `!unlock`\n`!slowmode` `!nick` `!banlist`', inline: true },
        { name: '⚙️ Config (Admin)', value: '`!setup` `!config` `!bienvenida`\n`!autoroles` `!antispam`\n`!setcanal` `!setrol` `!sorteo`\n`!idioma` `!tag`', inline: true },
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
        '4️⃣ El staff puede moderar con `!kick`, `!ban`, `!warn`\n' +
        '5️⃣ Personaliza con `!bienvenida`, `!autoroles`, `!config`\n\n' +
        '**Sistema de economía:**\n' +
        '• Gana DS6 Coins chateando, con `!daily` y `!trabajo`\n' +
        '• Úsalos en sorteos y más funciones\n\n' +
        '**Sistema de niveles:**\n' +
        '• Gana XP por cada mensaje enviado\n' +
        '• Sube de nivel y desbloquea roles especiales\n\n' +
        '**Soporte:** Escríbele a **Daddy** en Discord o visita [ds6music.com](https://ds6music.com)'
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
        { name: '👑 Desarrollador', value: '**Daddy** — Senior Dev & Fundador', inline: true },
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
        '**Desarrollado por:** 👑 **Daddy** — Senior Dev & Fundador de DS6Music\n' +
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
