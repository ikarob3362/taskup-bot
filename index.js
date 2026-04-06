/**
 * Task UP Bot — Telegram + Firebase Integration
 * Deploy: Render.com (Background Worker - Free Tier)
 *
 * Variáveis de ambiente necessárias no Render:
 *   TG_BOT_TOKEN = token do bot Telegram
 *   FIREBASE_DB_URL = URL do Realtime Database
 *   FIREBASE_API_KEY = API key do projeto Firebase
 */

const fetch = require('node-fetch');

// ======================== CONFIG ========================
const TG_TOKEN = process.env.TG_BOT_TOKEN || '8401409685:AAGP1oYy1eaFw3EEQhhv62_NTba1WTRh9A0';
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const FB_URL = process.env.FIREBASE_DB_URL || 'https://gerenciador-ikaro-default-rtdb.firebaseio.com';
const FB_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBC810jscH5K2rOrgw50qGK_IkDY4akB7M';

let lastUpdateId = 0;

// ======================== FIREBASE REST ========================
async function fbGet(path) {
  try {
    const res = await fetch(`${FB_URL}/${path}.json?auth=${FB_KEY}`);
    if (!res.ok) {
      // Tenta sem auth (caso regras permitam)
      const res2 = await fetch(`${FB_URL}/${path}.json`);
      return res2.json();
    }
    return res.json();
  } catch(e) {
    console.error('Firebase GET error:', e.message);
    return null;
  }
}

async function fbSet(path, value) {
  try {
    const res = await fetch(`${FB_URL}/${path}.json?auth=${FB_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    if (!res.ok) {
      const res2 = await fetch(`${FB_URL}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value)
      });
      return res2.ok;
    }
    return true;
  } catch(e) {
    console.error('Firebase SET error:', e.message);
    return false;
  }
}

// ======================== TELEGRAM API ========================
async function sendMsg(chatId, text) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
  } catch(e) { console.error('TG send error:', e.message); }
}

// ======================== COMMAND HANDLERS ========================
async function handleStart(chatId, text, from) {
  const code = text.split(' ')[1];

  if (!code) {
    return sendMsg(chatId,
      `👋 Olá, ${from.first_name}!\n\n` +
      `Eu sou o <b>Task UP Bot</b> 🚀\n\n` +
      `Para vincular sua conta:\n` +
      `1. Acesse <b>task.up.srv.br</b>\n` +
      `2. Clique no ícone 🔔\n` +
      `3. Envie aqui: <code>/start SEU_CÓDIGO</code>`
    );
  }

  const users = await fbGet('users');
  if (!users) return sendMsg(chatId, '❌ Nenhum usuário no sistema. Faça login no Task UP primeiro.');

  let matchUid = null, matchUser = null;
  for (const [uid, u] of Object.entries(users)) {
    if (uid.substring(0, 8) === code) {
      matchUid = uid;
      matchUser = u;
      break;
    }
  }

  if (!matchUid) return sendMsg(chatId, `❌ Código <b>${code}</b> não encontrado. Verifique no Task UP (ícone 🔔).`);

  const ok = await fbSet(`users/${matchUid}/telegramChatId`, chatId.toString());
  if (!ok) return sendMsg(chatId, '❌ Erro ao salvar vinculação. Tente novamente.');

  console.log(`✅ Linked: ${matchUser.name} (${matchUid}) → Chat ${chatId}`);
  return sendMsg(chatId,
    `✅ <b>Vinculado com sucesso!</b>\n\n` +
    `👤 ${matchUser.name || matchUser.email}\n\n` +
    `Você receberá notificações de:\n` +
    `• 📋 Novas tarefas atribuídas\n` +
    `• 🔄 Mudanças de status\n` +
    `• 📝 Atualizações de tarefas\n\n` +
    `Use /tarefas para ver suas pendências.`
  );
}

