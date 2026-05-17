/**
 * Agente IA para WhatsApp - interpreta intenção e executa ações.
 * Usa a API existente do dashboard com autenticação por token.
 */

import { getSession, setSession, clearSession, createLoginCode, verifyLoginCode, normalizePhone } from './sessions.js';
import User from '../models/User.js';
import Igreja from '../models/Igreja.js';
import { DEFAULT_IGREJA_SLUG } from '../tenant-context.js';
import { isPostgres, isMongo } from '../db/connection.js';
import {
  pgFindUsersByEmail, pgFindIgrejaBySlug, pgFindUserById, pgPopulateMinisterioIds,
} from '../db/postgres/repos.js';
import { getPostgresPool } from '../db/postgres/init.js';

/** Mesmo email em várias igrejas: prioriza conta do tenant legado (Celeiro) no WhatsApp. */
async function findUserForWhatsAppByEmail(emailLower) {
  if (isPostgres()) {
    const list = (await pgFindUsersByEmail(emailLower)).filter((u) => u.ativo !== false);
    if (list.length === 0) return null;
    if (list.length === 1) return list[0];
    const ig = await pgFindIgrejaBySlug(DEFAULT_IGREJA_SLUG);
    if (ig) {
      const hit = list.find((u) => u.igrejaId && String(u.igrejaId) === String(ig._id || ig.id));
      if (hit) return hit;
    }
    return list[0];
  }
  if (!isMongo()) return null;
  const list = await User.find({ email: emailLower, ativo: true }).lean();
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const ig = await Igreja.findOne({ slug: DEFAULT_IGREJA_SLUG }).select('_id').lean();
  if (ig) {
    const hit = list.find((u) => u.igrejaId && String(u.igrejaId) === String(ig._id));
    if (hit) return hit;
  }
  return list[0];
}

async function loadUserWithMinisterios(userId) {
  if (isPostgres()) {
    const u = await pgFindUserById(userId);
    if (!u) return null;
    const mins = u.ministerioIds?.length
      ? await pgPopulateMinisterioIds(u.ministerioIds, u.igrejaId)
      : [];
    return { ...u, ministerioIds: mins };
  }
  if (!isMongo()) return null;
  return await User.findById(userId).populate('ministerioIds', 'nome').lean();
}

async function saveUserWhatsapp(userId, phone) {
  if (isPostgres()) {
    await getPostgresPool().query('UPDATE users SET whatsapp = $2 WHERE id = $1', [userId, phone]).catch(() => {});
    return;
  }
  if (isMongo()) {
    await User.updateOne({ _id: userId }, { $set: { whatsapp: phone } }).catch(() => {});
  }
}

const API_BASE = (process.env.APP_URL || process.env.API_BASE || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
const GROK_API_KEY = (process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

const ACTIONS = {
  MENU: 'menu',
  PERFIL: 'perfil',
  CHECKIN_HOJE: 'checkin_hoje',
  MEUS_CHECKINS: 'meus_checkins',
  MINHAS_ESCALAS: 'minhas_escalas',
  CHECKINS_MINISTERIO: 'checkins_ministerio',
  ESCALA_VISAO: 'escala_visao',
  RESUMO: 'resumo',
  LISTAR_VOLUNTARIOS: 'listar_voluntarios',
  SAIR: 'sair',
};

/** System prompt por role */
function getSystemPrompt(role) {
  const base = `Você é o assistente do Dashboard Celeiro (igreja). Responda em português, de forma breve e clara para WhatsApp (máx ~500 caracteres por mensagem).
Identifique a intenção do usuário e responda com JSON no formato: {"action":"NOME_ACAO","params":{}} ou {"reply":"texto"} para respostas diretas.
Ações disponíveis:`;
  const vol = `${base}
- menu: mostrar opções
- perfil: ver perfil
- checkin_hoje: fazer check-in do dia
- meus_checkins: listar check-ins
- minhas_escalas: minhas escalas/candidaturas
- sair: encerrar sessão`;
  const lider = `${vol}
- checkins_ministerio: check-ins do meu ministério
- escala_visao: visão consolidada domingo (params: data DD/MM ou proximoDomingo true)`;
  const admin = `${lider}
- resumo: resumo de voluntários
- listar_voluntarios: listar voluntários (params: search, limit)
- escala_visao: visão consolidada escala manhã/tarde/almoco (params: data, proximoDomingo)`;
  if (role === 'admin') return admin;
  if (role === 'lider') return lider;
  return vol;
}

async function callLLM(systemPrompt, userMessage) {
  const apiKey = OPENAI_API_KEY || GROK_API_KEY;
  if (!apiKey) return { reply: 'Configuração de IA não disponível. Contate o administrador.' };
  const isOpenAI = !!OPENAI_API_KEY;
  const url = isOpenAI ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions';
  const model = isOpenAI ? 'gpt-4o-mini' : 'grok-2-latest';
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2,
      }),
    });
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    try {
      const json = JSON.parse(text);
      return json;
    } catch {
      return { reply: text || 'Não entendi. Tente novamente.' };
    }
  } catch (e) {
    console.error('LLM error:', e);
    return { reply: 'Erro ao processar. Tente novamente.' };
  }
}

