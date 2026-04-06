/**
 * Task UP Bot — Telegram + Firebase + Notion Integration
 * Deploy: Render.com (Web Service - Free Tier)
 *
 * Variáveis de ambiente necessárias no Render:
 *   TG_BOT_TOKEN      = token do bot Telegram
 *   FIREBASE_DB_URL    = URL do Realtime Database
 *   FIREBASE_API_KEY   = API key do projeto Firebase
 *   NOTION_TOKEN       = Internal Integration Token do Notion
 *   NOTION_DB_ID       = ID do database Tarefas Operacionais
 */

const fetch = require('node-fetch');

// ======================== CONFIG ========================
const TG_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const FB_URL = process.env.FIREBASE_DB_URL || 'https://gerenciador-ikaro-default-rtdb.firebaseio.com';
const FB_KEY = process.env.FIREBASE_API_KEY || '';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_DB_ID = process.env.NOTION_DB_ID || '2fa4ab8f003742d0ab9d6527f9180502';
const NOTION_API = 'https://api.notion.com/v1';

let lastUpdateId = 0;

// ======================== FIREBASE REST ========================
async function fbGet(path) {
  try {
    const res = await fetch(`${FB_URL}/${path}.json?auth=${FB_KEY}`);
    if (!res.ok) {
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

// ======================== NOTION API ========================
const notionHeaders = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28'
};

// Mapeamento Status Firebase → Notion
const statusMap = {
  'A Fazer': 'A Fazer',
  'Em Andamento': 'Em Andamento',
  'Em Revisão': 'Em Revisão',
  'Concluída': 'Concluída',
  'Cancelada': 'Cancelada'
};

// Mapeamento Prioridade Firebase → Notion
const priorityMap = {
  'Urgente': 'Urgente',
  'Alta': 'Alta',
  'Média': 'M\u00e9dia',
  'Baixa': 'Baixa'
};

// Mapeamento Empresa Firebase → Notion
const empresaMap = {
  'PLugo': 'PLugo Eletropostos',
  'PLugo Eletropostos': 'PLugo Eletropostos',
  'SoluçõesUP': 'Solu\u00e7\u00f5esUP',
  'Soluções UP': 'Solu\u00e7\u00f5esUP',
  'SolucoesUP': 'Solu\u00e7\u00f5esUP',
  'UpLink Serviço': 'UpLink Servi\u00e7o',
  'UpLink Servico': 'UpLink Servi\u00e7o',
  'UpLink Provedor': 'UpLink Provedor'
};

// Mapeamento Categoria Firebase → Notion
const categoriaMap = {
  'Comercial': 'Comercial',
  'Técnico': 'T\u00e9cnico',
  'Tecnico': 'T\u00e9cnico',
  'Administrativo': 'Administrativo',
  'Marketing': 'Marketing',
  'Financeiro': 'Financeiro',
  'TI': 'TI'
};

// Extrai o título da tarefa com fallbacks para diferentes nomes de campo
function getTaskTitle(task) {
  return task.title || task.name || task.titulo || task.nome || task.text || task.tarefa || '';
}

// Verifica se a tarefa tem dados mínimos para sync
function isValidTask(task) {
  if (!task || typeof task !== 'object') return false;
  const title = getTaskTitle(task);
  // Pula tarefas sem título ou que são metadados internos
  if (!title) return false;
  // Pula se for apenas um valor primitivo (não é objeto de tarefa)
  if (typeof task === 'string' || typeof task === 'number') return false;
  return true;
}

function buildNotionProperties(task) {
  const title = getTaskTitle(task);
  const props = {
    'Tarefa': { title: [{ text: { content: title || 'Sem título' } }] }
  };

  // Status (com fallbacks)
  const rawStatus = task.status || task.estado || '';
  const status = statusMap[rawStatus];
  if (status) props['Status'] = { select: { name: status } };

  // Prioridade (com fallbacks)
  const rawPrio = task.priority || task.prioridade || '';
  const prio = priorityMap[rawPrio];
  if (prio) props['Prioridade'] = { select: { name: prio } };

  // Empresa (com fallbacks)
  const rawEmpresa = task.company || task.empresa || '';
  const empresa = empresaMap[rawEmpresa];
  if (empresa) props['Empresa'] = { select: { name: empresa } };

  // Categoria (com fallbacks)
  const rawCat = task.category || task.categoria || '';
  const cat = categoriaMap[rawCat];
  if (cat) props['Categoria'] = { select: { name: cat } };

  // Prazo (dueDate em timestamp ou ISO, com fallbacks)
  const rawDate = task.dueDate || task.prazo || task.deadline || '';
  if (rawDate) {
    let dateStr;
    const ts = parseInt(rawDate);
    if (!isNaN(ts) && ts > 1000000000) {
      dateStr = new Date(ts).toISOString().split('T')[0];
    } else if (typeof rawDate === 'string' && rawDate.includes('-')) {
      dateStr = rawDate.split('T')[0];
    }
    if (dateStr) props['Prazo'] = { date: { start: dateStr } };
  }

  // Observações (com fallbacks)
  const rawObs = task.description || task.notes || task.observacoes || task.descricao || task.obs || '';
  if (rawObs) {
    props['Observa\u00e7\u00f5es'] = {
      rich_text: [{ text: { content: rawObs.substring(0, 2000) } }]
    };
  }

  return props;
}

async function notionCreatePage(task) {
  if (!NOTION_TOKEN) return null;
  try {
    const res = await fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { database_id: NOTION_DB_ID },
        properties: buildNotionProperties(task)
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Notion CREATE error:', res.status, err);
      return null;
    }
    const data = await res.json();
    console.log(`📝 Notion: criada página ${data.id} para "${getTaskTitle(task)}"`);
    return data.id;
  } catch(e) {
    console.error('Notion CREATE error:', e.message);
    return null;
  }
}

async function notionUpdatePage(pageId, task) {
  if (!NOTION_TOKEN || !pageId) return false;
  try {
    const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH',
      headers: notionHeaders,
      body: JSON.stringify({ properties: buildNotionProperties(task) })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Notion UPDATE error:', res.status, err);
      return false;
    }
    console.log(`📝 Notion: atualizada página ${pageId}`);
    return true;
  } catch(e) {
    console.error('Notion UPDATE error:', e.message);
    return false;
  }
}

