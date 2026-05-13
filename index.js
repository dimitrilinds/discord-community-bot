// ═══════════════════════════════════════════════════════
//  DS6Music Discord Bot — Reconstruido completo
// ═══════════════════════════════════════════════════════
const { Client, GatewayIntentBits, Events, EmbedBuilder, ActivityType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Configuración ──
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const GUILD_ID         = config.guild_id;
const LANG_CHANNEL_ID  = config.lang_channel_id;
const VERIFY_CHANNEL_ID = config.verify_channel_id;

// ── IDs de canales ──
const CHANNELS = {
  bienvenidos:    process.env.CHANNEL_BIENVENIDOS,
  reglas:         process.env.CHANNEL_REGLAS,
  comandos:       process.env.CHANNEL_COMANDOS,
  suscripciones:  process.env.CHANNEL_SUSCRIPCIONES,
  anuncios:       process.env.CHANNEL_ANUNCIOS,
  logs:           process.env.CHANNEL_LOGS,
  top3:           process.env.CHANNEL_TOP3,
  sorteos:        process.env.CHANNEL_SORTEOS,
  soporte:        process.env.CHANNEL_SOPORTE,
  verificacion:   process.env.CHANNEL_VERIFICACION,
  chatES:         process.env.CHANNEL_CHAT_ES,
  chatEN:         process.env.CHANNEL_CHAT_EN,
  chatPT:         process.env.CHANNEL_CHAT_PT,
  novedades:      process.env.CHANNEL_NOVEDADES,
  staffChat:      process.env.CHANNEL_STAFF,
  dailyRewards:   process.env.CHANNEL_DAILY,
};

// ── IDs de roles de nivel ──
const LEVEL_ROLES = {
  5:  process.env.ROLE_ACTIVO, // 🌱 Activo
  10: process.env.ROLE_REGULAR, // 🔥 Regular
  20: process.env.ROLE_VETERANO, // ⭐ Veterano
  50: process.env.ROLE_LEYENDA, // 💎 Leyenda DS6Music
};

// ══════════════════════════════════════════════════════
//  SISTEMA DE XP, NIVELES Y DS6 COINS
// ══════════════════════════════════════════════════════
const XP_FILE    = path.join(__dirname, 'xp_data.json');
const COINS_FILE = path.join(__dirname, 'coins_data.json');
const DAILY_FILE = path.join(__dirname, 'daily_data.json');

function loadXP()    { try { return JSON.parse(fs.readFileSync(XP_FILE, 'utf8')); }    catch(e) { return {}; } }
function saveXP(d)   { try { fs.writeFileSync(XP_FILE, JSON.stringify(d, null, 2)); }   catch(e) {} }
function loadCoins() { try { return JSON.parse(fs.readFileSync(COINS_FILE, 'utf8')); } catch(e) { return {}; } }
function saveCoins(d){ try { fs.writeFileSync(COINS_FILE, JSON.stringify(d, null, 2)); } catch(e) {} }
function loadDaily() { try { return JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8')); } catch(e) { return {}; } }
function saveDaily(d){ try { fs.writeFileSync(DAILY_FILE, JSON.stringify(d, null, 2)); } catch(e) {} }

// Calcular nivel a partir de XP total
function getLevel(xp) {
  // Cada nivel requiere 100 * nivel XP: nivel 1=100, 2=200, 3=300...
  let level = 0;
  let totalRequired = 0;
  while (true) {
    level++;
    totalRequired += level * 100;
    if (xp < totalRequired) return level - 1 || 1;
    if (level >= 100) return 100;
  }
}

// XP necesario para el siguiente nivel
function xpForNextLevel(currentLevel) {
  return (currentLevel + 1) * 100;
}

// XP acumulado hasta el nivel actual
function xpAccumulated(level) {
  let total = 0;
  for (let i = 1; i <= level; i++) total += i * 100;
  return total;
}

// Cooldown de XP por mensaje (1 XP cada 60 segundos por usuario)
const xpCooldown = new Map();

async function addXP(member, amount) {
  const xpData = loadXP();
  const userId = member.id;
  if (!xpData[userId]) xpData[userId] = { xp: 0, level: 1 };
  
  const oldLevel = getLevel(xpData[userId].xp);
  xpData[userId].xp += amount;
  const newLevel = getLevel(xpData[userId].xp);
  xpData[userId].level = newLevel;
  saveXP(xpData);

  // Si subió de nivel, asignar rol y notificar
  if (newLevel > oldLevel) {
    await assignLevelRole(member, newLevel);
    // Bonus de coins al subir de nivel
    const bonus = newLevel * 25;
    addCoins(userId, bonus);
    return { levelUp: true, newLevel, bonus };
  }
  return { levelUp: false };
}

async function assignLevelRole(member, level) {
  try {
    const guild = member.guild;
    // Quitar roles de nivel anteriores
    for (const [, roleId] of Object.entries(LEVEL_ROLES)) {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId).catch(() => {});
      }
    }
    // Asignar el rol más alto que corresponda
    const thresholds = [50, 20, 10, 5];
    for (const threshold of thresholds) {
      if (level >= threshold) {
        const roleId = LEVEL_ROLES[threshold];
        const role = guild.roles.cache.get(roleId);
        if (role) await member.roles.add(role).catch(() => {});
        break;
      }
    }
  } catch(e) {}
}

function addCoins(userId, amount) {
  const coins = loadCoins();
  if (!coins[userId]) coins[userId] = 0;
  coins[userId] += amount;
  saveCoins(coins);
  return coins[userId];
}

function getCoins(userId) {
  const coins = loadCoins();
  return coins[userId] || 0;
}

function spendCoins(userId, amount) {
  const coins = loadCoins();
  if (!coins[userId] || coins[userId] < amount) return false;
  coins[userId] -= amount;
  saveCoins(coins);
  return true;
}

// ── IDs de roles ──
const ROLE_IDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'role_ids.json'), 'utf8'));

// ── Sistema de invitaciones ──
const INVITES_FILE = path.join(__dirname, 'invites.json');
function loadInvites() {
  try { return JSON.parse(fs.readFileSync(INVITES_FILE, 'utf8')); } catch(e) { return { invites: {}, invited_by: {} }; }
}
function saveInvites(data) {
  try { fs.writeFileSync(INVITES_FILE, JSON.stringify(data, null, 2)); } catch(e) {}
}
let inviteCache = new Map();
async function refreshInviteCache(guild) {
  const invites = await guild.invites.fetch();
  inviteCache = new Map(invites.map(inv => [inv.code, inv.uses || 0]));
  return inviteCache;
}