async function handleTarefas(chatId) {
  const [users, tasks] = await Promise.all([fbGet('users'), fbGet('tasks')]);

  let myUid = null;
  if (users) {
    for (const [uid, u] of Object.entries(users)) {
      if (u.telegramChatId === chatId.toString()) { myUid = uid; break; }
    }
  }

  if (!myUid) return sendMsg(chatId, '❌ Conta não vinculada. Use /start <código> para vincular.');
  if (!tasks) return sendMsg(chatId, '📋 Nenhuma tarefa no sistema.');

  const mine = Object.values(tasks)
    .filter(t => t.assignee === myUid && t.status !== 'Concluída')
    .sort((a, b) => {
      const ord = { 'Urgente': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };
      return (ord[a.priority] ?? 4) - (ord[b.priority] ?? 4);
    });

  if (!mine.length) return sendMsg(chatId, '🎉 Nenhuma tarefa pendente! Bom trabalho!');

  const pEmoji = { 'Urgente': '🔴', 'Alta': '🟠', 'Média': '🟡', 'Baixa': '🟢' };
  let msg = `📋 <b>Suas Tarefas (${mine.length})</b>\n\n`;
  mine.forEach(t => {
    const e = pEmoji[t.priority] || '⚪';
    const s = t.status === 'Em Andamento' ? '🔄' : '📌';
    const d = t.dueDate ? ` 📅 ${new Date(parseInt(t.dueDate)).toLocaleDateString('pt-BR')}` : '';
    msg += `${s} ${e} <b>${t.title}</b>${d}\n`;
  });

  return sendMsg(chatId, msg);
}

async function handleStatus(chatId) {
  const [users, tasks] = await Promise.all([fbGet('users'), fbGet('tasks')]);
  const tList = tasks ? Object.values(tasks) : [];

  return sendMsg(chatId,
    `📊 <b>Task UP — Resumo</b>\n\n` +
    `👥 Usuários: ${users ? Object.keys(users).length : 0}\n` +
    `📋 Tarefas: ${tList.length}\n\n` +
    `📌 A Fazer: ${tList.filter(t => t.status === 'A Fazer').length}\n` +
    `🔄 Em Andamento: ${tList.filter(t => t.status === 'Em Andamento').length}\n` +
    `✅ Concluídas: ${tList.filter(t => t.status === 'Concluída').length}`
  );
}

async function handleHelp(chatId) {
  return sendMsg(chatId,
    `🚀 <b>Task UP Bot</b>\n\n` +
    `/start <código> — Vincular conta\n` +
    `/tarefas — Minhas tarefas pendentes\n` +
    `/status — Resumo geral\n` +
    `/help — Comandos\n\n` +
    `🌐 <b>task.up.srv.br</b>`
  );
}

// ======================== POLLING ========================
async function processMsg(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const from = msg.from;

  console.log(`📨 ${from.first_name} (${chatId}): ${text}`);

  if (text.startsWith('/start')) return handleStart(chatId, text, from);
  if (text === '/tarefas') return handleTarefas(chatId);
  if (text === '/status') return handleStatus(chatId);
  if (text === '/help') return handleHelp(chatId);

  return sendMsg(chatId, 'Use /help para ver os comandos disponíveis 🤔');
}

async function poll() {
  try {
    const res = await fetch(`${TG_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
    const data = await res.json();
    if (data.ok && data.result.length) {
      for (const u of data.result) {
        lastUpdateId = u.update_id;
        if (u.message?.text) await processMsg(u.message);
      }
    }
  } catch(e) {
    console.error('Poll error:', e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
}

// ======================== HEALTH CHECK (Render) ========================
// Render precisa de um HTTP server para não matar o processo no free tier
const http = require('http');
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', bot: 'Task UP Bot', uptime: process.uptime() }));
}).listen(PORT, () => console.log(`🌐 Health check on port ${PORT}`));

// ======================== MAIN ========================
async function main() {
  console.log('🚀 Task UP Bot starting...');

  // Registra comandos do menu
  await fetch(`${TG_API}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'start', description: 'Vincular conta Task UP' },
        { command: 'tarefas', description: 'Minhas tarefas pendentes' },
        { command: 'status', description: 'Resumo geral' },
        { command: 'help', description: 'Comandos disponíveis' }
      ]
    })
  });

  console.log('✅ Bot commands registered');
  console.log('📡 Polling started...');

  while (true) { await poll(); }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