// Sync completo: Firebase → Notion
async function syncFirebaseToNotion() {
  if (!NOTION_TOKEN) {
    console.log('⚠️ NOTION_TOKEN não configurado, sync desabilitado');
    return;
  }

  console.log('🔄 Iniciando sync Firebase → Notion...');
  const tasks = await fbGet('tasks');
  if (!tasks) { console.log('📋 Nenhuma tarefa no Firebase'); return; }

  let created = 0, updated = 0, errors = 0;

  let skipped = 0;

  for (const [taskId, task] of Object.entries(tasks)) {
    try {
      // Valida se a tarefa tem dados mínimos
      if (!isValidTask(task)) {
        console.log(`⏭️ Pulando tarefa ${taskId}: sem título ou dados inválidos`);
        skipped++;
        continue;
      }

      if (task.notionPageId) {
        // Já existe no Notion → atualizar
        const ok = await notionUpdatePage(task.notionPageId, task);
        if (ok) updated++;
        else errors++;
      } else {
        // Não existe → criar
        const pageId = await notionCreatePage(task);
        if (pageId) {
          await fbSet(`tasks/${taskId}/notionPageId`, pageId);
          created++;
        } else {
          errors++;
        }
      }
      // Rate limit do Notion: 3 req/s
      await new Promise(r => setTimeout(r, 350));
    } catch(e) {
      console.error(`Sync error task ${taskId}:`, e.message);
      errors++;
    }
  }

  console.log(`✅ Sync completo: ${created} criadas, ${updated} atualizadas, ${skipped} puladas, ${errors} erros`);
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
      `\u{1F44B} Olá, ${from.first_name}!\n\n` +
      `Eu sou o <b>Task UP Bot</b> \u{1F680}\n\n` +
      `Para vincular sua conta:\n` +
      `1. Acesse <b>task.up.srv.br</b>\n` +
      `2. Clique no ícone \u{1F514}\n` +
      `3. Envie aqui: <code>/start SEU_CÓDIGO</code>`
    );
  }

  const users = await fbGet('users');
  if (!users) return sendMsg(chatId, '\u274C Nenhum usuário no sistema. Faça login no Task UP primeiro.');

  let matchUid = null, matchUser = null;
  for (const [uid, u] of Object.entries(users)) {
    if (uid.substring(0, 8) === code) {
      matchUid = uid;
      matchUser = u;
      break;
    }
  }

  if (!matchUid) return sendMsg(chatId, `\u274C Código <b>${code}</b> não encontrado. Verifique no Task UP (ícone \u{1F514}).`);

  const ok = await fbSet(`users/${matchUid}/telegramChatId`, chatId.toString());
  if (!ok) return sendMsg(chatId, '\u274C Erro ao salvar vinculação. Tente novamente.');

  console.log(`\u2705 Linked: ${matchUser.name} (${matchUid}) → Chat ${chatId}`);
  return sendMsg(chatId,
    `\u2705 <b>Vinculado com sucesso!</b>\n\n` +
    `\u{1F464} ${matchUser.name || matchUser.email}\n\n` +
    `Você receberá notificações de:\n` +
    `• \u{1F4CB} Novas tarefas atribuídas\n` +
    `• \u{1F504} Mudanças de status\n` +
    `• \u{1F4DD} Atualizações de tarefas\n\n` +
    `Use /tarefas para ver suas pendências.\n` +
    `Use /sync para sincronizar com Notion.`
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

  if (!myUid) return sendMsg(chatId, '\u274C Conta não vinculada. Use /start <código> para vincular.');
  if (!tasks) return sendMsg(chatId, '\u{1F4CB} Nenhuma tarefa no sistema.');

  const mine = Object.values(tasks)
    .filter(t => t.assignee === myUid && t.status !== 'Concluída')
    .sort((a, b) => {
      const ord = { 'Urgente': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };
      return (ord[a.priority] ?? 4) - (ord[b.priority] ?? 4);
    });

  if (!mine.length) return sendMsg(chatId, '\u{1F389} Nenhuma tarefa pendente! Bom trabalho!');

  const pEmoji = { 'Urgente': '\u{1F534}', 'Alta': '\u{1F7E0}', 'Média': '\u{1F7E1}', 'Baixa': '\u{1F7E2}' };
  let msg = `\u{1F4CB} <b>Suas Tarefas (${mine.length})</b>\n\n`;
  mine.forEach(t => {
    const e = pEmoji[t.priority] || '\u26AA';
    const s = t.status === 'Em Andamento' ? '\u{1F504}' : '\u{1F4CC}';
    const d = t.dueDate ? ` \u{1F4C5} ${new Date(parseInt(t.dueDate)).toLocaleDateString('pt-BR')}` : '';
    msg += `${s} ${e} <b>${t.title}</b>${d}\n`;
  });

  return sendMsg(chatId, msg);
}