// ── Sistema de Idiomas (ES/EN/PT) ──
const TRANSLATIONS = {
  'es': {
    ayuda_title: '🎵 Comandos DS6Music',
    ayuda_desc: 'Lista de comandos disponibles en el servidor.',
    ayuda_music: '🎵 Música',
    ayuda_music_val: '`!play [canción]` `!skip` `!stop` `!queue` `!np`',
    ayuda_verify: '✅ Verificación',
    ayuda_verify_val: '`!verificar [usuario IMVU]` — Verifica tu suscripción',
    ayuda_invites: '🎉 Sorteos',
    ayuda_invites_val: '`!invitaciones` — Ver tus puntos\n`!invitaciones top` — Ranking',
    ayuda_support: '🎫 Soporte',
    ayuda_support_val: '`!ticket [consulta]` — Abrir ticket de soporte',
    
    precio_title: '🎵 Planes de Suscripción DS6Music',
    precio_desc: 'Elige el plan que mejor se adapte a ti:',
    precio_platino: '🪙 Platino',
    precio_platino_val: '$13/mes — 1 Sala, Música 24/7',
    precio_diamante: '💎 Diamante',
    precio_diamante_val: '$33/3 meses — 1 Sala, Comandos VIP, Dedicatorias',
    precio_esmeralda: '💚 Esmeralda',
    precio_esmeralda_val: '$90/9 meses — 3 Salas, Memoria de Playlists',
    precio_supreme: '👑 Supreme',
    precio_supreme_val: '$200/20 meses — 5 Salas, Máxima Prioridad',
    precio_more_info: '🔗 Más información y compra:',
    
    verify_usage: '❌ Uso: `!verificar TuUsuarioIMVU`',
    verify_search: '🔍 Buscando suscripción para **{user}**...',
    verify_found: '✅ **¡Suscripción encontrada!**',
    verify_not_found: '❌ **No se encontró suscripción activa** para `{user}`.\nSi compraste recientemente, espera unos minutos o abre un `!ticket`.',
    verify_plan: 'Plan:',
    verify_room: 'Sala ID:',
    verify_expires: 'Expira:',
    verify_role_assigned: '\n✅ Se te ha asignado el rol **{role}** y **🛍️ Cliente**.\n¡Gracias por preferir DS6Music!',
    
    invites_top_title: '🏆 Ranking de Invitaciones DS6Music',
    invites_top_desc: 'Los miembros con más invitaciones tienen **más probabilidad de ganar** en los sorteos.\n\n',
    invites_top_empty: '📊 Aún no hay invitaciones registradas.',
    invites_top_footer: 'DS6Music • Cada invitación = 1 punto extra en sorteos',
    invites_inv: 'invitación',
    invites_invs: 'invitaciones',
    invites_pt: 'punto',
    invites_pts: 'puntos',
    
    invites_user_title: '📨 Invitaciones de {user}',
    invites_user_desc: 'Has invitado a **{count} miembro(s)** al servidor.\n\n🎟️ **Tickets en sorteos:** {total} (1 base + {bonus} por invitaciones)\n📈 **Más invitaciones = más probabilidad de ganar**',
    invites_user_recent: '\n\n**Últimos invitados:**\n',
    invites_user_how: '💡 ¿Cómo sumar más puntos?',
    invites_user_how_val: 'Invita amigos con tu link personal de Discord.\nCada miembro que se una usando tu link = **+1 ticket** en el próximo sorteo.',
    
    ticket_no_channel: '❌ Canal de soporte no encontrado.',
    ticket_created: '✅ Tu ticket **#{num}** fue creado. Ve a <#{id}>',
    ticket_thread_name: '🎫 Ticket #{num} — {user}',
    ticket_embed_title: '🎫 Ticket #{num} — Soporte DS6Music',
    ticket_embed_desc: '**Usuario:** <@{id}>\n**Consulta:** {query}\n\nUn miembro del Staff te atenderá en breve.\nUsa `!cerrar` para cerrar este ticket cuando se resuelva.',
    
    close_success: '🔒 Ticket cerrado. ¡Gracias por contactar al Staff de DS6Music!',
    close_error: '❌ Este comando solo funciona dentro de un ticket.'
  },
  'en': {
    ayuda_title: '🎵 DS6Music Commands',
    ayuda_desc: 'List of available commands on the server.',
    ayuda_music: '🎵 Music',
    ayuda_music_val: '`!play [song]` `!skip` `!stop` `!queue` `!np`',
    ayuda_verify: '✅ Verification',
    ayuda_verify_val: '`!verificar [IMVU username]` — Verify your subscription',
    ayuda_invites: '🎉 Giveaways',
    ayuda_invites_val: '`!invitaciones` — View your points\n`!invitaciones top` — Leaderboard',
    ayuda_support: '🎫 Support',
    ayuda_support_val: '`!ticket [query]` — Open a support ticket',
    
    precio_title: '🎵 DS6Music Subscription Plans',
    precio_desc: 'Choose the plan that best fits you:',
    precio_platino: '🪙 Platinum',
    precio_platino_val: '$13/month — 1 Room, 24/7 Music',
    precio_diamante: '💎 Diamond',
    precio_diamante_val: '$33/3 months — 1 Room, VIP Commands, Dedications',
    precio_esmeralda: '💚 Emerald',
    precio_esmeralda_val: '$90/9 months — 3 Rooms, Playlist Memory',
    precio_supreme: '👑 Supreme',
    precio_supreme_val: '$200/20 months — 5 Rooms, Maximum Priority',
    precio_more_info: '🔗 More info and purchase:',
    
    verify_usage: '❌ Usage: `!verificar YourIMVUUsername`',
    verify_search: '🔍 Searching subscription for **{user}**...',
    verify_found: '✅ **Subscription found!**',
    verify_not_found: '❌ **No active subscription found** for `{user}`.\nIf you purchased recently, wait a few minutes or open a `!ticket`.',
    verify_plan: 'Plan:',
    verify_room: 'Room ID:',
    verify_expires: 'Expires:',
    verify_role_assigned: '\n✅ You have been assigned the **{role}** and **🛍️ Cliente** roles.\nThank you for choosing DS6Music!',
    
    invites_top_title: '🏆 DS6Music Invites Leaderboard',
    invites_top_desc: 'Members with more invites have a **higher chance to win** in giveaways.\n\n',
    invites_top_empty: '📊 No invites registered yet.',
    invites_top_footer: 'DS6Music • Each invite = 1 extra point in giveaways',
    invites_inv: 'invite',
    invites_invs: 'invites',
    invites_pt: 'point',
    invites_pts: 'points',
    
    invites_user_title: '📨 Invites from {user}',
    invites_user_desc: 'You have invited **{count} member(s)** to the server.\n\n🎟️ **Giveaway tickets:** {total} (1 base + {bonus} from invites)\n📈 **More invites = higher chance to win**',
    invites_user_recent: '\n\n**Recent invites:**\n',
    invites_user_how: '💡 How to get more points?',
    invites_user_how_val: 'Invite friends using your personal Discord link.\nEach member that joins using your link = **+1 ticket** in the next giveaway.',
    
    ticket_no_channel: '❌ Support channel not found.',
    ticket_created: '✅ Your ticket **#{num}** was created. Go to <#{id}>',
    ticket_thread_name: '🎫 Ticket #{num} — {user}',
    ticket_embed_title: '🎫 Ticket #{num} — DS6Music Support',
    ticket_embed_desc: '**User:** <@{id}>\n**Query:** {query}\n\nA Staff member will assist you shortly.\nUse `!cerrar` to close this ticket when resolved.',
    
    close_success: '🔒 Ticket closed. Thank you for contacting DS6Music Staff!',
    close_error: '❌ This command only works inside a ticket.'
  },
  'pt': {
    ayuda_title: '🎵 Comandos DS6Music',
    ayuda_desc: 'Lista de comandos disponíveis no servidor.',
    ayuda_music: '🎵 Música',
    ayuda_music_val: '`!play [música]` `!skip` `!stop` `!queue` `!np`',
    ayuda_verify: '✅ Verificação',
    ayuda_verify_val: '`!verificar [usuário IMVU]` — Verifique sua assinatura',
    ayuda_invites: '🎉 Sorteios',
    ayuda_invites_val: '`!invitaciones` — Ver seus pontos\n`!invitaciones top` — Ranking',
    ayuda_support: '🎫 Suporte',
    ayuda_support_val: '`!ticket [dúvida]` — Abrir ticket de suporte',
    
    precio_title: '🎵 Planos de Assinatura DS6Music',
    precio_desc: 'Escolha o plano que melhor se adapta a você:',
    precio_platino: '🪙 Platino',
    precio_platino_val: '$13/mês — 1 Sala, Música 24/7',
    precio_diamante: '💎 Diamante',
    precio_diamante_val: '$33/3 meses — 1 Sala, Comandos VIP, Dedicatórias',
    precio_esmeralda: '💚 Esmeralda',
    precio_esmeralda_val: '$90/9 meses — 3 Salas, Memória de Playlists',
    precio_supreme: '👑 Supreme',
    precio_supreme_val: '$200/20 meses — 5 Salas, Prioridade Máxima',
    precio_more_info: '🔗 Mais informações e compra:',
    
    verify_usage: '❌ Uso: `!verificar SeuUsuarioIMVU`',
    verify_search: '🔍 Buscando assinatura para **{user}**...',
    verify_found: '✅ **Assinatura encontrada!**',
    verify_not_found: '❌ **Nenhuma assinatura ativa encontrada** para `{user}`.\nSe você comprou recentemente, aguarde alguns minutos ou abra um `!ticket`.',
    verify_plan: 'Plano:',
    verify_room: 'Sala ID:',
    verify_expires: 'Expira:',
    verify_role_assigned: '\n✅ Você recebeu o cargo **{role}** e **🛍️ Cliente**.\nObrigado por escolher DS6Music!',
    
    invites_top_title: '🏆 Ranking de Convites DS6Music',
    invites_top_desc: 'Membros com mais convites têm **maior probabilidade de ganhar** nos sorteios.\n\n',
    invites_top_empty: '📊 Ainda não há convites registrados.',
    invites_top_footer: 'DS6Music • Cada convite = 1 ponto extra em sorteios',
    invites_inv: 'convite',
    invites_invs: 'convites',
    invites_pt: 'ponto',
    invites_pts: 'pontos',
    
    invites_user_title: '📨 Convites de {user}',
    invites_user_desc: 'Você convidou **{count} membro(s)** para o servidor.\n\n🎟️ **Tickets em sorteos:** {total} (1 base + {bonus} por convites)\n📈 **Mais convites = maior probabilidade de ganhar**',
    invites_user_recent: '\n\n**Últimos convidados:**\n',
    invites_user_how: '💡 Como ganhar mais pontos?',
    invites_user_how_val: 'Convide amigos usando seu link pessoal do Discord.\nCada membro que entrar usando seu link = **+1 ticket** no próximo sorteio.',
    
    ticket_no_channel: '❌ Canal de suporte não encontrado.',
    ticket_created: '✅ Seu ticket **#{num}** foi criado. Vá para <#{id}>',
    ticket_thread_name: '🎫 Ticket #{num} — {user}',
    ticket_embed_title: '🎫 Ticket #{num} — Suporte DS6Music',
    ticket_embed_desc: '**Usuário:** <@{id}>\n**Dúvida:** {query}\n\nUm membro da Staff atenderá você em breve.\nUse `!cerrar` para fechar este ticket quando resolvido.',
    
    close_success: '🔒 Ticket fechado. Obrigado por contatar a Staff DS6Music!',
    close_error: '❌ Este comando só funciona dentro de um ticket.'
  }
};

// Función para obtener idioma del usuario
function getUserLang(member) {
  if (!member) return 'es';
  // 1. Detectar por rol
  if (member.roles && member.roles.cache) {
    if (member.roles.cache.some(r => r.name === '🇺🇸 English')) return 'en';
    if (member.roles.cache.some(r => r.name === '🇧🇷 Português')) return 'pt';
    if (member.roles.cache.some(r => r.name === '🇪🇸 Español')) return 'es';
  }
  // 2. Detectar por locale de Discord (si existe en message.author)
  if (member.user && member.user.locale) {
    const loc = member.user.locale.toLowerCase();
    if (loc.startsWith('en')) return 'en';
    if (loc.startsWith('pt')) return 'pt';
    if (loc.startsWith('es')) return 'es';
  }
  return 'es'; // Por defecto español
}

// Función de traducción
function t(lang, key, params = {}) {
  let text = TRANSLATIONS[lang][key] || TRANSLATIONS['es'][key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`{${k}}`, 'g'), v);
  }
  return text;
}


// ── Cliente Discord ──
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
  ]
});

// ── Helper HTTP ──
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

// ── Obtener suscripciones de TODOS los bots (lee archivos JSON directamente) ──
const BOT_SUB_FILES = [
  '/root/imvu-bot/data/subscriptions.json',   // Bot 1
  '/root/imvu-bot2/data/subscriptions.json',  // Bot 2
  '/root/imvu-bot3/data/subscriptions.json',  // Bot 3
  '/root/imvu-bot4/data/subscriptions.json',  // Bot 4
];
function getAllSubscriptions() {
  const allSubs = [];
  const seen = new Set();
  for (const filePath of BOT_SUB_FILES) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      let subs = [];
      // Formato 1: { subscriptions: { roomId: {...} } }
      if (data.subscriptions && typeof data.subscriptions === 'object' && !Array.isArray(data.subscriptions)) {
        subs = Object.values(data.subscriptions);
      }
      // Formato 2: { subscriptions: [{...}] }
      if (data.subscriptions && Array.isArray(data.subscriptions)) {
        subs = data.subscriptions;
      }
      // Formato 3: Bot3 — claves directas room-xxx-yyy en el objeto raíz
      for (const [key, val] of Object.entries(data)) {
        if (key.startsWith('room-') && typeof val === 'object' && val.roomId) {
          subs.push(val);
        }
      }
      for (const s of subs) {
        if (!s || typeof s !== 'object') continue;
        const key = s.roomId || `${s.contractorUsername}-${filePath}`;
        if (!seen.has(key)) { seen.add(key); allSubs.push(s); }
      }
    } catch(e) {}
  }
  return allSubs;
}