async function executeAction(action, params, token, role) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  const get = (path) => fetch(`${API_BASE}${path}`, { headers }).then((r) => r.json());
  const post = (path, body) => fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());

  switch (action) {
    case ACTIONS.PERFIL: {
      const d = await get('/api/me/perfil');
      if (d.error) return d.error;
      const p = d.perfil || d;
      return `*Meu perfil*\nNome: ${p.nome || '-'}\nEmail: ${p.email || '-'}\nMinistério: ${p.ministerio || '-'}\nDisponibilidade: ${p.disponibilidade || '-'}`;
    }
    case ACTIONS.MEUS_CHECKINS: {
      const d = await get('/api/checkins');
      if (d.error) return d.error;
      const list = (d.checkins || []).slice(0, 10);
      if (!list.length) return 'Nenhum check-in registrado.';
      return '*Meus check-ins*\n' + list.map((c, i) => `${i + 1}. ${c.ministerio || '-'} - ${(c.timestamp || c.dataCheckin || '').toString().slice(0, 10)}`).join('\n');
    }
    case ACTIONS.MINHAS_ESCALAS: {
      const d = await get('/api/minhas-candidaturas');
      if (d && d.error) return d.error;
      const list = Array.isArray(d) ? d : (d?.candidaturas || []);
      if (!list.length) return 'Nenhuma candidatura encontrada.';
      return '*Minhas escalas*\n' + list.slice(0, 5).map((c, i) => `${i + 1}. ${c.escalaNome || '-'} - ${c.status || '-'}`).join('\n');
    }
    case ACTIONS.CHECKINS_MINISTERIO: {
      if (role !== 'admin' && role !== 'lider') return 'Acesso negado.';
      const d = await get('/api/checkins/ministerio?data=');
      if (d.error) return d.error;
      const list = (d.checkins || []).slice(0, 15);
      if (!list.length) return 'Nenhum check-in hoje.';
      return '*Check-ins do ministério*\n' + list.map((c, i) => `${i + 1}. ${c.nome || c.email} - ${(c.timestamp || '').slice(11, 16)}`).join('\n');
    }
    case ACTIONS.ESCALA_VISAO: {
      if (role !== 'admin' && role !== 'lider') return 'Acesso negado.';
      const q = new URLSearchParams({ formato: 'texto' });
      if (params?.data) q.set('data', String(params.data));
      if (params?.proximoDomingo) q.set('proximoDomingo', '1');
      if (!params?.data && !params?.proximoDomingo) q.set('proximoDomingo', '1');
      const d = await get(`/api/escalas/visao-consolidada?${q}`);
      if (d.error) return d.error;
      return d.texto || 'Sem escalas para esta data.';
    }
    case ACTIONS.RESUMO: {
      if (role !== 'admin') return 'Acesso negado.';
      const d = await get('/api/voluntarios');
      if (d.error) return d.error;
      const total = (d.voluntarios || []).length;
      const resumo = d.resumo || {};
      const areas = Array.isArray(resumo.areas) ? resumo.areas.slice(0, 5).map(([k, v]) => `${k}(${v})`).join(', ') : '';
      return `*Resumo*\nTotal: ${total} voluntários\n${areas ? 'Áreas: ' + areas : ''}`;
    }
    case ACTIONS.LISTAR_VOLUNTARIOS: {
      if (role !== 'admin') return 'Acesso negado.';
      const search = (params?.search || '').trim().slice(0, 50);
      const d = await get(`/api/voluntarios?search=${encodeURIComponent(search)}`);
      if (d.error) return d.error;
      const list = (d.voluntarios || []).slice(0, 10);
      if (!list.length) return 'Nenhum voluntário encontrado.';
      return '*Voluntários*\n' + list.map((v, i) => `${i + 1}. ${v.nome || '-'} (${v.email || '-'})`).join('\n');
    }
    case ACTIONS.MENU: {
      let m = '*Menu*\n1. Meu perfil\n2. Meus check-ins\n3. Minhas escalas';
      if (role === 'lider' || role === 'admin') {
        m += '\n4. Check-ins do ministério';
        m += '\n5. Visão escala domingo (escreva: *visão escala* ou *visão 17/05*)';
      }
      if (role === 'admin') m += '\n6. Resumo\n7. Listar voluntários';
      m += '\n8. Sair';
      return m;
    }
    case ACTIONS.SAIR:
      return null; // caller will clear session
    default:
      return 'Ação não reconhecida. Digite *menu* para ver opções.';
  }
}