async function handleStatus(chatId) {
  const [users, tasks] = await Promise.all([fbGet('users'), fbGet('tasks')]);
  const tList = tasks ? Object.values(tasks) : [];

  const notionStatus = NOTION_TOKEN ? '\u2705 Conectado' : '\u274C Não configurado';

  return sendMsg(chatId,
    `\u{1F4CA} <b>Task UP — Resumo</b>\n\n` +
    `\u{1F465} Usuários: ${users ? Object.keys(users).length : 0}\n` +
    `\u{1F4CB} Tarefas: ${tList.length}\n\n` +
    `\u{1F4CC} A Fazer: ${tList.filter(t => t.status === 'A Fazer').length}\n` +
    `\u{1F504} Em Andamento: ${tList.filter(t => t.status === 'Em Andamento').length}\n` +
    `\u2705 Concluídas: ${tList.filter(t => t.status === 'Concluída').length}\n\n` +
    `\u{1F4E1} Notion: ${notionStatus}`
  );
}

async function handleSync(chatId) {
  if (!NOTION_TOKEN) {
    return sendMsg(chatId, '\u274C Notion não configurado. Configure a variável NOTION_TOKEN no Render.');
  }

  await sendMsg(chatId, '\u{1F504} Sincronizando tarefas com o Notion...');

  const tasks = await fbGet('tasks');
  if (!tasks) return sendMsg(chatId, '\u{1F4CB} Nenhuma tarefa para sincronizar.');

  let created = 0, updated = 0, errors = 0, skipped = 0;

  for (const [taskId, task] of Object.entries(tasks)) {
    try {
      if (!isValidTask(task)) { skipped++; continue; }

      if (task.notionPageId) {
        const ok = await notionUpdatePage(task.notionPageId, task);
        if (ok) updated++; else errors++;
      } else {
        const pageId = await notionCreatePage(task);
        if (pageId) {
          await fbSet(`tasks/${taskId}/notionPageId`, pageId);
          created++;
        } else errors++;
      }
      await new Promise(r => setTimeout(r, 350));
    } catch(e) { errors++; }
  }

  return sendMsg(chatId,
    `\u2705 <b>Sync Completo!</b>\n\n` +
    `\u{1F195} Criadas no Notion: ${created}\n` +
    `\u{1F504} Atualizadas: ${updated}\n` +
    (skipped ? `\u23ED Puladas (sem título): ${skipped}\n` : '') +
    (errors ? `\u274C Erros: ${errors}\n` : '') +
    `\n\u{1F4CB} Total: ${Object.keys(tasks).length} tarefas`
  );
}