// ── Enviar log ──
async function sendLog(guild, text, color = 0x7289da) {
  try {
    const ch = guild.channels.cache.get(CHANNELS.logs);
    if (ch) await ch.send({ embeds: [{ description: text, color }] });
  } catch(e) {}
}

// ── Actualizar stats ──
async function updateStats() {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    await guild.members.fetch();
    const total = guild.memberCount;
    const bots = guild.members.cache.filter(m => m.user.bot).size;
    // Actualizar canales de voz con stats
    const statsChannels = guild.channels.cache.filter(c => c.type === 2 && (
      c.name.startsWith('👥') || c.name.startsWith('🤖')
    ));
    for (const [, ch] of statsChannels) {
      if (ch.name.startsWith('👥')) {
        await ch.setName(`👥 Miembros: ${total}`).catch(() => {});
      } else if (ch.name.startsWith('🤖')) {
        await ch.setName(`🤖 Bots DS6Music: 4`).catch(() => {});
      }
    }
    console.log(`📊 Stats actualizadas — ${total} miembros`);
  } catch(err) {
    console.error('Error actualizando stats:', err.message);
  }
}

// ── Top 3 Salas ──
async function updateTop3Rooms() {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    const ch = guild.channels.cache.get(CHANNELS.top3);
    if (!ch) return;

    // Obtener status y suscripciones para cruzar datos
    const data = await httpGet('http://localhost:3000/api/status');
    if (!data) return;
    const subsMap = {};
    const allSubsForStats = getAllSubscriptions();
    for (const sub of allSubsForStats) {
      const rid = sub.roomId || sub.contractorUsername;
      if (rid) subsMap[rid] = sub;
    }

    // Obtener todas las entradas con oyentes
    let entries = [];
    if (Array.isArray(data)) {
      entries = data;
    } else if (data.rooms) {
      if (Array.isArray(data.rooms)) {
        entries = data.rooms;
      } else if (typeof data.rooms === 'object') {
        entries = Object.entries(data.rooms).map(([roomId, room]) => ({ ...room, roomId }));
      }
    } else if (typeof data === 'object') {
      entries = Object.values(data);
    }

    // Deduplicar por roomId (quedarse con el de más oyentes)
    const roomMap = new Map();
    for (const entry of entries) {
      const listeners = entry.clientCount || entry.listeners || entry.oyentes || entry.users || 0;
      const roomId = entry.roomId || '';

      // Extraer userId y botNum del roomId (formato: room-{userId}-{botNum})
      const roomIdParts = roomId.split('-');
      const userId = roomIdParts.length >= 3 ? roomIdParts[1] : '';
      const botNum = roomIdParts.length >= 3 ? roomIdParts[roomIdParts.length - 1] : (entry.bot || entry.botId || '');

      // Obtener nombre del dueño de la sala desde suscripciones
      const sub = subsMap[roomId] || {};
      const ownerName = sub.contractorUsername || sub.owner || sub.activatedBy || '';
      const songObj = entry.currentSong || {};
      const requestedBy = songObj.requestedBy || ownerName || '';
      const roomName = entry.roomName || entry.room || entry.name || entry.sala || requestedBy || 'Sala desconocida';

      const song = songObj.title || entry.song || entry.titulo || '';
      const artist = songObj.artist || entry.artist || '';
      const queue = entry.queueLength || entry.cola || 0;
      const status = entry.status || 'idle';

      // Construir links dinámicamente desde el roomId
      // Link de la sala IMVU: https://go.imvu.com/chat/room-{userId}-{botNum}
      // Este es el formato correcto que usa el panel web para entrar directamente a la sala
      const imvuRoomUrl = (userId && botNum) ? `https://go.imvu.com/chat/${roomId}` : (userId ? `https://go.imvu.com/chat/room-${userId}-1` : '');
      // Link de escucha en vivo: https://ds6music.com/stream/{roomId}
      const streamUrl = roomId ? `https://ds6music.com/stream/${roomId}` : '';

      if (listeners > 0 || (status === 'streaming' && queue > 0)) {
        if (!roomMap.has(roomId) || (roomMap.get(roomId).listeners < listeners)) {
          roomMap.set(roomId, { roomId, roomName, ownerName, listeners, song, artist, streamUrl, imvuRoomUrl, botNum, queue, status });
        }
      }
    }

    const top3 = Array.from(roomMap.values())
      .sort((a, b) => {
        // Primero por oyentes, luego por cola como desempate
        if (b.listeners !== a.listeners) return b.listeners - a.listeners;
        return b.queue - a.queue;
      })
      .slice(0, 3);

    if (top3.length === 0) {
      // Si no hay salas activas, mostrar mensaje de espera
      const embed = new EmbedBuilder()
        .setTitle('🏆 Top 3 Salas Más Activas — DS6Music')
        .setDescription('No hay salas activas en este momento.\n\n🔄 **Actualizado automáticamente cada 10 minutos**\n\n💡 ¿Quieres aparecer aquí? ¡Contrata DS6Music en [ds6music.com/suscripcion](https://ds6music.com/suscripcion)!')
        .setColor(0xF1C40F)
        .setFooter({ text: `DS6Music • Última actualización: ${new Date().toLocaleString('es-ES')} • ds6music.com` })
        .setTimestamp();
      const msgs = await ch.messages.fetch({ limit: 5 });
      const botMsg = msgs.find(m => m.author.bot && m.embeds.length > 0);
      if (botMsg) await botMsg.edit({ embeds: [embed] });
      else await ch.send({ embeds: [embed] });
      return;
    }

    const medalColors = ['🥇', '🥈', '🥉'];
    let desc = '';
    top3.forEach((room, i) => {
      const displayName = room.ownerName || room.roomName;
      desc += `${medalColors[i]} **Sala de ${displayName}** — ${room.listeners} 👤 oyentes\n`;
      if (room.song) {
        const songDisplay = room.artist ? `${room.song.slice(0, 50)} — ${room.artist.slice(0, 25)}` : room.song.slice(0, 70);
        desc += `🎵 *${songDisplay}${songDisplay.length >= 70 ? '...' : ''}*\n`;
      }
      if (room.queue > 0) desc += `📋 Cola: ${room.queue} canción${room.queue !== 1 ? 'es' : ''}\n`;
      // Links siempre presentes si tenemos el roomId
      const links = [];
      if (room.streamUrl) links.push(`[🔊 Escuchar en vivo](${room.streamUrl})`);
      if (room.imvuRoomUrl) links.push(`[🏠 Ir a la sala](${room.imvuRoomUrl})`);
      if (links.length > 0) desc += links.join(' · ') + '\n';
      desc += '\n';
    });

    const embed = new EmbedBuilder()
      .setTitle('🏆 Top 3 Salas Más Activas — DS6Music')
      .setDescription(
        'Las salas con más oyentes en este momento, conectadas en tiempo real al panel de DS6Music.\n' +
        '🔄 **Actualizado automáticamente cada 10 minutos**\n\n' + desc +
        '> 💡 ¿Quieres aparecer aquí? Contrata DS6Music en [ds6music.com/suscripcion](https://ds6music.com/suscripcion)'
      )
      .setColor(0xF1C40F)
      .setFooter({ text: `DS6Music • Última actualización: ${new Date().toLocaleString('es-ES')} • ds6music.com` })
      .setTimestamp();

    // Buscar mensaje anterior del bot y editarlo, o enviar uno nuevo
    const msgs = await ch.messages.fetch({ limit: 5 });
    const botMsg = msgs.find(m => m.author.bot && m.embeds.length > 0);
    if (botMsg) {
      await botMsg.edit({ embeds: [embed] });
    } else {
      await ch.send({ embeds: [embed] });
    }
    console.log(`🏆 Top 3 actualizado — ${top3.length} salas activas`);
  } catch(err) {
    console.error('Error en Top 3:', err.message);
  }
}

// ══════════════════════════════════════════════════════
//  EVENTOS DE INVITACIONES
// ══════════════════════════════════════════════════════
client.on(Events.InviteCreate, async (invite) => {
  inviteCache.set(invite.code, invite.uses || 0);
});

client.on(Events.InviteDelete, async (invite) => {
  inviteCache.delete(invite.code);
});