/** Processa mensagem e retorna resposta em texto. createAuthTokenForUser(user) retorna token. */
export async function processMessage(whatsappId, text, sendCodeToWhatsApp, createAuthTokenForUser) {
  const phone = normalizePhone(whatsappId);
  const msg = (text || '').trim();
  if (!msg) return 'Envie uma mensagem.';

  let session = getSession(phone);

  // Login flow
  if (!session) {
    const lower = msg.toLowerCase();
    if (lower === 'oi' || lower === 'olá' || lower === 'ola' || lower === 'menu' || lower === 'inicio') {
      return 'Olá! Sou o assistente do Celeiro. Para continuar, digite seu *email* cadastrado na plataforma.';
    }
    if (msg.includes('@')) {
      const user = await findUserForWhatsAppByEmail(msg.trim().toLowerCase());
      if (!user) return 'Email não encontrado. Verifique ou peça ao admin para cadastrar.';
      const code = createLoginCode(user.email, phone);
      if (sendCodeToWhatsApp) {
        await sendCodeToWhatsApp(phone, code);
      }
      return `Código *${code}* enviado. Digite-o aqui para confirmar (válido por 10 min).`;
    }
    const code = String(msg).replace(/\D/g, '');
    if ((code.length === 4 || code.length === 6) && /^\d+$/.test(code)) {
      const verified = verifyLoginCode(phone, code);
      if (!verified) return 'Código inválido ou expirado. Tente novamente com seu email.';
      const { email } = verified;
      const row = await findUserForWhatsAppByEmail(email.toLowerCase());
      if (!row) return 'Código inválido ou expirado.';
      const userForSession = await loadUserWithMinisterios(row._id || row.id);
      if (!userForSession) return 'Código inválido ou expirado.';
      if (!createAuthTokenForUser) return 'Erro de configuração. Contate o admin.';
      const { token } = await createAuthTokenForUser(userForSession);
      setSession(phone, {
        userId: String(userForSession._id),
        token,
        role: (userForSession.role || 'voluntario').replace(/í/g, 'i').toLowerCase(),
        email: userForSession.email,
        nome: userForSession.nome,
      });
      await saveUserWhatsapp(userForSession._id, phone);
      return `Login feito, ${userForSession.nome}! Digite *menu* para ver opções.`;
    }
    return 'Para começar, digite seu email cadastrado.';
  }

  if (msg.toLowerCase() === 'sair') {
    clearSession(phone);
    return 'Sessão encerrada. Até logo!';
  }

  const lower = msg.toLowerCase();
  const role = session.role;
  if (role === 'admin' || role === 'lider') {
    const visaoMatch = lower.match(/vis[aã]o\s*(?:escala|consolidad|domingo)?|relat[oó]rio\s*escala|escala\s*domingo/);
    if (visaoMatch || lower.startsWith('visão') || lower.startsWith('visao')) {
      const dateMatch = msg.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
      const params = {};
      if (dateMatch) params.data = dateMatch[0];
      else if (/pr[oó]ximo\s*domingo|domingo/.test(lower)) params.proximoDomingo = true;
      else params.proximoDomingo = true;
      const out = await executeAction(ACTIONS.ESCALA_VISAO, params, session.token, session.role);
      return out || 'Sem dados.';
    }
  }

  const systemPrompt = getSystemPrompt(session.role);
  const llmOut = await callLLM(systemPrompt, msg);
  if (llmOut.reply) return llmOut.reply;
  if (llmOut.action) {
    if (llmOut.action === ACTIONS.SAIR) {
      clearSession(phone);
      return 'Sessão encerrada.';
    }
    const result = await executeAction(llmOut.action, llmOut.params || {}, session.token, session.role);
    return result || 'Pronto.';
  }
  return 'Não entendi. Digite *menu* para ver opções.';
}