async function handleHelp(chatId) {
  return sendMsg(chatId,
    `\u{1F680} <b>Task UP Bot</b>\n\n` +
    `/start <código> — Vincular conta\n` +
    `/tarefas — Minhas tarefas pendentes\n` +
    `/status — Resumo geral\n` +
    `/sync — Sincronizar com Notion\n` +
    `/help — Comandos\n\n` +
    `\u{1F310} <b>task.up.srv.br</b>`
  );
}

// ======================== POLLING ========================
async function processMsg(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const from = msg.from;

  console.log(`\u{1F4E8} ${from.first_name} (${chatId}): ${text}`);

  if (text.startsWith('/start')) return handleStart(chatId, text, from);
  if (text === '/tarefas') return handleTarefas(chatId);
  if (text === '/status') return handleStatus(chatId);
  if (text === '/sync') return handleSync(chatId);
  if (text === '/help') return handleHelp(chatId);

  return sendMsg(chatId, 'Use /help para ver os comandos disponíveis \u{1F914}');
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
const http = require('http');
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    bot: 'Task UP Bot',
    notion: NOTION_TOKEN ? 'connected' : 'not configured',
    uptime: process.uptime()
  }));
}).listen(PORT, () => console.log(`\u{1F310} Health check on port ${PORT}`));

// ======================== AUTO SYNC (a cada 10 min) ========================
function startAutoSync() {
  if (!NOTION_TOKEN) {
    console.log('\u26A0\uFE0F Notion token não configurado — auto-sync desabilitado');
    return;
  }
  // Sync inicial após 30s
  setTimeout(() => syncFirebaseToNotion(), 30000);
  // Sync periódico a cada 10 min
  setInterval(() => syncFirebaseToNotion(), 10 * 60 * 1000);
  console.log('\u{1F504} Auto-sync Notion habilitado (a cada 10 min)');
}

// ======================== MAIN ========================
async function main() {
  console.log('\u{1F680} Task UP Bot starting...');
  console.log(`\u{1F4E1} Firebase: ${FB_URL}`);
  console.log(`\u{1F4DD} Notion: ${NOTION_TOKEN ? 'Configurado' : 'Não configurado'}`);

  // Registra comandos do menu
  await fetch(`${TG_API}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'start', description: 'Vincular conta Task UP' },
        { command: 'tarefas', description: 'Minhas tarefas pendentes' },
        { command: 'status', description: 'Resumo geral' },
        { command: 'sync', description: 'Sincronizar com Notion' },
        { command: 'help', description: 'Comandos disponíveis' }
      ]
    })
  });

  console.log('\u2705 Bot commands registered');

  // Inicia auto-sync com Notion
  startAutoSync();

  console.log('\u{1F4E1} Polling started...');
  while (true) { await poll(); }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