// ══════════════════════════════════════════════════════
//  EVENTO: NUEVO MIEMBRO
// ══════════════════════════════════════════════════════
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const guild = member.guild;

    // Asignar rol Miembro automáticamente
    const memberRole = guild.roles.cache.find(r => r.name === '🎮 Miembro');
    if (memberRole) {
      await member.roles.add(memberRole);
      console.log(`✅ Rol 🎮 Miembro asignado a ${member.user.username}`);
    }

    // Tracking de invitaciones
    try {
      const newInvites = await guild.invites.fetch();
      let usedInvite = null;
      for (const [code, invite] of newInvites) {
        const cachedUses = inviteCache.get(code) || 0;
        if (invite.uses > cachedUses) { usedInvite = invite; break; }
      }
      inviteCache = new Map(newInvites.map(inv => [inv.code, inv.uses]));
      if (usedInvite && usedInvite.inviter) {
        const inviterId = usedInvite.inviter.id;
        const inviterName = usedInvite.inviter.username;
        const data = loadInvites();
        if (!data.invites[inviterId]) data.invites[inviterId] = { name: inviterName, count: 0, members: [] };
        data.invites[inviterId].count++;
        data.invites[inviterId].name = inviterName;
        data.invites[inviterId].members.push({ id: member.user.id, name: member.user.username, date: new Date().toISOString() });
        data.invited_by[member.user.id] = { inviterId, inviterName };
        saveInvites(data);
        console.log(`[Invites] ${inviterName} invitó a ${member.user.username} (+1 punto)`);
      }
    } catch(invErr) { console.log('[Invites] Error tracking:', invErr.message); }

    // ── Detectar idioma del usuario por su locale de Discord ──
    // Detectar idioma real del usuario haciendo fetch completo del objeto User
    // El campo 'locale' solo está disponible en el objeto User completo (no en GuildMember)
    let wLang = 'es'; // Por defecto español
    try {
      const fullUser = await client.users.fetch(member.user.id, { force: true });
      const locale = (fullUser.locale || member.user.locale || '').toLowerCase();
      if (locale.startsWith('en')) wLang = 'en';
      else if (locale.startsWith('pt')) wLang = 'pt';
      else if (locale.startsWith('es')) wLang = 'es';
      else if (locale.startsWith('fr') || locale.startsWith('de') || locale.startsWith('it')) wLang = 'en'; // Otros idiomas → inglés
      else if (locale) wLang = 'en'; // Cualquier otro idioma desconocido → inglés
      if (locale) console.log(`[Welcome] ${member.user.username} locale: ${locale} → ${wLang}`);
    } catch(e) {
      console.log(`[Welcome] No se pudo obtener locale de ${member.user.username}: ${e.message}`);
    }

    // Textos de bienvenida en 3 idiomas
    const welcomeTexts = {
      es: {
        title: `🎵 ¡Bienvenido/a a DS6Music, ${member.user.username}!`,
        greeting: `Hola <@${member.id}>, ¡nos alegra tenerte aquí! 🎉`,
        about: `🎵 Somos el servidor oficial del **bot de música DS6Music** para IMVU\n🛍️ Y de la tienda **DaddyShop** con +425 productos en IMVU`,
        start: '**📌 Para empezar:**',
        chat: '**💬 Preséntate en:**',
        verify: '✅ **¿Eres cliente de DS6Music?**',
        verifyCmd: (id) => `Verifica tu rol en <#${id}> con \`!verificar TuUsuarioIMVU\``,
        footer: `DS6Music • Miembro #${guild.memberCount} • ds6music.com`,
        closing: null,
        rules: (id) => `📋 Lee las reglas en <#${id}>`,
        lang: (id) => `🌍 Elige tu idioma en <#${id}>`,
        commands: (id) => `🎵 Usa el bot en <#${id}>`,
        subs: (id) => `🛍️ Ve las suscripciones en <#${id}>`
      },
      en: {
        title: `🎵 Welcome to DS6Music, ${member.user.username}!`,
        greeting: `Hey <@${member.id}>, glad to have you here! 🎉`,
        about: `🎵 We are the official server of the **DS6Music music bot** for IMVU\n🛍️ And of the **DaddyShop** store with +425 products on IMVU`,
        start: '**📌 Getting started:**',
        chat: '**💬 Introduce yourself in:**',
        verify: '✅ **Are you a DS6Music client?**',
        verifyCmd: (id) => `Verify your role in <#${id}> with \`!verificar YourIMVUUsername\``,
        footer: `DS6Music • Member #${guild.memberCount} • ds6music.com`,
        closing: null,
        rules: (id) => `📋 Read the rules in <#${id}>`,
        lang: (id) => `🌍 Choose your language in <#${id}>`,
        commands: (id) => `🎵 Use the bot in <#${id}>`,
        subs: (id) => `🛍️ View subscriptions in <#${id}>`
      },
      pt: {
        title: `🎵 Bem-vindo(a) ao DS6Music, ${member.user.username}!`,
        greeting: `Olá <@${member.id}>, que bom ter você aqui! 🎉`,
        about: `🎵 Somos o servidor oficial do **bot de música DS6Music** para IMVU\n🛍️ E da loja **DaddyShop** com +425 produtos no IMVU`,
        start: '**📌 Para começar:**',
        chat: '**💬 Apresente-se em:**',
        verify: '✅ **Você é cliente DS6Music?**',
        verifyCmd: (id) => `Verifique seu cargo em <#${id}> com \`!verificar SeuUsuarioIMVU\``,
        footer: `DS6Music • Membro #${guild.memberCount} • ds6music.com`,
        closing: null,
        rules: (id) => `📋 Leia as regras em <#${id}>`,
        lang: (id) => `🌍 Escolha seu idioma em <#${id}>`,
        commands: (id) => `🎵 Use o bot em <#${id}>`,
        subs: (id) => `🛍️ Veja as assinaturas em <#${id}>`
      }
    };
    const wt = welcomeTexts[wLang] || welcomeTexts['es'];

    // Enviar mensaje de bienvenida en el idioma detectado
    const welcomeChannel = guild.channels.cache.get(CHANNELS.bienvenidos);
    if (welcomeChannel) {
      const rulesChannel = guild.channels.cache.get(CHANNELS.reglas);
      const comandosChannel = guild.channels.cache.get(CHANNELS.comandos);
      const suscripcionesChannel = guild.channels.cache.get(CHANNELS.suscripciones);
      const langChannel = guild.channels.cache.get(LANG_CHANNEL_ID);
      const verifyChannel = guild.channels.cache.get(CHANNELS.verificacion);
      const chatESChannel = guild.channels.cache.get(CHANNELS.chatES);
      const chatENChannel = guild.channels.cache.get(CHANNELS.chatEN);
      const chatPTChannel = guild.channels.cache.get(CHANNELS.chatPT);

      const descParts = [
        wt.greeting,
        '',
        wt.about,
        '',
        wt.start,
        rulesChannel ? wt.rules(rulesChannel.id) : null,
        langChannel ? wt.lang(langChannel.id) : null,
        comandosChannel ? wt.commands(comandosChannel.id) : null,
        suscripcionesChannel ? wt.subs(suscripcionesChannel.id) : null,
        '',
        wt.chat,
        chatESChannel ? `🇪🇸 <#${chatESChannel.id}>` : null,
        chatENChannel ? `🇬🇧 <#${chatENChannel.id}>` : null,
        chatPTChannel ? `🇧🇷 <#${chatPTChannel.id}>` : null,
        '',
        wt.verify,
        verifyChannel ? wt.verifyCmd(verifyChannel.id) : null
      ].filter(l => l !== null).join('\n');

      const embed = new EmbedBuilder()
        .setTitle(wt.title)
        .setDescription(descParts)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setColor(0x8B0000)
        .setFooter({ text: wt.footer })
        .setTimestamp();
      await welcomeChannel.send({ content: `<@${member.id}>`, embeds: [embed] });
    }

    await sendLog(guild, `👋 **Nuevo miembro:** ${member.user.tag} (${member.id}) se unió. Total: ${guild.memberCount}`, 0x2ECC71);
    await updateStats();

    // ── Hito de 150 miembros: anunciar sorteo de 20k créditos ──
    const MILESTONE_FILE = require('path').join(__dirname, 'milestone_150.json');
    const milestoneReached = (() => { try { return JSON.parse(require('fs').readFileSync(MILESTONE_FILE, 'utf8')).reached; } catch(e) { return false; } })();
    if (!milestoneReached && guild.memberCount >= 150) {
      try {
        require('fs').writeFileSync(MILESTONE_FILE, JSON.stringify({ reached: true, date: new Date().toISOString(), memberCount: guild.memberCount }));
        const anunciosCh = guild.channels.cache.get(CHANNELS.anuncios);
        const sorteosCh  = guild.channels.cache.get(CHANNELS.sorteos);
        if (anunciosCh) {
          const milestoneEmbed = new EmbedBuilder()
            .setTitle('🎉 ¡150 Miembros en DS6Music!')
            .setDescription(
              `🙏 **¡Lo logramos! ¡Somos 150 miembros!** 🎉\n\n` +
              `Gracias a toda la comunidad por hacer crecer este servidor. Como prometimos, ¡llega el **Gran Sorteo de 20,000 créditos IMVU**!\n\n` +
              `🎰 **Premio:** 20,000 créditos IMVU\n` +
              `📍 **Dónde participar:** ${sorteosCh ? `<#${sorteosCh.id}>` : '#sorteos'}\n\n` +
              `**¿Cómo participar?**\n` +
              `1️⃣ Ve al canal ${sorteosCh ? `<#${sorteosCh.id}>` : '#sorteos'}\n` +
              `2️⃣ Reacciona con 🎉 al mensaje del sorteo\n` +
              `3️⃣ ¡Espera el resultado!\n\n` +
              `> *El sorteo se realizará en las próximas 24 horas. ¡Buena suerte a todos!*`
            )
            .setColor(0xF1C40F)
            .setImage('https://ds6music.com/images/logo.png')
            .setFooter({ text: 'DS6Music • ds6music.com • Gracias por ser parte de la comunidad' });
          await anunciosCh.send({ content: '@everyone', embeds: [milestoneEmbed] });
        }
        if (sorteosCh) {
          const sorteoEmbed = new EmbedBuilder()
            .setTitle('🎉 SORTEO ESPECIAL — 20,000 CRÉDITOS IMVU')
            .setDescription(
              `🎉 **¡Celebramos los 150 miembros con un sorteo especial!**\n\n` +
              `🏆 **Premio:** 20,000 créditos IMVU\n` +
              `📌 **Requisitos:**\n` +
              `• Ser miembro del servidor\n` +
              `• Reaccionar con 🎉 a este mensaje\n\n` +
              `⏰ **Duración:** 24 horas\n\n` +
              `> 🔔 Reacciona con 🎉 para participar. El ganador será elegido al azar por el bot.`
            )
            .setColor(0xF1C40F)
            .setFooter({ text: 'DS6Music • Sorteo automático • 1 ganador al azar' });
          const sorteoMsg = await sorteosCh.send({ embeds: [sorteoEmbed] });
          await sorteoMsg.react('🎉');
          // Guardar el ID del mensaje de sorteo para resolverlo después
          require('fs').writeFileSync(require('path').join(__dirname, 'sorteo_150.json'), JSON.stringify({ messageId: sorteoMsg.id, channelId: sorteosCh.id, prize: '20,000 créditos IMVU', endsAt: Date.now() + 24 * 60 * 60 * 1000 }));
          console.log('🎉 HITO 150 MIEMBROS: Sorteo de 20k créditos lanzado!');
        }
      } catch(mErr) { console.log('Error en hito 150:', mErr.message); }
    }
  } catch (err) {
    console.error('Error en bienvenida:', err.message);
  }
});

// ══════════════════════════════════════════════════════
//  EVENTO: SALIDA DE MIEMBRO
// ══════════════════════════════════════════════════════
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    await sendLog(member.guild, `👋 **Miembro salió:** ${member.user.tag} (${member.id}). Total: ${member.guild.memberCount}`, 0xE74C3C);
    await updateStats();
  } catch(err) {}
});

// ══════════════════════════════════════════════════════
//  EVENTO: REACCIONES (sistema de roles por idioma)
// ══════════════════════════════════════════════════════
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.message.channelId !== LANG_CHANNEL_ID) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    const emoji = reaction.emoji.name;

    const langRoles = {
      '🇪🇸': '🇪🇸 Español',
      '🇬🇧': '🇬🇧 English',
      '🇧🇷': '🇧🇷 Português',
    };

    const roleName = langRoles[emoji];
    if (!roleName) return;
    const role = guild.roles.cache.find(r => r.name === roleName);
    if (role) {
      await member.roles.add(role);
      console.log(`✅ Rol ${roleName} asignado a ${user.username}`);
    }
  } catch(err) {
    console.error('Error en reacción:', err.message);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.message.channelId !== LANG_CHANNEL_ID) return;

    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    const emoji = reaction.emoji.name;

    const langRoles = {
      '🇪🇸': '🇪🇸 Español',
      '🇬🇧': '🇬🇧 English',
      '🇧🇷': '🇧🇷 Português',
    };

    const roleName = langRoles[emoji];
    if (!roleName) return;
    const role = guild.roles.cache.find(r => r.name === roleName);
    if (role) {
      await member.roles.remove(role);
    }
  } catch(err) {}
});

// ══════════════════════════════════════════════════════
//  EVENTO: MENSAJES / COMANDOS
// ══════════════════════════════════════════════════════
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // ── Ganar XP por chatear (1 XP por mensaje, cooldown 60s) ──
  if (!message.content.startsWith('!') && message.member) {
    const userId = message.author.id;
    const now = Date.now();
    const lastXP = xpCooldown.get(userId) || 0;
    if (now - lastXP > 60000) { // 60 segundos de cooldown
      xpCooldown.set(userId, now);
      const result = await addXP(message.member, 1);
      if (result.levelUp) {
        const levelNames = { 5: '🌱 Activo', 10: '🔥 Regular', 20: '⭐ Veterano', 50: '💎 Leyenda DS6Music' };
        const roleName = levelNames[result.newLevel] || `Nivel ${result.newLevel}`;
        const thresholds = [50, 20, 10, 5];
        const hasRole = thresholds.some(t => result.newLevel >= t && levelNames[t]);
        let levelMsg = `⬆️ **¡Subiste al nivel ${result.newLevel}!** ${message.author}\n`;
        if (hasRole) levelMsg += `🏅 Nuevo rol asignado: **${Object.entries(levelNames).find(([t]) => result.newLevel >= t)?.[1] || ''}**\n`;
        levelMsg += `🪙 Bonus: **+${result.bonus} DS6 Coins**`;
        message.channel.send(levelMsg).catch(() => {});
      }
    }
  }

  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // ── !ayuda ──
  if (command === 'ayuda' || command === 'help') {
    const lang = getUserLang(message.member);
    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'ayuda_title'))
      .setDescription(t(lang, 'ayuda_desc'))
      .addFields(
        { name: t(lang, 'ayuda_music'), value: t(lang, 'ayuda_music_val'), inline: false },
        { name: t(lang, 'ayuda_verify'), value: t(lang, 'ayuda_verify_val'), inline: false },
        { name: t(lang, 'ayuda_invites'), value: t(lang, 'ayuda_invites_val'), inline: false },
        { name: t(lang, 'ayuda_support'), value: t(lang, 'ayuda_support_val'), inline: false },
      )
      .setColor(0x8B0000)
      .setFooter({ text: 'DS6Music • ds6music.com' });
    return message.channel.send({ embeds: [embed] });
  }

  // ── !precio / !planes ──
  if (command === 'precio' || command === 'planes' || command === 'suscripcion') {
    const lang = getUserLang(message.member);
    const planesTexts = {
      es: {
        title: '🎵 Planes de Suscripción DS6Music',
        desc: 'Elige el plan que mejor se adapte a ti:',
        platino: { name: '🥈 PLATINO — $13 USD', value: '• 1 mes de bot activo 24/7\n• Reproduce cualquier canción con `!play`\n• Listas de reproducción personalizadas\n• Audio de alta calidad\n• Radio en vivo DS6Music integrada\n• Soporte directo al creador' },
        diamante: { name: '💎 DIAMANTE — $33 USD', value: '• Todo lo del plan Platino incluido\n• Acceso a comandos exclusivos de sala\n• Prioridad en soporte y actualizaciones\n• El bot entra automáticamente al renovar\n• Historial de reproducción de tu sala\n• Dedicatorias musicales para tu sala\n• **Ahorra $6** vs 3 meses Platino' },
        esmeralda: { name: '💚 ESMERALDA — $90 USD', value: '• Todo lo del plan Diamante incluido\n• **3 salas incluidas en tu plan**\n• 9 meses continuos sin preocuparte por renovar\n• Notificaciones automáticas de vencimiento\n• El bot recuerda tus playlists favoritas\n• Cola de canciones ilimitada\n• **Ahorra $9** vs 9 meses Platino' },
        supreme: { name: '👑 SUPREME — $200 USD', value: '• El plan más completo de DS6Music\n• 5 salas incluidas\n• Soporte VIP prioritario\n• Acceso anticipado a nuevas funciones\n• Personalización avanzada del bot' },
        footer: 'DS6Music • Contrata en ds6music.com/suscripcion'
      },
      en: {
        title: '🎵 DS6Music Subscription Plans',
        desc: 'Choose the plan that best fits you:',
        platino: { name: '🥈 PLATINUM — $13 USD', value: '• 1 month of 24/7 active bot\n• Play any song with `!play`\n• Custom playlists\n• High quality audio\n• DS6Music live radio integrated\n• Direct support with the creator' },
        diamante: { name: '💎 DIAMOND — $33 USD', value: '• Everything from Platinum included\n• Exclusive room commands\n• Priority support and updates\n• Bot joins automatically on renewal\n• Room playback history\n• Musical dedications for your room\n• **Save $6** vs 3 months Platinum' },
        esmeralda: { name: '💚 EMERALD — $90 USD', value: '• Everything from Diamond included\n• **3 rooms included in your plan**\n• 9 continuous months without renewal worries\n• Automatic expiration notifications\n• Bot remembers your favorite playlists\n• Unlimited song queue\n• **Save $9** vs 9 months Platinum' },
        supreme: { name: '👑 SUPREME — $200 USD', value: '• The most complete DS6Music plan\n• 5 rooms included\n• Priority VIP support\n• Early access to new features\n• Advanced bot customization' },
        footer: 'DS6Music • Subscribe at ds6music.com/suscripcion'
      },
      pt: {
        title: '🎵 Planos de Assinatura DS6Music',
        desc: 'Escolha o plano que melhor se adapta a você:',
        platino: { name: '🥈 PLATINO — $13 USD', value: '• 1 mês de bot ativo 24/7\n• Reproduza qualquer música com `!play`\n• Playlists personalizadas\n• Áudio de alta qualidade\n• Rádio ao vivo DS6Music integrada\n• Suporte direto com o criador' },
        diamante: { name: '💎 DIAMANTE — $33 USD', value: '• Tudo do plano Platino incluído\n• Comandos exclusivos de sala\n• Suporte e atualizações prioritários\n• Bot entra automaticamente na renovação\n• Histórico de reprodução da sua sala\n• Dedicatórias musicais para sua sala\n• **Economize $6** vs 3 meses Platino' },
        esmeralda: { name: '💚 ESMERALDA — $90 USD', value: '• Tudo do plano Diamante incluído\n• **3 salas incluídas no seu plano**\n• 9 meses contínuos sem se preocupar com renovação\n• Notificações automáticas de vencimento\n• Bot lembra suas playlists favoritas\n• Fila de músicas ilimitada\n• **Economize $9** vs 9 meses Platino' },
        supreme: { name: '👑 SUPREME — $200 USD', value: '• O plano mais completo do DS6Music\n• 5 salas incluídas\n• Suporte VIP prioritário\n• Acesso antecipado a novos recursos\n• Personalização avançada do bot' },
        footer: 'DS6Music • Assine em ds6music.com/suscripcion'
      }
    };
    const pl = planesTexts[lang] || planesTexts['es'];
    const embed = new EmbedBuilder()
      .setTitle(pl.title)
      .setDescription(pl.desc)
      .addFields(
        { name: pl.platino.name, value: pl.platino.value, inline: false },
        { name: pl.diamante.name, value: pl.diamante.value, inline: false },
        { name: pl.esmeralda.name, value: pl.esmeralda.value, inline: false },
        { name: pl.supreme.name, value: pl.supreme.value, inline: false },
        { name: '🔗', value: 'https://ds6music.com/suscripcion', inline: false }
      )
      .setColor(0xF1C40F)
      .setFooter({ text: pl.footer });
    return message.channel.send({ embeds: [embed] });
  }

  // ── !verificar ──
  if (command === 'verificar') {
    const lang = getUserLang(message.member);
    const imvuUser = args[0];
    if (!imvuUser) {
      const usageMsg = { es: '❌ Debes indicar tu usuario de IMVU. Ejemplo: `!verificar lDaddy`', en: '❌ You must provide your IMVU username. Example: `!verificar lDaddy`', pt: '❌ Você deve informar seu usuário IMVU. Exemplo: `!verificar lDaddy`' };
      return message.reply(usageMsg[lang] || usageMsg['es']);
    }

    try {
      await message.channel.sendTyping();

      // Consultar suscripciones de todos los bots
      const subscriptions = getAllSubscriptions();

      // Buscar el usuario (insensible a mayúsculas) en TODOS los campos relevantes
      const userLower = imvuUser.replace('@', '').toLowerCase();
      const userSubs = subscriptions.filter(s => {
        if (!s || typeof s !== 'object') return false;
        const owner = (s.owner || '').toLowerCase();
        const activatedBy = (s.activatedBy || '').toLowerCase();
        const contractorUsername = (s.contractorUsername || '').toLowerCase();
        const username = (s.username || '').toLowerCase();
        return owner === userLower || activatedBy === userLower ||
               contractorUsername === userLower || username === userLower;
      });

      if (userSubs.length === 0) {
        const notFoundTexts = {
          es: { title: '❌ No encontrado', desc: `El usuario **@${imvuUser}** no tiene una suscripción activa en DS6Music.\n\n¿Quieres contratar el bot? → [ds6music.com/suscripcion](https://ds6music.com/suscripcion)\n\n¿Crees que es un error? Abre un ticket en <#${CHANNELS.soporte}>` },
          en: { title: '❌ Not found', desc: `User **@${imvuUser}** has no active subscription on DS6Music.\n\nWant to subscribe? → [ds6music.com/suscripcion](https://ds6music.com/suscripcion)\n\nThink this is an error? Open a ticket in <#${CHANNELS.soporte}>` },
          pt: { title: '❌ Não encontrado', desc: `O usuário **@${imvuUser}** não tem assinatura ativa no DS6Music.\n\nQuer assinar? → [ds6music.com/suscripcion](https://ds6music.com/suscripcion)\n\nAcha que é um erro? Abra um ticket em <#${CHANNELS.soporte}>` }
        };
        const nf = notFoundTexts[lang] || notFoundTexts['es'];
        const embed = new EmbedBuilder()
          .setTitle(nf.title)
          .setDescription(nf.desc)
          .setColor(0xFF0000)
          .setFooter({ text: 'DS6Music • Verificación automática' });
        return message.channel.send({ embeds: [embed] });
      }

      // Determinar el plan más alto
      const planPriority = { ultimate: 5, supreme: 4, esmeralda: 3, '9month': 3, diamond: 2, diamante: 2, '3month': 2, '1month': 1, platino: 1, platinum: 1 };
      let highestPlan = 'platino';
      let highestPriority = 0;
      for (const sub of userSubs) {
        const planRaw = (sub.plan || sub.planId || sub.type || '1month').toLowerCase();
        const priority = planPriority[planRaw] || 1;
        if (priority > highestPriority) {
          highestPriority = priority;
          highestPlan = planRaw;
        }
      }

      const planNames = {
        '1month': 'Platino', platino: 'Platino', platinum: 'Platino',
        '3month': 'Diamante', diamond: 'Diamante', diamante: 'Diamante',
        '9month': 'Esmeralda', esmeralda: 'Esmeralda',
        supreme: 'Supreme', ultimate: 'Supreme'
      };
      const planEmojis = { Platino: '🥈', Diamante: '💎', Esmeralda: '💚', Supreme: '👑' };
      const planDisplay = planNames[highestPlan] || 'Platino';
      const planEmoji = planEmojis[planDisplay] || '🥈';

      // Asignar roles
      const guild = message.guild;
      const member = await guild.members.fetch(message.author.id);
      const assignedRoles = [];

      const rolesToAssign = ['🛍️ Cliente', '💎 VIP'];
      const planRoleMap = { Platino: '🥈 Platino', Diamante: '💎 Diamante', Esmeralda: '💚 Esmeralda', Supreme: '👑 Supreme' };
      if (planRoleMap[planDisplay]) rolesToAssign.push(planRoleMap[planDisplay]);

      for (const roleName of rolesToAssign) {
        const roleId = ROLE_IDS[roleName];
        if (roleId) {
          const role = guild.roles.cache.get(roleId);
          if (role && !member.roles.cache.has(roleId)) {
            await member.roles.add(role);
            assignedRoles.push(roleName);
          } else if (role) {
            assignedRoles.push(roleName);
          }
        }
      }

      // Mostrar el número de salas activas y sus dueños reales
      const roomsText = userSubs.length + ' sala(s) activa(s)';

      const verifiedTexts = {
        es: { title: '✅ Verificado como Cliente DS6Music', plan: 'Plan', rooms: 'Salas activas', roles: 'Roles asignados' },
        en: { title: '✅ Verified as DS6Music Client', plan: 'Plan', rooms: 'Active rooms', roles: 'Assigned roles' },
        pt: { title: '✅ Verificado como Cliente DS6Music', plan: 'Plano', rooms: 'Salas ativas', roles: 'Cargos atribuídos' }
      };
      const vt = verifiedTexts[lang] || verifiedTexts['es'];
      const embed = new EmbedBuilder()
        .setTitle(vt.title)
        .setDescription(
          `**@${imvuUser}** ha sido verificado como cliente de DS6Music.\n\n` +
          `${planEmoji} **${vt.plan}:** ${planDisplay}\n` +
          `🏠 **${vt.rooms}:** ${roomsText}\n\n` +
          `**${vt.roles}:**\n` +
          assignedRoles.map(r => `• ${r}`).join('\n')
        )
        .setColor(0x00E676)
        .setFooter({ text: 'DS6Music • Verificación automática • ds6music.com' });

      return message.channel.send({ embeds: [embed] });
    } catch(err) {
      console.error('Error en !verificar:', err.message);
      const errMsg = { es: '❌ Error al verificar. Intenta de nuevo o abre un ticket.', en: '❌ Verification error. Try again or open a ticket.', pt: '❌ Erro ao verificar. Tente novamente ou abra um ticket.' };
      return message.reply(errMsg[lang] || errMsg['es']);
    }
  }

  // ── !sorteo ──
  if (command === 'sorteo') {
    const hasPermission = message.member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
      message.member.roles.cache.some(r => ['👑 Owner', '⚙️ Staff', '🛡️ Moderador'].includes(r.name));

    if (!hasPermission) {
      return message.reply('❌ Solo el **Staff** y el **Owner** pueden iniciar sorteos.');
    }

    // Verificar que el servidor tenga al menos 150 miembros
    const memberCount = message.guild.memberCount;
    const MIN_MEMBERS = 150;
    if (memberCount < MIN_MEMBERS) {
      const faltantes = MIN_MEMBERS - memberCount;
      return message.reply(
        `⏳ **El sorteo aún no puede iniciarse.**\n\n` +
        `👥 El servidor necesita **${MIN_MEMBERS} miembros** para activar los sorteos.\n` +
        `📊 Actualmente: **${memberCount} miembros** — Faltan **${faltantes}** para el primer sorteo.\n\n` +
        `🎟️ ¡Invita amigos y gana tickets extra con \`!invitaciones\`!`
      );
    }

    const premio = args.join(' ').replace(/creditos/gi, 'créditos');
    if (!premio) {
      return message.reply('❌ Debes indicar el premio. Ejemplo: `!sorteo 5000 créditos IMVU`');
    }

    try {
      await message.guild.members.fetch();
      const inviteData = loadInvites();

      // Construir pool de tickets (excluir bots y al que ejecuta el comando)
      const pool = [];
      message.guild.members.cache.forEach(m => {
        if (m.user.bot) return;
        if (m.id === message.author.id) return; // excluir al organizador
        const invites = inviteData.invites[m.id] ? inviteData.invites[m.id].count : 0;
        const tickets = 1 + invites; // 1 base + 1 por cada invitación
        for (let i = 0; i < tickets; i++) pool.push(m);
      });

      if (pool.length === 0) {
        return message.reply('❌ No hay miembros elegibles para el sorteo.');
      }

      // Elegir ganador al azar
      const winner = pool[Math.floor(Math.random() * pool.length)];
      const winnerInvites = inviteData.invites[winner.id] ? inviteData.invites[winner.id].count : 0;

      const embed = new EmbedBuilder()
        .setTitle('🎉 ¡SORTEO DS6Music! 🎉')
        .setDescription(
          `✨ Se ha realizado un sorteo oficial de **DS6Music**.\n\n` +
          `🏆 **Premio:** ${premio}\n\n` +
          `🎲 **Ganador elegido al azar:**\n\n` +
          `👑 **${winner.user.username}**\n` +
          `${winner}\n\n` +
          `⭐ ¡Felicidades! Contacta al Staff para reclamar tu premio.\n\n` +
          `─────────────────────────\n` +
          `*Sorteo realizado entre ${message.guild.memberCount - 1} miembros del servidor.*`
        )
        .setColor(0xF1C40F)
        .setThumbnail(winner.user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `DS6Music • ${new Date().toLocaleDateString('es-ES')}` })
        .setTimestamp();

      // Enviar al canal sorteos
      const sorteosCh = message.guild.channels.cache.get(CHANNELS.sorteos);
      if (sorteosCh) {
        await sorteosCh.send({ content: '🎊 ¡¡¡NUEVO SORTEO!!! 🎊', embeds: [embed] });
      } else {
        await message.channel.send({ embeds: [embed] });
      }

      await sendLog(message.guild, `🎉 **Sorteo realizado:** Premio: ${premio} | Ganador: ${winner.user.tag}`, 0xF1C40F);
    } catch(err) {
      console.error('Error en !sorteo:', err.message);
      return message.reply('❌ Error al realizar el sorteo. Intenta de nuevo.');
    }
  }

  // ── !invitaciones ──
  if (command === 'invitaciones') {
    try {
      const data = loadInvites();
      const targetUser = message.mentions.users.first() || message.author;
      const userId = targetUser.id;

      // !invitaciones top → ranking
      if (args[0] === 'top' || args[0] === 'ranking') {
        const sorted = Object.entries(data.invites)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 10);

        if (sorted.length === 0) {
          return message.reply('📊 Aún no hay invitaciones registradas.');
        }

        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        let rankText = '';
        sorted.forEach(([id, info], i) => {
          const pts = info.count;
          rankText += medals[i] + ' **' + info.name + '** — ' + pts + ' invitación' + (pts !== 1 ? 'es' : '') + ' (' + pts + ' punto' + (pts !== 1 ? 's' : '') + ')\n';
        });

        const embedTop = {
          title: '🏆 Ranking de Invitaciones DS6Music',
          description: 'Los miembros con más invitaciones tienen **más probabilidad de ganar** en los sorteos.\n\n' + rankText,
          color: 0xF1C40F,
          footer: { text: 'DS6Music • Cada invitación = 1 punto extra en sorteos' },
          timestamp: new Date().toISOString()
        };
        return message.channel.send({ embeds: [embedTop] });
      }

      // Ver invitaciones propias o de otro usuario
      const userInvites = data.invites[userId];
      const count = userInvites ? userInvites.count : 0;
      const members = userInvites ? userInvites.members : [];

      const baseTickets = 1;
      const bonusTickets = count;
      const totalTickets = baseTickets + bonusTickets;

      let membersText = '';
      if (members.length > 0) {
        const recent = members.slice(-5).reverse();
        membersText = '\n\n**Últimos invitados:**\n' + recent.map(m => '• ' + m.name).join('\n');
      }

      const embedUser = {
        title: '📨 Invitaciones de ' + targetUser.username,
        description:
          'Has invitado a **' + count + ' miembro' + (count !== 1 ? 's' : '') + '** al servidor.\n\n' +
          '🎟️ **Tickets en sorteos:** ' + totalTickets + ' (1 base + ' + bonusTickets + ' por invitaciones)\n' +
          '📈 **Más invitaciones = más probabilidad de ganar**' +
          membersText,
        color: count > 0 ? 0x00E676 : 0x7289da,
        fields: [
          {
            name: '💡 ¿Cómo sumar más puntos?',
            value: 'Invita amigos con tu link personal de Discord.\nCada miembro que se una usando tu link = **+1 ticket** en el próximo sorteo.',
            inline: false
          }
        ],
        footer: { text: 'DS6Music • Sistema de invitaciones' },
        timestamp: new Date().toISOString()
      };
      return message.channel.send({ embeds: [embedUser] });
    } catch(err) {
      console.error('Error en !invitaciones:', err.message);
      return message.reply('❌ Error al obtener las invitaciones.');
    }
  }

  // ── !ticket ──
  if (command === 'ticket') {
    try {
      const lang = getUserLang(message.member);
      const ticketTexts = {
        es: { noChannel: '❌ Canal de soporte no encontrado.', threadName: (n, u) => `🎫 Ticket #${n} — ${u}`, embedTitle: (n) => `🎫 Ticket #${n} — Soporte DS6Music`, user: 'Usuario', query: 'Consulta', staff: 'Un miembro del Staff te atenderá en breve.', close: 'Usa `!cerrar` para cerrar este ticket cuando se resuelva.', created: (n, id) => `✅ Tu ticket **#${n}** fue creado. Ve a <#${id}>`, error: '❌ Error al crear el ticket. Intenta de nuevo.' },
        en: { noChannel: '❌ Support channel not found.', threadName: (n, u) => `🎫 Ticket #${n} — ${u}`, embedTitle: (n) => `🎫 Ticket #${n} — DS6Music Support`, user: 'User', query: 'Query', staff: 'A Staff member will assist you shortly.', close: 'Use `!cerrar` to close this ticket when resolved.', created: (n, id) => `✅ Your ticket **#${n}** was created. Go to <#${id}>`, error: '❌ Error creating ticket. Try again.' },
        pt: { noChannel: '❌ Canal de suporte não encontrado.', threadName: (n, u) => `🎫 Ticket #${n} — ${u}`, embedTitle: (n) => `🎫 Ticket #${n} — Suporte DS6Music`, user: 'Usuário', query: 'Dúvida', staff: 'Um membro da Staff atenderá você em breve.', close: 'Use `!cerrar` para fechar este ticket quando resolvido.', created: (n, id) => `✅ Seu ticket **#${n}** foi criado. Vá para <#${id}>`, error: '❌ Erro ao criar ticket. Tente novamente.' }
      };
      const tt = ticketTexts[lang] || ticketTexts['es'];
      const consulta = args.join(' ') || 'Sin descripción';
      const guild = message.guild;
      // Crear hilo privado en el canal soporte
      const soporteCh = guild.channels.cache.get(CHANNELS.soporte);
      if (!soporteCh) return message.reply(tt.noChannel);
      const ticketNum = Date.now().toString().slice(-4);
      const thread = await soporteCh.threads.create({
        name: tt.threadName(ticketNum, message.author.username),
        autoArchiveDuration: 1440,
        reason: `Ticket de soporte de ${message.author.tag}`,
      });
      const staffRole = guild.roles.cache.find(r => ['⚙️ Staff', '👑 Owner'].includes(r.name));
      const embed = new EmbedBuilder()
        .setTitle(tt.embedTitle(ticketNum))
        .setDescription(
          `**${tt.user}:** <@${message.author.id}>\n` +
          `**${tt.query}:** ${consulta}\n\n` +
          `${tt.staff}\n` +
          tt.close
        )
        .setColor(0x7289da)
        .setFooter({ text: 'DS6Music • Soporte' })
        .setTimestamp();
      await thread.send({
        content: staffRole ? `<@${message.author.id}> ${staffRole}` : `<@${message.author.id}>`,
        embeds: [embed]
      });
      await message.reply(tt.created(ticketNum, thread.id));
      await sendLog(guild, `🎫 **Nuevo ticket #${ticketNum}** de ${message.author.tag}: ${consulta}`, 0x7289da);
    } catch(err) {
      console.error('Error en !ticket:', err.message);
      return message.reply('❌ Error al crear el ticket. Intenta de nuevo.');
    }
  }

  // ── !cerrar ──
  if (command === 'cerrar') {
    try {
      const lang = getUserLang(message.member);
      if (message.channel.isThread()) {
        await message.channel.send(t(lang, 'close_success'));
        await message.channel.setArchived(true);
      } else {
        return message.reply(t(lang, 'close_error'));
      }
    } catch(err) {
      console.error('Error en !cerrar:', err.message);
    }
  }

  // ── !daily ──
  if (command === 'daily') {
    const lang = getUserLang(message.member);
    const dailyData = loadDaily();
    const userId = message.author.id;
    const now = Date.now();
    const lastDaily = dailyData[userId] || 0;
    const cooldown = 24 * 60 * 60 * 1000; // 24 horas
    const remaining = cooldown - (now - lastDaily);

    if (remaining > 0 && lastDaily > 0) {
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const mins  = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const msgs = {
        es: `⏳ Ya reclamaste tu recompensa diaria. Vuelve en **${hours}h ${mins}m**.`,
        en: `⏳ You already claimed your daily reward. Come back in **${hours}h ${mins}m**.`,
        pt: `⏳ Você já coletou sua recompensa diária. Volte em **${hours}h ${mins}m}**.`
      };
      return message.reply(msgs[lang] || msgs['es']);
    }

    // Recompensa: 50 coins base + bonus por racha (si vino ayer)
    const yesterday = now - cooldown;
    const streak = (lastDaily > yesterday - 3600000) ? (dailyData[userId + '_streak'] || 0) + 1 : 1;
    dailyData[userId + '_streak'] = streak;
    dailyData[userId] = now;
    saveDaily(dailyData);

    const baseCoins = 50;
    const streakBonus = Math.min(streak - 1, 6) * 10; // hasta +60 por racha de 7 días
    const totalCoins = baseCoins + streakBonus;
    const newTotal = addCoins(userId, totalCoins);
    const xpResult = await addXP(message.member, 10); // +10 XP por daily

    const streakEmoji = streak >= 7 ? '🔥' : streak >= 3 ? '⭐' : '🌱';
    const dailyTexts = {
      es: {
        title: '🎁 ¡Recompensa Diaria Reclamada!',
        desc: `**+${totalCoins} DS6 Coins** recibidos${streakBonus > 0 ? ` (+${streakBonus} bonus de racha)` : ''}\n**+10 XP** ganados\n\n${streakEmoji} **Racha:** ${streak} día${streak !== 1 ? 's' : ''} consecutivo${streak !== 1 ? 's' : ''}\n🪙 **Total de coins:** ${newTotal}\n\n> Vuelve mañana para continuar tu racha. ¡Una racha de 7 días da bonus máximo!`
      },
      en: {
        title: '🎁 Daily Reward Claimed!',
        desc: `**+${totalCoins} DS6 Coins** received${streakBonus > 0 ? ` (+${streakBonus} streak bonus)` : ''}\n**+10 XP** earned\n\n${streakEmoji} **Streak:** ${streak} consecutive day${streak !== 1 ? 's' : ''}\n🪙 **Total coins:** ${newTotal}\n\n> Come back tomorrow to keep your streak. A 7-day streak gives maximum bonus!`
      },
      pt: {
        title: '🎁 Recompensa Diária Coletada!',
        desc: `**+${totalCoins} DS6 Coins** recebidos${streakBonus > 0 ? ` (+${streakBonus} bônus de sequência)` : ''}\n**+10 XP** ganhos\n\n${streakEmoji} **Sequência:** ${streak} dia${streak !== 1 ? 's' : ''} consecutivo${streak !== 1 ? 's' : ''}\n🪙 **Total de coins:** ${newTotal}\n\n> Volte amanhã para continuar sua sequência!`
      }
    };
    const dt = dailyTexts[lang] || dailyTexts['es'];
    const embed = new EmbedBuilder()
      .setTitle(dt.title)
      .setDescription(dt.desc)
      .setColor(0xF1C40F)
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'DS6Music • Sistema de Economía' });
    return message.channel.send({ embeds: [embed] });
  }

  // ── !perfil ──
  if (command === 'perfil' || command === 'profile' || command === 'rank') {
    const lang = getUserLang(message.member);
    const target = message.mentions.members.first() || message.member;
    const userId = target.id;
    const xpData = loadXP();
    const userData = xpData[userId] || { xp: 0, level: 1 };
    const xp = userData.xp;
    const level = getLevel(xp);
    const coins = getCoins(userId);
    const inviteData = loadInvites();
    const invites = inviteData.invites[userId] ? inviteData.invites[userId].count : 0;
    const dailyData = loadDaily();
    const streak = dailyData[userId + '_streak'] || 0;

    // XP dentro del nivel actual
    const xpAtCurrentLevel = xpAccumulated(level - 1);
    const xpForThis = xpForNextLevel(level);
    const xpInLevel = xp - xpAtCurrentLevel;
    const progressBar = () => {
      const filled = Math.round((xpInLevel / xpForThis) * 10);
      return '█'.repeat(filled) + '░'.repeat(10 - filled);
    };

    // Rol de nivel actual
    const thresholds = [50, 20, 10, 5];
    const levelRoleName = thresholds.find(t => level >= t)
      ? { 5: '🌱 Activo', 10: '🔥 Regular', 20: '⭐ Veterano', 50: '💎 Leyenda DS6Music' }[thresholds.find(t => level >= t)]
      : '👤 Nuevo';

    // Ver si es cliente DS6Music
    const isClient = target.roles.cache.some(r => r.name === '🛒️ Cliente');
    const clientPlan = isClient ? (() => {
      if (target.roles.cache.some(r => r.name === '👑 Supreme')) return '👑 Supreme';
      if (target.roles.cache.some(r => r.name === '💚 Esmeralda')) return '💚 Esmeralda';
      if (target.roles.cache.some(r => r.name === '💎 Diamante')) return '💎 Diamante';
      return '🥈 Platino';
    })() : null;

    const profileTexts = {
      es: { title: `📊 Perfil de ${target.user.username}`, level: 'Nivel', xp: 'XP', coins: 'DS6 Coins', invites: 'Invitaciones', streak: 'Racha diaria', plan: 'Plan DS6Music', no_plan: 'Sin suscripción activa' },
      en: { title: `📊 ${target.user.username}'s Profile`, level: 'Level', xp: 'XP', coins: 'DS6 Coins', invites: 'Invites', streak: 'Daily streak', plan: 'DS6Music Plan', no_plan: 'No active subscription' },
      pt: { title: `📊 Perfil de ${target.user.username}`, level: 'Nível', xp: 'XP', coins: 'DS6 Coins', invites: 'Convites', streak: 'Sequência diária', plan: 'Plano DS6Music', no_plan: 'Sem assinatura ativa' }
    };
    const pt = profileTexts[lang] || profileTexts['es'];

    const embed = new EmbedBuilder()
      .setTitle(pt.title)
      .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
      .setDescription(
        `**${pt.level}:** ${level} — ${levelRoleName}\n` +
        `**${pt.xp}:** ${xp} XP \`[${progressBar()}]\` ${xpInLevel}/${xpForThis}\n\n` +
        `🪙 **${pt.coins}:** ${coins}\n` +
        `📨 **${pt.invites}:** ${invites}\n` +
        `🔥 **${pt.streak}:** ${streak} día${streak !== 1 ? 's' : ''}\n` +
        `🎵 **${pt.plan}:** ${clientPlan || pt.no_plan}`
      )
      .setColor(isClient ? 0xF1C40F : 0x7289da)
      .setFooter({ text: 'DS6Music • ds6music.com' });
    return message.channel.send({ embeds: [embed] });
  }

  // ── !warn ──
  if (command === 'warn') {
    const hasPermission = message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
      message.member.roles.cache.some(r => ['👑 Owner', '⚙️ Staff'].includes(r.name));
    if (!hasPermission) return;

    const target = message.mentions.members.first();
    const reason = args.slice(1).join(' ') || 'Sin razón especificada';
    if (!target) return message.reply('❌ Menciona al usuario a advertir.');

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Advertencia')
      .setDescription(`<@${target.id}> ha recibido una advertencia.\n**Razón:** ${reason}`)
      .setColor(0xFFA500)
      .setFooter({ text: `Advertido por ${message.author.tag}` })
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
    await sendLog(message.guild, `⚠️ **Advertencia:** ${target.user.tag} advertido por ${message.author.tag}. Razón: ${reason}`, 0xFFA500);
  }
});

// ══════════════════════════════════════════════════════
//  EVENTO: READY
// ══════════════════════════════════════════════════════
client.once(Events.ClientReady, () => {
  // Inicializar cache de invitaciones
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
      refreshInviteCache(guild)
        .then(() => console.log('[Invites] Cache inicializado'))
        .catch(e => console.log('[Invites] Error init cache:', e.message));
    }
  } catch(e) { console.log('[Invites] Error init cache:', e.message); }

  console.log(`✅ Bot DS6Music Discord conectado como ${client.user.tag}`);
  client.user.setActivity('🎵 DS6Music | ds6music.com', { type: ActivityType.Watching });

  // Actualizar stats cada 10 minutos
  setInterval(updateStats, 10 * 60 * 1000);
  setTimeout(updateStats, 3000);
  // Publicar mensaje de tickets con botón
  setTimeout(() => setupTicketMessage(client.guilds.cache.get(GUILD_ID)), 5000);

  // Actualizar Top 3 salas cada 10 minutos
  setInterval(updateTop3Rooms, 10 * 60 * 1000);
  setTimeout(updateTop3Rooms, 8000);

});

async function updateSalasEnVivo_DISABLED() {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    const ch = guild.channels.cache.get(CHANNELS.salasEnVivo);
    if (!ch) return;

    // Obtener datos de la API
    const statusData = await new Promise((resolve, reject) => {
      const req = http.get('http://localhost:3000/api/status', res => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy());
    });

    const roomsObj = statusData.rooms || {};
    const rooms = Object.entries(roomsObj)
      .map(([roomId, data]) => ({ roomId, ...data }))
      .filter(r => r.status === 'streaming' || r.listeners > 0)
      .sort((a, b) => (b.listeners || 0) - (a.listeners || 0));

    const medals = ['🥇', '🥈', '🥉', '🔹', '🔹', '🔹'];
    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    let desc = '';
    if (rooms.length === 0) {
      desc = '⏸️ *No hay salas activas en este momento.*\n\n🎵 ¿Quieres tener música 24/7 en tu sala?\n🔗 [Contratar DS6Music](https://ds6music.com/suscripcion)';
    } else {
      rooms.slice(0, 6).forEach((room, i) => {
        const medal = medals[i] || '🔹';
        const listeners = room.listeners || 0;
        const song = room.currentSong || room.song || null;
        const artist = room.currentArtist || room.artist || null;
        const queue = room.queue ? room.queue.length : 0;
        const roomLink = `https://go.imvu.com/chat/${room.roomId}`;
        const streamLink = `https://ds6music.com/stream/${room.roomId}`;
        const owner = room.contractorUsername || room.roomId.split('-')[1] || 'Sala';

        desc += `${medal} **Sala de ${owner}** — 👤 ${listeners} oyente${listeners !== 1 ? 's' : ''}\n`;
        if (song) desc += `🎵 *${artist ? artist + ' — ' : ''}${song}*\n`;
        if (queue > 0) desc += `📋 Cola: ${queue} canción${queue !== 1 ? 'es' : ''}\n`;
        desc += `[🔊 Escuchar](${streamLink}) • [🏠 Ir a la sala](${roomLink})\n\n`;
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`🔥 Salas DS6Music en Vivo — ${rooms.length} activa${rooms.length !== 1 ? 's' : ''}`)
      .setDescription(desc)
      .setColor(0xFF4500)
      .setFooter({ text: `DS6Music • Última actualización: ${timeStr} • Se actualiza cada 5 min` });

    // Editar el último mensaje del bot o enviar uno nuevo
    const msgs = await ch.messages.fetch({ limit: 5 });
    const botMsg = msgs.find(m => m.author.id === client.user.id && m.embeds.length > 0);
    if (botMsg) {
      await botMsg.edit({ embeds: [embed] });
    } else {
      await ch.send({ embeds: [embed] });
    }
  } catch(e) {
    console.log('[SalasEnVivo] Error:', e.message);
  }
}


// ══════════════════════════════════════════════════════
//  SISTEMA DE TICKETS CON BOTÓN
// ══════════════════════════════════════════════════════

// IDs de roles para tickets
const TICKET_ROLES = {
  staff: '1503670328923131944',   // ⚙️ Staff
  owner: '1503670317804158991',   // 👑 Owner
};
const TICKET_CATEGORY_ID = '1503670628660805712'; // Categoría SOPORTE

// Publicar/actualizar el mensaje con botón en #soporte-tickets
async function setupTicketMessage(guild) {
  try {
    const ch = guild.channels.cache.get(CHANNELS.soporte);
    if (!ch) return;
    const msgs = await ch.messages.fetch({ limit: 10 });
    // Eliminar mensajes anteriores del bot
    for (const [, msg] of msgs) {
      if (msg.author.id === client.user.id) {
        await msg.delete().catch(() => {});
      }
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
      new ButtonBuilder()
        .setCustomId('open_ticket')
        .setLabel('🎫 Abrir Ticket')
        .setStyle(ButtonStyle.Primary)
    );

    await ch.send({ embeds: [embed], components: [row] });
    console.log('[Tickets] Mensaje con botón publicado en #soporte-tickets');
  } catch(e) {
    console.error('[Tickets] Error al publicar mensaje:', e.message);
  }
}

// Manejar clic en el botón de ticket
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'open_ticket') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const guild = interaction.guild;
      const user  = interaction.user;

      // Verificar si ya tiene un ticket abierto
      const existing = guild.channels.cache.find(
        c => c.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}` && c.parentId === TICKET_CATEGORY_ID
      );
      if (existing) {
        return interaction.editReply({ content: `❌ Ya tienes un ticket abierto: <#${existing.id}>` });
      }

      // Crear canal privado para el ticket
      const ticketCh = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, type: 1, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: TICKET_ROLES.staff, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: TICKET_ROLES.owner, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: client.user.id, type: 1, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] },
        ]
      });

      // Mensaje de bienvenida en el ticket
      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('🔒 Cerrar Ticket')
          .setStyle(ButtonStyle.Danger)
      );

      const welcomeEmbed = new EmbedBuilder()
        .setTitle(`🎫 Ticket de ${user.username}`)
        .setDescription(`Hola <@${user.id}>, el Staff te atenderá **inmediatamente**.

Describe tu consulta y espera la respuesta.`)
        .setColor(0x9B59B6)
        .setFooter({ text: 'DS6Music Support Team' })
        .setTimestamp();

      await ticketCh.send({
        content: `<@${user.id}> <@&${TICKET_ROLES.staff}> <@&${TICKET_ROLES.owner}>`,
        embeds: [welcomeEmbed],
        components: [closeRow]
      });

      await interaction.editReply({ content: `✅ Tu ticket fue creado: <#${ticketCh.id}>` });
      await sendLog(guild, `🎫 **Nuevo ticket** de ${user.tag} → <#${ticketCh.id}>`, 0x9B59B6);

    } catch(e) {
      console.error('[Tickets] Error al crear ticket:', e.message);
      await interaction.editReply({ content: '❌ Error al crear el ticket. Intenta de nuevo.' });
    }
  }

  // Cerrar ticket
  if (interaction.customId === 'close_ticket') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const ch = interaction.channel;
      if (!ch.name.startsWith('ticket-')) {
        return interaction.editReply({ content: '❌ Este comando solo funciona dentro de un ticket.' });
      }
      await interaction.editReply({ content: '🔒 Cerrando ticket...' });
      await ch.send('🔒 **Ticket cerrado.** El canal se eliminará en 5 segundos.');
      setTimeout(() => ch.delete().catch(() => {}), 5000);
      await sendLog(interaction.guild, `🔒 **Ticket cerrado** por ${interaction.user.tag}: #${ch.name}`, 0xFF4500);
    } catch(e) {
      console.error('[Tickets] Error al cerrar ticket:', e.message);
    }
  }
});


// ── Login ──
const TOKEN = process.env.DISCORD_TOKEN; // Required: set DISCORD_TOKEN in your .env file
client.login(TOKEN).catch(err => {
  console.error('Error al conectar:', err.message);
  process.exit(1);
});
