import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { Resend } from 'resend';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import multer from 'multer';
import User from './models/User.js';
import Voluntario from './models/Voluntario.js';
import Checkin from './models/Checkin.js';
import EventoCheckin from './models/EventoCheckin.js';
import Ministerio from './models/Ministerio.js';
import RoleHistory from './models/RoleHistory.js';
import Escala from './models/Escala.js';
import Candidatura from './models/Candidatura.js';
import { normalizarEstado, normalizarCidade } from './utils/normalize-locale.js';
import { createWhatsAppHandler } from './whatsapp/handler.js';
import { processBrdidWebhook, getLastVerification } from './brdid/whatsapp-verification.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UPLOADS_DIR = join(__dirname, 'uploads', 'avatars');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = (file.originalname && /\.(jpe?g|png|gif|webp)$/i.test(file.originalname))
      ? /\.(jpe?g|png|gif|webp)$/i.exec(file.originalname)[0].toLowerCase()
      : '.jpg';
    cb(null, `${req.userId}-${Date.now()}${ext}`);
  },
});
const uploadFoto = multer({
  storage,
  limits: { fileSize: 1024 * 1024 }, // 1 MB (foto já vem redimensionada do cliente)
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpe?g|png|gif|webp)$/i.test(file.mimetype)) {
      return cb(new Error('Apenas imagens (JPEG, PNG, GIF, WebP) são permitidas.'));
    }
    cb(null, true);
  },
});

const TZ_BRASILIA = process.env.TZ || process.env.APP_TIMEZONE || 'America/Sao_Paulo';

const app = express();
app.set('trust proxy', 1); // Necessário quando atrás de reverse proxy (Railway, Render, etc.)
const PORT = process.env.PORT || 3001;
const AUTH_TOKEN_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS || 24);
const ADMIN_USER = (process.env.ADMIN_USER || '').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || '').trim();
const SETUP_SECRET = (process.env.SETUP_SECRET || '').trim();

app.use(compression());
app.use(cors());

// WhatsApp webhook precisa do body raw para verificar assinatura (antes de express.json)
const createAuthTokenForUser = async (user) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
  let ministerioIds = Array.isArray(user.ministerioIds) ? user.ministerioIds : [];
  if (ministerioIds.length === 0 && user.ministerioId) ministerioIds = [user.ministerioId];
  const ministerioNomes = [];
  if (ministerioIds.length > 0) {
    const mins = await Ministerio.find({ _id: { $in: ministerioIds } }).select('nome').lean();
    mins.forEach(m => { if (m?.nome) ministerioNomes.push(m.nome); });
  }
  const ministerioId = ministerioIds[0] || null;
  const ministerioNome = ministerioNomes[0] || null;
  const roleNorm = String(user.role || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || 'voluntario';
  const roleFinal = roleNorm === 'lider' || roleNorm.includes('lider') ? 'lider' : roleNorm;
  authTokens.set(token, {
    user: user.nome, userId: user._id, role: roleFinal, email: user.email,
    ministerioId, ministerioNome, ministerioIds, ministerioNomes, expiresAt,
    mustChangePassword: !!user.mustChangePassword,
  });
  return token;
};
const whatsappHandler = createWhatsAppHandler({ createAuthTokenForUser });
app.get('/api/whatsapp/webhook', (req, res) => whatsappHandler.handleVerify(req, res));
app.post('/api/whatsapp/webhook', express.raw({ type: 'application/json' }), (req, res) => whatsappHandler.handleWebhook(req, res));

app.use(express.json());
app.use('/uploads', express.static(join(__dirname, 'uploads')));

const VOLUNTARIOS_CSV_PATH = (process.env.VOLUNTARIOS_CSV_PATH || '').trim();
const CHECKIN_CSV_PATH = (process.env.CHECKIN_CSV_PATH || '').trim();
const CSV_URL = process.env.GOOGLE_SHEETS_CSV_URL ||
  'https://docs.google.com/spreadsheets/d/1uTgaI8Ct_rPr1KwyDOPCH5SLqdzv0Bwxog0B9k-PbPo/export?format=csv&gid=1582636562';

// Cache em memória para voluntários e check-ins
const cache = {
  voluntarios: null,
  voluntariosTime: 0,
  checkins: null,
  checkinsTime: 0,
};
const CACHE_TTL = (Number(process.env.CACHE_TTL_MINUTES) || 30) * 60 * 1000;

const authTokens = new Map();

// Segurança: headers HTTP (Helmet) e rate limiting em rotas sensíveis
app.use(helmet({ contentSecurityPolicy: false })); // CSP desativado para não quebrar recursos estáticos/APIs
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 30,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
const cadastroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 h
  max: 20,
  message: { error: 'Muitos cadastros. Tente novamente mais tarde.' },
});
const publicCheckinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Muitas requisições. Aguarde um pouco.' },
});

app.use('/api/login', authLimiter);
app.use('/api/setup', authLimiter);
app.use('/api/auth/login-email', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/cadastro', cadastroLimiter);
app.use('/api/checkin-public', publicCheckinLimiter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// POST /api/cadastro - Cadastro público de voluntários (sem auth). Quem se cadastra é considerado voluntário. Padroniza estado (UF) e cidade.
function parseNascimento(val) {
  if (val == null) return undefined;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const NASCIMENTO_MIN = new Date(1920, 0, 1);
const NASCIMENTO_MAX = new Date(2015, 11, 31);
function validarNascimento(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return false;
  const t = d.getTime();
  return t >= NASCIMENTO_MIN.getTime() && t <= NASCIMENTO_MAX.getTime();
}

/** Retorna apenas dígitos do WhatsApp (10 ou 11) ou null se inválido. */
function normalizarWhatsapp(val) {
  if (val == null || val === '') return undefined;
  const digits = String(val).replace(/\D/g, '');
  if (digits.length === 0) return undefined;
  if (digits.length !== 10 && digits.length !== 11) return null;
  return digits;
}

app.post('/api/cadastro', async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'Serviço temporariamente indisponível. Tente em instantes.');

    const body = req.body || {};
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');

    const whatsappNorm = normalizarWhatsapp(body.whatsapp);
    if (body.whatsapp != null && body.whatsapp !== '' && whatsappNorm === null) return sendError(res, 400, 'WhatsApp inválido. Informe 10 ou 11 dígitos (DDD + número).');
    const nascimentoParsed = parseNascimento(body.nascimento);
    if (body.nascimento != null && body.nascimento !== '' && nascimentoParsed != null && !validarNascimento(nascimentoParsed)) return sendError(res, 400, 'Data de nascimento deve estar entre 1920 e 2015.');
    const nome = (body.nome || '').trim();
    const nascimento = nascimentoParsed;
    const whatsapp = whatsappNorm !== undefined && whatsappNorm !== null ? whatsappNorm : (body.whatsapp || '').trim() || undefined;
    const pais = (body.pais || '').trim();
    let estado = normalizarEstado((body.estado || '').trim());
    let cidade = normalizarCidade((body.cidade || '').trim());
    const evangelico = (body.evangelico || '').trim();
    const igreja = (body.igreja || '').trim();
    const tempoIgreja = (body.tempoIgreja || '').trim();
    const voluntarioIgreja = (body.voluntarioIgreja || '').trim();
    const ministerio = (body.ministerio || '').trim();
    const disponibilidade = (body.disponibilidade || '').trim();
    const horasSemana = (body.horasSemana || '').trim();
    const areasRaw = body.areas;
    const areas = Array.isArray(areasRaw)
      ? areasRaw.map(a => String(a).trim()).filter(Boolean)
      : (typeof areasRaw === 'string' ? areasRaw.split(',').map(a => a.trim()).filter(Boolean) : []);
    const testemunho = (body.testemunho || '').trim() || undefined;

    const doc = {
      email,
      nome: nome || undefined,
      nascimento: nascimento || undefined,
      whatsapp: whatsapp || undefined,
      pais: pais || undefined,
      estado: estado || undefined,
      cidade: cidade || undefined,
      evangelico: evangelico || undefined,
      igreja: igreja || undefined,
      tempoIgreja: tempoIgreja || undefined,
      voluntarioIgreja: voluntarioIgreja || undefined,
      ministerio: ministerio || undefined,
      disponibilidade: disponibilidade || undefined,
      horasSemana: horasSemana || undefined,
      areas,
      testemunho,
      fonte: 'manual',
      ativo: true,
    };
    const clean = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));

    const existing = await Voluntario.findOne({ email });
    if (existing) {
      await Voluntario.updateOne({ email }, { $set: clean });
      return res.status(200).json({ ok: true, message: 'Cadastro atualizado com sucesso.' });
    }
    await Voluntario.create(clean);
    invalidateCache();
    return res.status(201).json({ ok: true, message: 'Cadastro realizado com sucesso.' });
  } catch (err) {
    console.error(err);
    return sendError(res, 500, err.message || 'Erro ao salvar cadastro.');
  }
});

function getAuthToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const headerToken = req.headers['x-auth-token'];
  return headerToken ? String(headerToken).trim() : '';
}

function isTokenExpired(data) {
  if (!data?.expiresAt) return false;
  return Date.now() > data.expiresAt;
}

function requireAuth(req, res, next) {
  const token = getAuthToken(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  const data = authTokens.get(token);
  if (!data || isTokenExpired(data)) {
    authTokens.delete(token);
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
  req.user = data.user;
  req.userId = data.userId;
  req.userRole = data.role || 'admin';
  req.userEmail = data.email || null;
  req.userMinisterioId = data.ministerioId || null;
  req.userMinisterioNome = data.ministerioNome || null;
  req.userMinisterioIds = Array.isArray(data.ministerioIds) ? data.ministerioIds : [];
  req.userMinisterioNomes = Array.isArray(data.ministerioNomes) ? data.ministerioNomes : (data.ministerioNome ? [data.ministerioNome] : []);
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  next();
}

const MASTER_ADMIN_EMAIL = (process.env.MASTER_ADMIN_EMAIL || '').trim().toLowerCase();

function requireMasterAdmin(req, res, next) {
  const email = (req.userEmail || '').toString().trim().toLowerCase();
  if (!MASTER_ADMIN_EMAIL || email !== MASTER_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Acesso negado. Apenas o administrador master pode realizar esta ação.' });
  }
  next();
}

function requireAdminOrLider(req, res, next) {
  if (req.userRole !== 'admin' && req.userRole !== 'lider') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores ou líderes de ministério.' });
  }
  next();
}

// ─── BR DID – Webhook verificação WhatsApp (https://brdid.com.br/api-docs/) ───
// POST: recebe dados da chamada/áudio quando WhatsApp envia código de verificação
app.post('/api/brdid/whatsapp-verification', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await processBrdidWebhook(payload);
    res.status(200).json({ status: 'ok', recebido: true, codigo: result.codigo_extraido || null });
  } catch (err) {
    console.error('BR DID webhook erro:', err);
    res.status(500).json({ status: 'erro', message: err.message });
  }
});
// GET: admin consulta último código recebido (para digitar no WhatsApp Business)
app.get('/api/brdid/whatsapp-verification/latest', requireAuth, requireAdmin, (req, res) => {
  const last = getLastVerification();
  if (!last) return res.json({ codigo: null, mensagem: 'Nenhum código recebido ainda. Configure o webhook no BR DID e inicie a verificação no WhatsApp Business.' });
  res.json({
    codigo: last.codigo_extraido || null,
    numero: last.numero || null,
    recebidoEm: last.recebidoEm || null,
    url_audio: last.url_audio || null,
  });
});

// Funções de cache
function invalidateCache() {
  cache.voluntarios = null;
  cache.voluntariosTime = 0;
  cache.checkins = null;
  cache.checkinsTime = 0;
}

/** Garante que o email esteja na lista de voluntários (mesmo com dados incompletos). Usado em registro, role voluntário e check-in. */
async function ensureVoluntarioInList({ email, nome, ministerio }) {
  const em = (email || '').toString().trim().toLowerCase();
  if (!em || !em.includes('@')) return null;
  const setFields = {};
  const nomeStr = (nome || '').toString().trim();
  if (nomeStr) setFields.nome = nomeStr;
  const minStr = (ministerio || '').toString().trim();
  if (minStr) setFields.ministerio = minStr;
  const update = {
    $setOnInsert: { email: em, ativo: true, fonte: 'manual', timestamp: new Date(), timestampMs: Date.now() },
    ...(Object.keys(setFields).length ? { $set: setFields } : {}),
  };
  const doc = await Voluntario.findOneAndUpdate(
    { email: em },
    update,
    { upsert: true, new: true }
  ).lean();
  return doc;
}

/** Vincula ao usuário os check-ins feitos pelo mesmo email antes de criar conta (ex.: link público). Válido para legado. */
async function vincularCheckinsAoUsuario(userId, email) {
  if (!userId || !email || !String(email).includes('@')) return;
  const em = String(email).trim().toLowerCase();
  const result = await Checkin.updateMany(
    { email: em, $or: [{ userId: null }, { userId: { $exists: false } }] },
    { $set: { userId } }
  );
  if (result.modifiedCount > 0) invalidateCache();
}

/** Legado: garante que todos os usuários (conta) tenham check-ins vinculados e estejam na lista de voluntários. */
async function syncLegadoVoluntarios() {
  try {
    const users = await User.find({}).select('email nome').lean();
    let linked = 0;
    for (const u of users) {
      const em = (u.email || '').toString().trim().toLowerCase();
      if (!em || !em.includes('@')) continue;
      try {
        const r = await Checkin.updateMany(
          { email: em, $or: [{ userId: null }, { userId: { $exists: false } }] },
          { $set: { userId: u._id } }
        );
        if (r.modifiedCount > 0) { linked += r.modifiedCount; }
        await ensureVoluntarioInList({ email: em, nome: (u.nome || '').toString().trim() });
      } catch (_) {}
    }
    if (linked > 0) {
      invalidateCache();
      console.log(`✅ syncLegadoVoluntarios: ${linked} check-in(s) vinculados a usuários existentes.`);
    }
  } catch (err) {
    console.warn('syncLegadoVoluntarios:', err?.message || err);
  }
}

function isCacheValid(key) {
  if (!cache[key]) return false;
  return Date.now() - cache[`${key}Time`] < CACHE_TTL;
}

function parseDatePtBr(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const match = v.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function formatDatePtBr(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { timeZone: TZ_BRASILIA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function sendError(res, status, message, details) {
  const payload = { error: message };
  if (details) payload.details = details;
  return res.status(status).json(payload);
}

async function readCsvTextFromSource({ path, url }) {
  if (path) {
    if (!fs.existsSync(path)) {
      throw new Error(`CSV não encontrado: ${path}. Verifique o caminho em VOLUNTARIOS_CSV_PATH/CHECKIN_CSV_PATH.`);
    }
    return fs.readFileSync(path, 'utf8');
  }
  if (!url) throw new Error('CSV não configurado.');
  const r = await fetch(url, { headers: { 'User-Agent': 'CeleiroDashboard/1.0' } });
  if (!r.ok) throw new Error(`Planilha não acessível (HTTP ${r.status}).`);
  return r.text();
}

// Busca coluna por substring no header (planilha pode ter nomes longos/truncados)
const COLS = {
  timestamp: ['Carimbo', 'data/hora'],
  email: ['Endereço de e-mail', 'E-mail', 'e-mail'],
  nome: ['Nome completo', 'sem abreviações'],
  nascimento: ['Data de nascimento', 'nascimento'],
  whatsapp: ['WhatsApp', 'Número do WhatsApp'],
  pais: ['País'],
  estado: ['Estado', 'Província', 'Região'],
  cidade: ['Cidade'],
  evangelico: ['Cristão', 'Protestante', 'Evangélico'],
  igreja: ['igreja onde congrega', 'Nome da igreja'],
  tempo_igreja: ['quanto tempo frequenta'],
  voluntario_igreja: ['voluntário em sua igreja', 'Já serve como voluntário'],
  ministerio: ['qual ministério serve', 'ministério serve'],
  disponibilidade: ['disponibilidade'],
  horas_semana: ['Horas que pode', 'horas por semana'],
  areas: ['áreas gostaria de servir', 'Em quais áreas'],
};

const CHECKIN_COLS = {
  timestamp: ['Carimbo', 'data/hora'],
  email: ['Endereço de e-mail', 'E-mail', 'e-mail'],
  nome: ['Nome completo', 'nome completo'],
  ministerio: ['ministério', 'ministerio', 'servir hoje'],
};

function findColIndex(headers, key) {
  const terms = COLS[key];
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] || '').toLowerCase();
    if (terms.some(t => h.includes(t.toLowerCase()))) return i;
  }
  return -1;
}

function rowToVoluntario(headers, row, colMap) {
  const get = (key) => {
    const i = colMap[key];
    return i >= 0 && row[i] !== undefined ? String(row[i]).trim() : '';
  };
  const email = get('email');
  if (!email || !email.includes('@')) return null;
  const timestamp = get('timestamp');
  const timestampMs = parseDatePtBr(timestamp);
  const nascimento = get('nascimento');
  const nascimentoMs = parseDatePtBr(nascimento);
  return {
    email: email.toLowerCase(),
    nome: get('nome'),
    nascimento: nascimentoMs ? new Date(nascimentoMs) : undefined,
    whatsapp: get('whatsapp'),
    pais: get('pais'),
    estado: normalizarEstado(get('estado')),
    cidade: normalizarCidade(get('cidade')),
    evangelico: get('evangelico'),
    igreja: get('igreja'),
    tempoIgreja: get('tempo_igreja'),
    voluntarioIgreja: get('voluntario_igreja'),
    ministerio: get('ministerio'),
    disponibilidade: get('disponibilidade'),
    horasSemana: get('horas_semana'),
    areas: get('areas').split(',').map(a => a.trim()).filter(Boolean),
    timestamp: timestampMs ? new Date(timestampMs) : undefined,
    timestampMs,
  };
}

function rowToCheckin(headers, row, colMap) {
  const get = (key) => {
    const i = colMap[key];
    return i >= 0 && row[i] !== undefined ? String(row[i]).trim() : '';
  };
  const email = get('email');
  if (!email || !email.includes('@')) return null;
  const timestamp = get('timestamp');
  const timestampMs = parseDatePtBr(timestamp);
  const dataCheckinStr = timestampMs ? new Date(timestampMs).toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA }) : null;
  const dataCheckin = dataCheckinStr ? getDayRangeBrasilia(dataCheckinStr).start : null;
  return {
    email: email.toLowerCase(),
    nome: get('nome'),
    ministerio: get('ministerio'),
    timestamp,
    timestampMs,
    dataCheckin,
  };
}

function parseCsvRows(text) {
  return parse(text, { relax_column_count: true, skip_empty_lines: true, trim: true });
}

function buildColMap(headers, cols) {
  const colMap = {};
  Object.keys(cols).forEach(k => { colMap[k] = findColIndex(headers, k); });
  return colMap;
}

async function syncVoluntariosFromText(text) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB não conectado. Configure MONGODB_URI no .env.');
  }
  const rows = parseCsvRows(text);
  if (!rows.length) return { inserted: 0, updated: 0 };
  const headers = rows[0].map(h => (h || '').trim());
  const colMap = buildColMap(headers, COLS);
  const voluntarios = rows.slice(1).map(row => rowToVoluntario(headers, row, colMap)).filter(Boolean);
  const byEmail = new Map();
  voluntarios.forEach(v => byEmail.set(v.email.toLowerCase(), v));
  const unique = Array.from(byEmail.values());

  const operations = unique.map(doc => ({
    updateOne: {
      filter: { email: doc.email.toLowerCase() },
      update: { $set: doc },
      upsert: true
    }
  }));
  const result = await Voluntario.bulkWrite(operations, { ordered: false });
  invalidateCache();
  return { inserted: result.upsertedCount || 0, updated: result.modifiedCount || 0 };
}

async function syncCheckinsFromText(text) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB não conectado. Configure MONGODB_URI no .env.');
  }
  const rows = parseCsvRows(text);
  if (!rows.length) return { inserted: 0, updated: 0 };
  const headers = rows[0].map(h => (h || '').trim());
  const colMap = buildColMap(headers, CHECKIN_COLS);
  const checkins = rows.slice(1).map(row => rowToCheckin(headers, row, colMap)).filter(Boolean);

  // Dedup by email + ministerio + timestampMs
  const byKey = new Map();
  checkins.forEach(c => {
    const key = `${c.email}-${c.ministerio}-${c.timestampMs || 0}`;
    byKey.set(key, c);
  });
  const unique = Array.from(byKey.values());

  const operations = unique.map(doc => ({
    updateOne: {
      filter: { email: doc.email, ministerio: doc.ministerio, timestampMs: doc.timestampMs },
      update: { $set: doc },
      upsert: true
    }
  }));
  const result = await Checkin.bulkWrite(operations, { ordered: false });
  invalidateCache();
  return { inserted: result.upsertedCount || 0, updated: result.modifiedCount || 0 };
}

async function syncVoluntarios() {
  const text = await readCsvTextFromSource({
    path: VOLUNTARIOS_CSV_PATH,
    url: VOLUNTARIOS_CSV_PATH ? '' : CSV_URL,
  });
  return await syncVoluntariosFromText(text);
}

async function syncCheckins() {
  const text = await readCsvTextFromSource({
    path: CHECKIN_CSV_PATH,
    url: '',
  });
  return await syncCheckinsFromText(text);
}

// Setup inicial: criar primeiro admin (após deploy). Protegido por SETUP_SECRET.
app.get('/api/setup/status', async (_req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ needsSetup: false, error: 'MongoDB não conectado. Configure MONGODB_URI no Railway.' });
    }
    const hasAdmin = await User.exists({ role: 'admin' });
    res.json({ needsSetup: !!SETUP_SECRET && !hasAdmin });
  } catch (err) {
    res.status(500).json({ needsSetup: false, error: err.message });
  }
});

app.post('/api/setup', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB não conectado. Configure MONGODB_URI nas variáveis do Railway e faça redeploy.' });
    }
    const { secret, email, nome, senha } = req.body || {};
    if (!SETUP_SECRET) return res.status(400).json({ error: 'Setup não configurado no servidor.' });
    if (String(secret).trim() !== SETUP_SECRET) return res.status(403).json({ error: 'Código de setup inválido.' });
    const emailVal = (email || '').trim().toLowerCase();
    const nomeVal = (nome || '').trim();
    const senhaVal = (senha || '').trim();
    if (!emailVal || !emailVal.includes('@')) return res.status(400).json({ error: 'Email válido é obrigatório.' });
    if (!nomeVal) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (!senhaVal || senhaVal.length < 6) return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres.' });

    const hasAdmin = await User.exists({ role: 'admin' });
    if (hasAdmin) return res.status(400).json({ error: 'Já existe um admin. Use login normal.' });

    const existing = await User.findOne({ email: emailVal });
    if (existing) return res.status(400).json({ error: 'Este email já está cadastrado. Use outra conta ou faça login.' });

    const user = new User({ email: emailVal, nome: nomeVal, senha: senhaVal, role: 'admin' });
    await user.save();
    res.status(201).json({ ok: true, message: 'Admin criado. Faça login com este email e senha.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao criar admin.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password, email } = req.body || {};
    const login = String(email || username || '').trim();
    const senha = String(password || '').trim();
    if (!login || !senha) return res.status(400).json({ error: 'Envie email/usuário e senha.' });

    // 1) Tentar login admin (username do .env)
    if (ADMIN_USER && ADMIN_PASS && login === ADMIN_USER && senha === ADMIN_PASS) {
      let adminFotoUrl = null;
      try {
        const adminUser = await User.findOne({ email: String(ADMIN_USER).toLowerCase() }).select('fotoUrl').lean();
        if (adminUser && adminUser.fotoUrl) adminFotoUrl = adminUser.fotoUrl;
      } catch (_) {}
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
      authTokens.set(token, { user: ADMIN_USER, userId: null, role: 'admin', email: null, expiresAt });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json({
        token,
        user: { nome: ADMIN_USER, email: null, role: 'admin', fotoUrl: adminFotoUrl },
        expiresAt,
      });
    }

    // 2) Login por email (User/voluntário)
    const user = await User.findOne({ email: login.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    if (!user.ativo) return res.status(403).json({ error: 'Usuário desativado.' });
    const valida = await user.compararSenha(senha);
    if (!valida) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    user.ultimoAcesso = new Date();
    await user.save();

    const mustChangePassword = user.mustChangePassword === true;
    let ministerioIds = Array.isArray(user.ministerioIds) ? user.ministerioIds : [];
    if (ministerioIds.length === 0 && user.ministerioId) {
      ministerioIds = [user.ministerioId];
      user.ministerioIds = ministerioIds;
      await user.save();
    }
    const ministerioNomes = [];
    if (ministerioIds.length > 0) {
      const mins = await Ministerio.find({ _id: { $in: ministerioIds } }).select('nome').lean();
      mins.forEach(m => { if (m && m.nome) ministerioNomes.push(m.nome); });
    }
    const ministerioId = ministerioIds[0] || null;
    const ministerioNome = ministerioNomes[0] || null;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    const roleNorm = String(user.role || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || 'voluntario';
    const roleFinal = roleNorm === 'lider' || roleNorm.includes('lider') ? 'lider' : roleNorm;
    authTokens.set(token, { user: user.nome, userId: user._id, role: roleFinal, email: user.email, ministerioId, ministerioNome, ministerioIds, ministerioNomes, expiresAt, mustChangePassword });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const isMasterAdmin = MASTER_ADMIN_EMAIL && (user.email || '').toString().trim().toLowerCase() === MASTER_ADMIN_EMAIL;
    return res.json({ token, user: { nome: user.nome, email: user.email, role: roleFinal, ministerioId, ministerioNome, ministerioIds, ministerioNomes, fotoUrl: user.fotoUrl || null, mustChangePassword, isMasterAdmin }, expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao fazer login.' });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  let displayName = req.user;
  let fotoUrl = null;
  let mustChangePassword = false;
  let role = req.userRole;
  let ministerioId = req.userMinisterioId;
  let ministerioNome = req.userMinisterioNome;
  let ministerioIds = req.userMinisterioIds || [];
  let ministerioNomes = req.userMinisterioNomes || [];
  try {
    let userEmail = req.userEmail;
    if (req.userId) {
      const user = await User.findById(req.userId).select('nome fotoUrl mustChangePassword email role ministerioIds').lean();
      if (user) {
        if (user.nome) displayName = user.nome;
        if (user.fotoUrl) fotoUrl = user.fotoUrl;
        if (user.mustChangePassword) mustChangePassword = true;
        if (user.email) userEmail = user.email;
        if (user.role) {
          const r = String(user.role).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          role = r === 'lider' || r.includes('lider') ? 'lider' : r;
        }
        if (user.ministerioIds && user.ministerioIds.length > 0) {
          ministerioIds = user.ministerioIds.map(id => id);
          const mins = await Ministerio.find({ _id: { $in: ministerioIds } }).select('nome').lean();
          ministerioNomes = mins.map(m => m?.nome).filter(Boolean);
          ministerioId = ministerioIds[0] || null;
          ministerioNome = ministerioNomes[0] || null;
        }
      }
    } else if (req.userRole === 'admin' && ADMIN_USER) {
      const adminUser = await User.findOne({ email: String(ADMIN_USER).toLowerCase() }).select('fotoUrl').lean();
      if (adminUser && adminUser.fotoUrl) fotoUrl = adminUser.fotoUrl;
    }
    const email = userEmail;
    if (email) {
      const vol = await Voluntario.findOne({ email: email.toLowerCase() }).select('nome').lean();
      if (vol && vol.nome && String(vol.nome).trim()) displayName = vol.nome.trim();
    }
  } catch (_) {}
  const roleNorm = String(role || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const roleFinal = roleNorm === 'lider' || roleNorm.includes('lider') ? 'lider' : roleNorm;
  const payload = { user: displayName, role: roleFinal, email: req.userEmail };
  if (fotoUrl) payload.fotoUrl = fotoUrl;
  if (mustChangePassword) payload.mustChangePassword = true;
  if ((ministerioIds && ministerioIds.length) || ministerioId) {
    payload.ministerioId = ministerioId;
    payload.ministerioNome = ministerioNome;
    payload.ministerioIds = ministerioIds || [];
    payload.ministerioNomes = ministerioNomes || [];
  }
  if (MASTER_ADMIN_EMAIL) {
    payload.isMasterAdmin = (req.userEmail || '').toString().trim().toLowerCase() === MASTER_ADMIN_EMAIL;
  }
  res.json(payload);
});

// Upload de foto de perfil (todos os usuários autenticados)
app.post('/api/me/foto', requireAuth, (req, res, next) => {
  uploadFoto.single('foto')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 400, 'Arquivo muito grande. Máximo 1 MB.');
      return sendError(res, 400, err.message || 'Erro no upload.');
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file || !req.file.path) return sendError(res, 400, 'Nenhum arquivo enviado.');
    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 404, 'Usuário não encontrado.');
    const oldPath = user.fotoUrl ? join(UPLOADS_DIR, user.fotoUrl.split('/').pop() || '') : null;
    const relativePath = '/uploads/avatars/' + req.file.filename;
    user.fotoUrl = relativePath;
    await user.save();
    if (oldPath && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (_) {}
    }
    res.json({ fotoUrl: relativePath });
  } catch (err) {
    console.error(err);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    sendError(res, 500, err.message || 'Erro ao salvar foto.');
  }
});

// Remover foto de perfil
app.delete('/api/me/foto', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return sendError(res, 404, 'Usuário não encontrado.');
    const oldPath = user.fotoUrl ? join(UPLOADS_DIR, (user.fotoUrl.split('/').pop() || '')) : null;
    user.fotoUrl = null;
    await user.save();
    if (oldPath && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch (_) {}
    }
    res.json({ fotoUrl: null });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao remover foto.');
  }
});

app.post('/api/logout', requireAuth, (req, res) => {
  authTokens.delete(req.token);
  invalidateCache();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ ok: true });
});

app.get('/api/voluntarios', requireAuth, requireAdminOrLider, async (req, res) => {
  try {
    const isLider = req.userRole === 'lider';
    const ministerioNomes = (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean);

    const buildResumo = (list) => {
      const areasCount = {};
      const dispCount = {};
      (list || []).forEach(v => {
        (v.areas || '').split(',').map(a => a.trim()).filter(Boolean).forEach(a => {
          areasCount[a] = (areasCount[a] || 0) + 1;
        });
        (v.disponibilidade || '').split(',').map(d => d.trim()).filter(Boolean).forEach(d => {
          dispCount[d] = (dispCount[d] || 0) + 1;
        });
      });
      return {
        total: (list || []).length,
        areas: Object.entries(areasCount).sort((a, b) => b[1] - a[1]),
        disponibilidade: Object.entries(dispCount).sort((a, b) => b[1] - a[1]),
      };
    };

    const filterByMinisterio = (list) => {
      if (!isLider || ministerioNomes.length === 0) return list || [];
      return (list || []).filter((v) => {
        const m = (v.ministerio || '').toString().trim();
        return ministerioNomes.some((n) => n === m);
      });
    };

    if (isCacheValid('voluntarios') && cache.voluntarios && Array.isArray(cache.voluntarios.voluntarios)) {
      if (!isLider) return res.json(cache.voluntarios);
      const filteredCached = filterByMinisterio(cache.voluntarios.voluntarios);
      return res.json({
        voluntarios: filteredCached,
        resumo: buildResumo(filteredCached),
      });
    }

    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) {
      return sendError(res, 500, 'MongoDB não conectado. Configure MONGODB_URI no .env.');
    }

    let voluntarios = await Voluntario.find({ ativo: true }).lean();

    if (voluntarios.length === 0 && (VOLUNTARIOS_CSV_PATH || CSV_URL)) {
      await syncVoluntarios();
      voluntarios = await Voluntario.find({ ativo: true }).lean();
    }

    // Para líder, evita o bloco pesado de upsert em toda request (causa lentidão/travamento).
    if (!isLider) {
      // Incluir na lista toda conta com role voluntário e todo email que fez check-in (batch em uma única ida ao DB)
      const existingEmails = new Set(voluntarios.map(v => (v.email || '').toLowerCase().trim()).filter(Boolean));
      const toInsert = []; // { email, nome? }
      try {
        const usersVoluntarios = await User.find({ role: 'voluntario' }).select('email nome').lean();
        (usersVoluntarios || []).forEach(u => {
          const em = (u.email || '').toLowerCase().trim();
          if (em && em.includes('@') && !existingEmails.has(em)) {
            toInsert.push({ email: em, nome: (u.nome || '').toString().trim() });
            existingEmails.add(em);
          }
        });
        const checkinEmails = await Checkin.distinct('email').then(arr => (arr || []).map(e => (e || '').toLowerCase().trim()).filter(Boolean));
        checkinEmails.forEach(em => {
          if (em && em.includes('@') && !existingEmails.has(em)) {
            toInsert.push({ email: em });
            existingEmails.add(em);
          }
        });
        if (toInsert.length > 0) {
          const ops = toInsert.map(({ email, nome }) => ({
            updateOne: {
              filter: { email },
              update: {
                $setOnInsert: {
                  email,
                  ativo: true,
                  fonte: 'manual',
                  timestamp: new Date(),
                  timestampMs: Date.now(),
                  ...(nome ? { nome } : {}),
                },
              },
              upsert: true,
            },
          }));
          await Voluntario.bulkWrite(ops, { ordered: false });
          voluntarios = await Voluntario.find({ ativo: true }).lean();
        }
      } catch (e) { /* não falhar a listagem */ }
    }

    if (voluntarios.length === 0) {
      return res.json({ voluntarios: [], resumo: { total: 0, areas: [], disponibilidade: [] } });
    }

    const normalizedAll = voluntarios.map(v => ({
      ...v,
      areas: Array.isArray(v.areas) ? v.areas.join(', ') : (v.areas || ''),
      disponibilidade: Array.isArray(v.disponibilidade) ? v.disponibilidade.join(', ') : (v.disponibilidade || ''),
    }));

    const emails = [...new Set(normalizedAll.map(v => (v.email || '').toLowerCase().trim()).filter(Boolean))];
    const usersByEmail = {};
    if (emails.length > 0) {
      const users = await User.find({ email: { $in: emails } }).select('email fotoUrl').lean();
      users.forEach(u => { if (u.email) usersByEmail[u.email.toLowerCase()] = u.fotoUrl || null; });
    }
    normalizedAll.forEach(v => {
      v.fotoUrl = usersByEmail[(v.email || '').toLowerCase()] || null;
    });

    const fullData = {
      voluntarios: normalizedAll,
      resumo: buildResumo(normalizedAll),
    };
    cache.voluntarios = fullData;
    cache.voluntariosTime = Date.now();

    if (!isLider) return res.json(fullData);

    const filtered = filterByMinisterio(normalizedAll);
    return res.json({
      voluntarios: filtered,
      resumo: buildResumo(filtered),
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao carregar voluntários');
  }
});

// Lista só os emails (para "selecionar todos" no front, com os mesmos filtros)
app.get('/api/voluntarios/emails', requireAuth, requireAdminOrLider, async (req, res) => {
  try {
    const isLider = req.userRole === 'lider';
    const ministerioNomes = (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean);

    let list = [];
    if (!isLider && isCacheValid('voluntarios') && cache.voluntarios && Array.isArray(cache.voluntarios.voluntarios)) {
      list = cache.voluntarios.voluntarios;
    } else {
      let raw = await Voluntario.find({ ativo: true }).lean();
      if (isLider && ministerioNomes.length > 0) {
        raw = raw.filter((v) => {
          const m = (v.ministerio || '').toString().trim();
          return ministerioNomes.some((n) => n === m);
        });
      }
      list = raw.map(v => ({
        ...v,
        areas: Array.isArray(v.areas) ? v.areas.join(', ') : (v.areas || ''),
        disponibilidade: Array.isArray(v.disponibilidade) ? v.disponibilidade.join(', ') : (v.disponibilidade || ''),
      }));
    }
    const { areas: areasParam, disponibilidade, estado, cidade, comCheckin, q } = req.query || {};
    const areasFilter = areasParam ? (typeof areasParam === 'string' ? areasParam.split(',').map(s => s.trim()).filter(Boolean) : []) : [];
    const qLower = (q && typeof q === 'string') ? q.trim().toLowerCase() : '';
    let checkinEmails = new Set();
    if (comCheckin) {
      checkinEmails = new Set(await Checkin.distinct('email').then(arr => (arr || []).map(e => (e || '').toLowerCase().trim()).filter(Boolean)));
    }
    const filtered = list.filter(v => {
      if (qLower) {
        const nome = (v.nome || '').toLowerCase();
        const email = (v.email || '').toLowerCase();
        const cidadeStr = (v.cidade || '').toLowerCase();
        const areasStr = (v.areas || '').toLowerCase();
        if (!nome.includes(qLower) && !email.includes(qLower) && !cidadeStr.includes(qLower) && !areasStr.includes(qLower)) return false;
      }
      if (areasFilter.length > 0) {
        const volAreas = (v.areas || '').split(',').map(a => a.trim()).filter(Boolean);
        if (!areasFilter.some(fa => volAreas.includes(fa))) return false;
      }
      if (disponibilidade) {
        const disp = (v.disponibilidade || '').split(',').map(d => d.trim());
        if (!disp.includes(disponibilidade)) return false;
      }
      if (estado && String(v.estado || '').trim() !== estado) return false;
      if (cidade && String(v.cidade || '').trim() !== cidade) return false;
      if (comCheckin) {
        const em = (v.email || '').toLowerCase().trim();
        const tem = checkinEmails.has(em);
        if (comCheckin === 'com' && !tem) return false;
        if (comCheckin === 'sem' && tem) return false;
      }
      return true;
    });
    const emails = [...new Set(filtered.map(v => (v.email || '').toLowerCase().trim()).filter(Boolean))];
    res.json({ emails });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao listar emails');
  }
});

app.get('/api/checkins', requireAuth, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado. Configure MONGODB_URI no .env.');

    const isAdmin = req.userRole === 'admin';
    const { data: dataFiltro, eventoId, ministerio } = req.query;

    let query = {};
    if (!isAdmin) {
      const userEmail = (req.userEmail || (req.userId && (await User.findById(req.userId).select('email').lean())?.email) || '').toString().trim().toLowerCase();
      if (!req.userId && !userEmail) return res.json({ checkins: [], resumo: { total: 0, ministerios: [] } });
      // Mostra check-ins vinculados ao userId OU ao mesmo email (feitos antes de criar conta, ex.: link público)
      query.$or = [
        ...(req.userId ? [{ userId: req.userId }] : []),
        ...(userEmail ? [{ email: userEmail }] : []),
      ];
      if (query.$or.length === 0) return res.json({ checkins: [], resumo: { total: 0, ministerios: [] } });
    }
    if (dataFiltro) {
      const dateCondition = queryDataCheckinDiaBrasilia(String(dataFiltro).trim());
      if (dateCondition) Object.assign(query, dateCondition);
    }
    if (eventoId) query.eventoId = eventoId;
    if (ministerio) query.ministerio = ministerio;

    let checkinsData = await Checkin.find(query).select('email nome ministerio timestamp timestampMs dataCheckin eventoId presente').sort({ timestampMs: -1 }).lean();

    if (isAdmin && checkinsData.length === 0 && CHECKIN_CSV_PATH) {
      await syncCheckins();
      checkinsData = await Checkin.find(query).select('email nome ministerio timestamp timestampMs dataCheckin eventoId presente').sort({ timestampMs: -1 }).lean();
    }

    if (checkinsData.length === 0) {
      return res.json({ checkins: [], resumo: { total: 0, ministerios: [] } });
    }
    
    const ministeriosCount = {};
    checkinsData.forEach(c => {
      const m = (c.ministerio || '').trim();
      if (m) ministeriosCount[m] = (ministeriosCount[m] || 0) + 1;
    });
    
    const emailsCheckin = [...new Set(checkinsData.map(c => (c.email || '').toLowerCase().trim()).filter(Boolean))];
    const fotoByEmail = {};
    if (emailsCheckin.length > 0) {
      const users = await User.find({ email: { $in: emailsCheckin } }).select('email fotoUrl').lean();
      users.forEach(u => { if (u.email) fotoByEmail[u.email.toLowerCase()] = u.fotoUrl || null; });
    }
    const normalized = checkinsData.map(c => {
      const ms = c.timestampMs || (c.timestamp ? new Date(c.timestamp).getTime() : null);
      return {
        ...c,
        timestamp: formatDatePtBr(ms),
        timestampMs: ms,
        fotoUrl: fotoByEmail[(c.email || '').toLowerCase()] || null,
      };
    });

    const data = {
      checkins: normalized,
      resumo: {
        total: normalized.length,
        ministerios: Object.entries(ministeriosCount).sort((a, b) => b[1] - a[1]),
      },
    };
    if (isAdmin) {
      cache.checkins = data;
      cache.checkinsTime = Date.now();
    }
    res.json(data);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao carregar check-ins');
  }
});

// Líder ou admin com ministérios: check-ins dos ministérios que lidera
// Match exato (ministerio in nomes) OU ministerio contendo o nome do ministério (ex.: "Kids" → "Kids / Min. Infantil")
function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
app.get('/api/checkins/ministerio', requireAuth, async (req, res) => {
  try {
    const nomes = req.userMinisterioNomes && req.userMinisterioNomes.length ? req.userMinisterioNomes.map(String).map(s => s.trim()).filter(Boolean) : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
    if (nomes.length === 0) {
      return res.status(403).json({ error: 'Acesso apenas para líderes de ministério.' });
    }
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const { data: dataFiltro } = req.query;
    const orConditions = [
      { ministerio: { $in: nomes } },
      ...nomes.map((n) => ({ ministerio: new RegExp(escapeRegex(n), 'i') })),
    ];
    const query = { $or: orConditions };
    if (dataFiltro) {
      const dateCondition = queryDataCheckinDiaBrasilia(String(dataFiltro).trim());
      if (dateCondition) Object.assign(query, dateCondition);
    }
    // Limita a 500 check-ins mais recentes para performance
    const checkinsData = await Checkin.find(query).select('email nome ministerio timestamp timestampMs dataCheckin').sort({ timestampMs: -1 }).limit(500).lean();
    const ministeriosCount = {};
    checkinsData.forEach(c => {
      const m = (c.ministerio || '').trim();
      if (m) ministeriosCount[m] = (ministeriosCount[m] || 0) + 1;
    });
    const normalized = checkinsData.map(c => {
      const ms = c.timestampMs || (c.timestamp ? new Date(c.timestamp).getTime() : null);
      return {
        ...c,
        timestamp: formatDatePtBr(ms),
        timestampMs: ms,
      };
    });
    res.json({
      checkins: normalized,
      resumo: { total: normalized.length, ministerios: Object.entries(ministeriosCount).sort((a, b) => b[1] - a[1]) },
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao carregar check-ins do ministério.');
  }
});

/** Retorna a data de hoje no fuso da aplicação como YYYY-MM-DD. */
function getHojeDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
}

/** Dado YYYY-MM-DD, retorna o início desse dia em UTC (00:00:00.000Z). */
function parseDateAsUTC(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(s + 'T00:00:00.000Z');
}

/** Intervalo [início do dia, fim do dia) em UTC para a data YYYY-MM-DD no fuso da app. */
function getDayRangeUTC(dateStr) {
  const start = parseDateAsUTC(dateStr);
  if (!start) return { start: null, end: null };
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Intervalo do dia em Brasília (BRT = UTC-3): YYYY-MM-DD = 00:00–24:00 BRT em UTC. Usado para check-ins. */
function getDayRangeBrasilia(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return { start: null, end: null };
  const s = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { start: null, end: null };
  const start = new Date(s + 'T03:00:00.000Z');
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Filtro por data: retorna condição MongoDB que seleciona todos os check-ins cujo dia (em Brasília) é dateStr (YYYY-MM-DD), independente da hora armazenada. */
function queryDataCheckinDiaBrasilia(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return {
    $expr: {
      $eq: [
        { $dateToString: { date: '$dataCheckin', format: '%Y-%m-%d', timezone: 'America/Sao_Paulo' } },
        s,
      ],
    },
  };
}

const RE_HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
function parseHHMM(s) {
  const t = (s || '').toString().trim();
  return RE_HHMM.test(t) ? t : null;
}

/** Retorna o horário atual em São Paulo no formato "HH:mm". */
function getNowHHMMSaoPaulo() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: TZ_BRASILIA, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Data do evento como YYYY-MM-DD.
 * Eventos são gravados como meia-noite UTC (parseDateAsUTC), então a data
 * intencional é o componente UTC — converter para Brasília adiantaria -3h e
 * pularia para o dia anterior (ex.: 2026-02-15T00:00Z → "2026-02-14" BRT). */
function getEventDateStringSaoPaulo(evento) {
  if (!evento || !evento.data) return '';
  const d = evento.data instanceof Date ? evento.data : new Date(evento.data);
  return d.toISOString().slice(0, 10);
}

/** Verifica se o momento atual (em São Paulo) está dentro da janela de check-in do evento (também em São Paulo). */
function isWithinEventWindow(evento) {
  const hojeStr = getHojeDateString();
  const eventDateStr = getEventDateStringSaoPaulo(evento);
  if (eventDateStr !== hojeStr) return false;
  const hin = parseHHMM(evento.horarioInicio);
  const hfi = parseHHMM(evento.horarioFim);
  if (!hin && !hfi) return true;
  const now = getNowHHMMSaoPaulo();
  if (hin && now < hin) return false;
  if (hfi && now > hfi) return false;
  return true;
}

// Eventos de check-in: admin vê TODOS (ativos e inativos); voluntário vê só ativos. /hoje filtra ativo.
app.get('/api/eventos-checkin', requireAuth, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const { data } = req.query;
    const isAdmin = String(req.userRole || '').toLowerCase() === 'admin';
    const query = {};
    if (!isAdmin) query.ativo = true;
    if (data) {
      const { start, end } = getDayRangeUTC(data);
      if (start && end) query.data = { $gte: start, $lt: end };
    }
    const eventos = await EventoCheckin.find(query).sort({ data: -1 }).lean();
    res.json(eventos);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao listar eventos.');
  }
});

app.get('/api/eventos-checkin/hoje', requireAuth, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const hojeStr = getHojeDateString();
    const { start, end } = getDayRangeUTC(hojeStr);
    if (!start || !end) return res.json([]);
    const eventos = await EventoCheckin.find({ ativo: true, data: { $gte: start, $lt: end } }).sort({ data: 1 }).lean();
    res.json(eventos);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao listar eventos de hoje.');
  }
});

app.post('/api/eventos-checkin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data, label, ativo, horarioInicio, horarioFim } = req.body || {};
    if (!data) return sendError(res, 400, 'Campo "data" é obrigatório (YYYY-MM-DD ou ISO).');
    const dateStr = typeof data === 'string' ? data.trim().slice(0, 10) : '';
    const dataOnly = parseDateAsUTC(dateStr);
    if (!dataOnly || Number.isNaN(dataOnly.getTime())) return sendError(res, 400, 'Data inválida.');
    const hin = horarioInicio != null ? parseHHMM(horarioInicio) : null;
    const hfi = horarioFim != null ? parseHHMM(horarioFim) : null;
    if (horarioInicio != null && horarioInicio !== '' && !hin) return sendError(res, 400, 'horarioInicio deve ser HH:mm (ex: 19:00).');
    if (horarioFim != null && horarioFim !== '' && !hfi) return sendError(res, 400, 'horarioFim deve ser HH:mm (ex: 22:00).');
    const evento = await EventoCheckin.create({
      data: dataOnly,
      label: label || `Culto ${dataOnly.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })}`,
      criadoPor: req.userId,
      ativo: typeof ativo === 'boolean' ? ativo : true,
      horarioInicio: hin || '',
      horarioFim: hfi || '',
    });
    res.status(201).json(evento);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao criar evento.');
  }
});

app.put('/api/eventos-checkin/:id/ativo', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ativo } = req.body;
    if (typeof ativo !== 'boolean') return sendError(res, 400, 'ativo deve ser boolean.');
    const evento = await EventoCheckin.findByIdAndUpdate(req.params.id, { ativo }, { new: true });
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    invalidateCache();
    res.json(evento);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message);
  }
});

app.put('/api/eventos-checkin/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { label, ativo, horarioInicio, horarioFim } = req.body || {};
    const update = {};
    if (typeof label === 'string') update.label = label.trim();
    if (typeof ativo === 'boolean') update.ativo = ativo;
    const hin = horarioInicio != null ? parseHHMM(horarioInicio) : undefined;
    const hfi = horarioFim != null ? parseHHMM(horarioFim) : undefined;
    if (horarioInicio !== undefined) update.horarioInicio = hin || '';
    if (horarioFim !== undefined) update.horarioFim = hfi || '';
    if (horarioInicio != null && horarioInicio !== '' && !hin) return sendError(res, 400, 'horarioInicio deve ser HH:mm (ex: 19:00).');
    if (horarioFim != null && horarioFim !== '' && !hfi) return sendError(res, 400, 'horarioFim deve ser HH:mm (ex: 22:00).');
    const evento = await EventoCheckin.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    invalidateCache();
    res.json(evento);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao atualizar evento.');
  }
});

app.delete('/api/eventos-checkin/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const evento = await EventoCheckin.findByIdAndDelete(req.params.id);
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    invalidateCache();
    res.json({ ok: true, message: 'Evento excluído.' });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao excluir evento.');
  }
});

// Voluntário confirma presença no dia (check-in)
app.post('/api/checkins/confirmar', requireAuth, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const { eventoId, ministerio } = req.body || {};
    if (!eventoId) return sendError(res, 400, 'eventoId é obrigatório.');
    let email = req.userEmail;
    let nome = req.user;
    if (req.userId && (!email || !nome)) {
      const userDoc = await User.findById(req.userId).select('email nome').lean();
      if (userDoc) {
        if (!email && userDoc.email) email = userDoc.email;
        if (!nome && userDoc.nome) nome = userDoc.nome;
      }
    }
    if (!email) return sendError(res, 403, 'Usuário sem email. Faça login como voluntário.');

    const evento = await EventoCheckin.findById(eventoId).lean();
    if (!evento || !evento.ativo) return sendError(res, 404, 'Evento não encontrado ou inativo.');
    // Se o evento está ativo, aceita check-in a qualquer momento (sem trava de data nem janela de horário).
    const eventDateStr = getEventDateStringSaoPaulo(evento) || new Date(evento.data).toISOString().slice(0, 10);
    const dataCheckin = getDayRangeBrasilia(eventDateStr).start;
    const existing = await Checkin.findOne({ eventoId, email: email.toLowerCase(), dataCheckin });
    if (existing) return res.json({ message: 'Check-in já realizado.', checkin: existing });

    const checkin = await Checkin.create({
      email: email.toLowerCase(),
      nome: nome || '',
      ministerio: ministerio || '',
      timestamp: new Date(),
      timestampMs: Date.now(),
      dataCheckin,
      presente: true,
      eventoId,
      userId: req.userId,
    });
    try { await ensureVoluntarioInList({ email: email.toLowerCase(), nome: nome || '', ministerio: ministerio || '' }); } catch (_) {}
    invalidateCache();
    res.status(201).json(checkin);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao confirmar check-in.');
  }
});

// Check-in público por link (sem login): dados do evento + lista de ministérios
const MINISTERIOS_PADRAO_PUBLIC = ['Suporte Geral', 'Welcome / Recepção', 'Streaming / Ao Vivo', 'Produção', 'Kids / Min. Infantil', 'Intercessão', 'Parking / Estacionamento', 'Segurança', 'Outro'];
app.get('/api/checkin-public/:eventoId', async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'Serviço temporariamente indisponível.');
    const evento = await EventoCheckin.findById(req.params.eventoId).lean();
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    if (evento.ativo !== true) return sendError(res, 404, 'Check-in não está aberto para este evento.');
    const ministerios = await Ministerio.find({}).sort({ nome: 1 }).select('nome').lean();
    const ministeriosList = ministerios.length > 0 ? ministerios.map(m => m.nome).filter(Boolean) : MINISTERIOS_PADRAO_PUBLIC;
    res.json({
      evento: {
        _id: evento._id,
        label: evento.label || new Date(evento.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA }),
        data: evento.data,
        horarioInicio: (evento.horarioInicio || '').trim() || null,
        horarioFim: (evento.horarioFim || '').trim() || null,
      },
      ministerios: ministeriosList,
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao carregar dados.');
  }
});

// Check-in público por link (sem login): envia email + ministério. Quem faz check-in é considerado voluntário.
app.post('/api/checkin-public', async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'Serviço temporariamente indisponível.');
    const { eventoId, email, ministerio, nome } = req.body || {};
    const em = (email || '').toString().trim().toLowerCase();
    if (!em || !em.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');
    if (!eventoId) return sendError(res, 400, 'Evento é obrigatório.');
    const evento = await EventoCheckin.findById(eventoId).lean();
    if (!evento || !evento.ativo) return sendError(res, 404, 'Evento não encontrado ou check-in encerrado.');
    // Se o evento está ativo, aceita check-in a qualquer momento (sem trava de data nem janela de horário).
    const eventDateStr = getEventDateStringSaoPaulo(evento) || new Date(evento.data).toISOString().slice(0, 10);
    const dataCheckin = getDayRangeBrasilia(eventDateStr).start;
    const existing = await Checkin.findOne({ eventoId, email: em, dataCheckin });
    if (existing) {
      try { await ensureVoluntarioInList({ email: em, nome: (nome || '').toString().trim(), ministerio: (ministerio || '').toString().trim() }); } catch (_) {}
      return res.status(200).json({ message: 'Check-in já realizado.', checkin: existing });
    }
    const checkin = await Checkin.create({
      email: em,
      nome: (nome || '').toString().trim() || '',
      ministerio: (ministerio || '').toString().trim() || '',
      timestamp: new Date(),
      timestampMs: Date.now(),
      dataCheckin,
      presente: true,
      eventoId: evento._id,
    });
    try { await ensureVoluntarioInList({ email: em, nome: (nome || '').toString().trim(), ministerio: (ministerio || '').toString().trim() }); } catch (_) {}
    invalidateCache();
    res.status(201).json({ message: 'Check-in realizado!', checkin });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao registrar check-in.');
  }
});

// Perfil do voluntário/líder (dados no cadastro Voluntario)
app.get('/api/me/perfil', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const email = req.userEmail || (req.userId && (await User.findById(req.userId).select('email').lean())?.email);
    if (!email) return sendError(res, 403, 'Perfil disponível apenas para usuários com email.');
    const [perfil, user] = await Promise.all([
      Voluntario.findOne({ email: email.toLowerCase() }).lean(),
      req.userId ? User.findById(req.userId).select('fotoUrl').lean() : User.findOne({ email: email.toLowerCase() }).select('fotoUrl').lean(),
    ]);
    if (!perfil) return res.json({ fotoUrl: user?.fotoUrl ?? null });
    const areasStr = Array.isArray(perfil.areas) ? perfil.areas.join(', ') : (perfil.areas || '');
    res.json({ ...perfil, areas: areasStr, fotoUrl: user?.fotoUrl ?? null });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao carregar perfil.');
  }
});

app.put('/api/me/perfil', requireAuth, async (req, res) => {
  try {
    const email = req.userEmail || (req.userId && (await User.findById(req.userId).select('email').lean())?.email);
    if (!email) return sendError(res, 403, 'Perfil disponível apenas para usuários com email.');
    const body = { ...req.body };
    delete body.email;
    delete body._id;
    if (body.areas && typeof body.areas === 'string') body.areas = body.areas.split(',').map(a => a.trim()).filter(Boolean);
    if (body.whatsapp != null) {
      const w = normalizarWhatsapp(body.whatsapp);
      if (body.whatsapp !== '' && w === null) return sendError(res, 400, 'WhatsApp inválido. Informe 10 ou 11 dígitos (DDD + número).');
      body.whatsapp = (w != null ? w : (body.whatsapp === '' ? undefined : body.whatsapp));
    }
    if (body.nascimento != null && body.nascimento !== '') {
      const n = parseNascimento(body.nascimento);
      body.nascimento = n || body.nascimento;
      if (n && !validarNascimento(n)) return sendError(res, 400, 'Data de nascimento deve estar entre 1920 e 2015.');
    } else if (body.nascimento != null && typeof body.nascimento === 'string') {
      body.nascimento = parseNascimento(body.nascimento) || body.nascimento;
    }
    if (body.estado != null) body.estado = normalizarEstado(body.estado);
    if (body.cidade != null) body.cidade = normalizarCidade(body.cidade);
    const perfil = await Voluntario.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $set: body },
      { new: true, upsert: true, runValidators: true }
    ).lean();
    invalidateCache();
    res.json(perfil);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao salvar perfil.');
  }
});

// Revisar texto de email com LLM (Grok): devolve HTML profissional (links como botões, títulos em negrito).
app.post('/api/email/review-llm', requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const raw = (body.text ?? body.content ?? '').toString().trim();
    if (!raw) return sendError(res, 400, 'Envie o texto base no campo "text" (rascunho do email).');
    const apiKey = (process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({ error: 'GROK_API_KEY não configurada. Adicione a variável no painel da cloud (ex.: Railway → Variables) e reinicie o app.' });
    }
    const systemPrompt = `Você é um revisor de emails. Sua tarefa é:
1. Revisar o texto e propor pequenas melhorias (clareza, tom profissional, correções).
2. Devolver APENAS o corpo do email em HTML, sem markdown, sem \`\`\`.
3. Regras: transformar URLs/links em botões (<a href="..." style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Texto</a>).
4. Usar <strong> nos títulos e termos importantes.
5. Manter [nome] como está (será substituído pelo nome do destinatário).
6. Usar parágrafos <p>, listas <ul>/<li> se fizer sentido. Tom profissional e cordial.`;
    const modelsToTry = ['grok-4-latest', 'grok-beta', 'grok-2-latest', 'grok-2'];
    let lastError = null;
    let lastStatus = 0;
    let lastBody = '';

    for (const model of modelsToTry) {
      try {
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: raw },
            ],
            temperature: 0.3,
          }),
        });
        lastStatus = response.status;
        lastBody = await response.text();

        if (!response.ok) {
          let errMsg = lastBody;
          try {
            const parsed = JSON.parse(lastBody);
            errMsg = parsed.error?.message || parsed.error?.code || parsed.message || lastBody;
          } catch (_) {}
          lastError = errMsg;
          if (response.status === 401) {
            return res.status(502).json({ error: 'Chave GROK_API_KEY inválida ou expirada. Verifique em console.x.ai.' });
          }
          if (response.status === 404) {
            continue;
          }
          return res.status(502).json({ error: `API Grok (${response.status}): ${String(errMsg).slice(0, 200)}` });
        }

        const data = JSON.parse(lastBody);
        const msg = data?.choices?.[0]?.message;
        const content = (msg?.content ?? msg?.text ?? '').toString().trim();
        const html = content.replace(/^```html?\s*|\s*```$/gi, '').trim() || content;
        if (!html) {
          console.warn('review-llm: Grok retornou conteúdo vazio. lastBody (trecho):', lastBody.slice(0, 200));
        }
        return res.json({ html: html || '<p>Nenhum conteúdo retornado pela IA.</p>' });
      } catch (parseErr) {
        lastError = parseErr.message;
        if (parseErr.message && parseErr.message.includes('fetch')) {
          return res.status(502).json({ error: 'Não foi possível conectar à API Grok. Verifique sua rede e GROK_API_KEY.' });
        }
      }
    }

    const errMessage = lastError
      ? `Grok: ${String(lastError).slice(0, 200)}`
      : `Erro na API Grok (status ${lastStatus}). Verifique GROK_API_KEY em console.x.ai e variáveis da cloud.`;
    console.error('review-llm falhou:', errMessage);
    return res.status(502).json({ error: errMessage });
  } catch (err) {
    console.error('review-llm:', err);
    res.status(500).json({ error: err.message || 'Erro interno ao revisar com IA.' });
  }
});

// Cache do versículo do dia (por data, para não chamar Grok a cada request)
let versiculoDiaCache = { date: '', text: '', reference: '' };

// GET /api/grok-status - Diagnóstico: indica se GROK_API_KEY está definida (não expõe a chave)
app.get('/api/grok-status', requireAuth, (req, res) => {
  const key = (process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim();
  res.json({
    configured: !!key,
    hint: key ? 'Chave definida. Se ainda falhar, verifique se é válida em console.x.ai.' : 'Defina GROK_API_KEY no .env (local) ou nas variáveis do Railway/Render (produção) e reinicie o servidor.',
  });
});

// GET /api/versiculo-dia - Versículo do dia via Grok (testa a API e enriquece o resumo)
app.get('/api/versiculo-dia', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (versiculoDiaCache.date === today && versiculoDiaCache.text) {
      return res.json({ text: versiculoDiaCache.text, reference: versiculoDiaCache.reference || '' });
    }
    const apiKey = (process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({ error: 'GROK_API_KEY não configurada.' });
    }
    const systemPrompt = 'Você é um assistente que retorna apenas um versículo bíblico em português, adequado para o dia. Responda em uma única linha no formato: "Texto do versículo" — Referência (ex.: João 3.16). Sem explicação, sem markdown, só o texto e a referência.';
    const userPrompt = `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Retorne um versículo bíblico inspirador para o dia, em português.`;
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 150,
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      const errMsg = (() => { try { const p = JSON.parse(raw); return p.error?.message || raw; } catch (_) { return raw; } })();
      return res.status(502).json({ error: `Grok: ${String(errMsg).slice(0, 120)}` });
    }
    const data = JSON.parse(raw);
    const content = (data?.choices?.[0]?.message?.content || '').trim();
    const dash = content.indexOf('—');
    const ref = dash >= 0 ? content.slice(dash + 1).replace(/^[\s—\-]+/, '').trim() : '';
    const text = dash >= 0 ? content.slice(0, dash).trim().replace(/^["']|["']$/g, '') : content;
    versiculoDiaCache = { date: today, text: text || content, reference: ref };
    res.json({ text: versiculoDiaCache.text, reference: versiculoDiaCache.reference });
  } catch (err) {
    console.error('versiculo-dia:', err);
    res.status(500).json({ error: err.message || 'Erro ao buscar versículo.' });
  }
});

app.post('/api/send-email', requireAuth, requireAdmin, async (req, res) => {
  const { to, subject, html, text, voluntarios: voluntariosMap } = req.body;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
  const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';

  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY não configurada. Em produção, adicione a variável RESEND_API_KEY no painel da sua cloud (ex.: Railway → Variables).' });
  }
  if (!Array.isArray(to) || !to.length) {
    return res.status(400).json({ error: 'Envie um array "to" com pelo menos um email.' });
  }
  if (!subject || (!html && !text)) {
    return res.status(400).json({ error: 'Envie "subject" e "html" ou "text".' });
  }

  const resend = new Resend(apiKey);
  const validTo = to.filter(e => typeof e === 'string' && e.includes('@'));
  const map = voluntariosMap && typeof voluntariosMap === 'object' ? voluntariosMap : {};

  const personalize = (content, email) => {
    if (!content) return content;
    const nome = (map[email] || map[email.toLowerCase()] || '').trim() || 'voluntário(a)';
    return content.replace(/\[nome\]/gi, nome);
  };

  const baseHtml = html || (text ? `<p>${String(text).replace(/\n/g, '<br>')}</p>` : undefined);

  // Resend: limite de 2 requisições por segundo – envio sequencial com intervalo de 500ms
  const RESEND_DELAY_MS = 500;

  try {
    const results = [];
    for (const email of validTo) {
      const htmlFinal = baseHtml ? personalize(baseHtml, email) : undefined;
      try {
        const { data, error } = await resend.emails.send({
          from,
          to: email,
          reply_to: replyTo,
          subject,
          html: htmlFinal,
          text: !html && text ? personalize(text, email) : undefined,
        });
        results.push({ email, id: data?.id, error: error?.message });
      } catch (e) {
        results.push({ email, id: null, error: e?.message || 'Erro ao enviar' });
      }
      if (results.length < validTo.length) await new Promise(r => setTimeout(r, RESEND_DELAY_MS));
    }
    const failed = results.filter(r => r.error);
    res.json({
      sent: results.length - failed.length,
      failed: failed.length,
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao enviar email' });
  }
});

// ==================== NOVOS ENDPOINTS DE USUÁRIOS ====================

// POST /api/auth/register - Registrar novo usuário
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, nome, senha } = req.body || {};
    if (!email || !nome || !senha) {
      return res.status(400).json({ error: 'Email, nome e senha são obrigatórios.' });
    }
    
    const existe = await User.findOne({ email: email.toLowerCase() });
    if (existe) {
      return res.status(409).json({ error: 'Email já registrado.' });
    }
    
    const user = new User({ email: email.toLowerCase(), nome, senha, role: 'voluntario' });
    await user.save();
    try { await ensureVoluntarioInList({ email: user.email, nome: user.nome }); } catch (_) {}
    try { await vincularCheckinsAoUsuario(user._id, user.email); } catch (_) {}
    invalidateCache();

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    authTokens.set(token, { user: user.nome || user.email, userId: user._id, role: user.role, email: user.email, expiresAt });
    
    res.status(201).json({ token, user: user.toJSON(), expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao registrar usuário.' });
  }
});

// POST /api/auth/forgot-password - Solicitar link de redefinição de senha por email
const RESET_TOKEN_EXPIRES_MS = 60 * 60 * 1000; // 1 hora
app.post('/api/auth/forgot-password', async (req, res) => {
  const genericMessage = 'Se o email estiver cadastrado, você receberá um link para redefinir a senha.';
  try {
    const email = (req.body?.email || '').toString().trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Informe um email válido.' });
    }
    const user = await User.findOne({ email }).select('nome senha googleId resetToken resetTokenExpires').lean();
    if (!user || !user.senha) {
      return res.json({ message: genericMessage });
    }
    const resetToken = crypto.randomBytes(32).toString('hex');
    await User.updateOne(
      { email },
      { $set: { resetToken, resetTokenExpires: new Date(Date.now() + RESET_TOKEN_EXPIRES_MS) } }
    );
    const baseUrl = (process.env.APP_URL || '').trim() || `${req.protocol || 'https'}://${req.get('host') || req.headers.host || ''}`;
    const resetLink = `${baseUrl.replace(/\/$/, '')}?reset=${resetToken}`;
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
    const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
    if (apiKey) {
      const resend = new Resend(apiKey);
      const nome = (user.nome || '').trim() || 'usuário';
      await resend.emails.send({
        from,
        to: email,
        reply_to: replyTo,
        subject: 'Redefinição de senha - Celeiro SP',
        html: `<p>Olá, ${nome}!</p><p>Você solicitou a redefinição de senha. Clique no link abaixo para definir uma nova senha (válido por 1 hora):</p><p><a href="${resetLink}">Redefinir senha</a></p><p>Se você não solicitou isso, ignore este email.</p><p>— Celeiro SP</p>`,
      });
    }
    return res.json({ message: genericMessage });
  } catch (err) {
    console.error(err);
    return res.json({ message: genericMessage });
  }
});

// POST /api/auth/reset-password - Redefinir senha com o token do link
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, novaSenha } = req.body || {};
    const senha = (novaSenha || '').toString();
    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ error: 'Link inválido ou expirado.' });
    }
    if (!senha || senha.length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
    }
    const user = await User.findOne({
      resetToken: token.trim(),
      resetTokenExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ error: 'Link inválido ou expirado.' });
    }
    user.senha = senha;
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();
    return res.json({ message: 'Senha alterada. Faça login com a nova senha.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Erro ao redefinir senha.' });
  }
});

// POST /api/auth/login-email - Login com email e senha
app.post('/api/auth/login-email', async (req, res) => {
  try {
    const { email, senha } = req.body || {};
    if (!email || !senha) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    
    if (!user.ativo) {
      return res.status(403).json({ error: 'Usuário desativado.' });
    }
    
    const valida = await user.compararSenha(senha);
    if (!valida) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    
    // Atualizar último acesso
    user.ultimoAcesso = new Date();
    await user.save();
    try { await vincularCheckinsAoUsuario(user._id, user.email); } catch (_) {}

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    authTokens.set(token, { user: user.nome || user.email, userId: user._id, role: user.role, email: user.email, expiresAt });

    res.json({ token, user: user.toJSON(), expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao fazer login.' });
  }
});

// POST /api/auth/change-password - Trocar senha
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { senhaAtual, senhaNova } = req.body || {};
    if (!senhaAtual || !senhaNova) {
      return res.status(400).json({ error: 'Senha atual e nova são obrigatórias.' });
    }
    
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    
    if (!user.senha) {
      return res.status(403).json({ error: 'Usuário com autenticação Google não pode trocar senha aqui.' });
    }
    
    const valida = await user.compararSenha(senhaAtual);
    if (!valida) {
      return res.status(401).json({ error: 'Senha atual inválida.' });
    }
    
    user.senha = senhaNova;
    user.mustChangePassword = false;
    await user.save();
    
    res.json({ ok: true, mensagem: 'Senha alterada com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao trocar senha.' });
  }
});

// POST /api/users - Criar usuário (admin only). Senha temporária; usuário deve trocar no primeiro acesso.
app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, nome, senha, role, ministerioIds } = req.body || {};
    const em = (email || '').toString().trim().toLowerCase();
    if (!em || !em.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');
    if (!(nome || '').toString().trim()) return sendError(res, 400, 'Nome é obrigatório.');
    const senhaVal = (senha || '').toString().trim();
    if (!senhaVal || senhaVal.length < 6) return sendError(res, 400, 'Senha temporária é obrigatória (mínimo 6 caracteres).');
    const roleVal = (role || 'voluntario').toString().toLowerCase();
    if (!['admin', 'voluntario', 'lider'].includes(roleVal)) return sendError(res, 400, 'Perfil inválido.');
    const existing = await User.findOne({ email: em });
    if (existing) return sendError(res, 409, 'Já existe um usuário com este email.');
    const rawIds = Array.isArray(ministerioIds) ? ministerioIds.filter(Boolean) : [];
    const user = new User({
      email: em,
      nome: (nome || '').toString().trim(),
      senha: senhaVal,
      role: roleVal,
      ministerioIds: (roleVal === 'lider' || roleVal === 'admin') ? rawIds : [],
      ativo: true,
      mustChangePassword: true,
    });
    await user.save();
    try { await ensureVoluntarioInList({ email: user.email, nome: user.nome }); } catch (_) {}
    invalidateCache();
    const created = await User.findById(user._id).select('-senha -resetToken -resetTokenExpires').populate('ministerioIds', 'nome').lean();
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao criar usuário.');
  }
});

// GET /api/ministros - Listar ministérios (admin)
app.get('/api/ministros', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const list = await Ministerio.find({}).sort({ nome: 1 }).lean();
    
    // Otimização: busca todos os líderes de uma vez (evita N+1)
    const ministerioIds = list.map(m => m._id);
    const allLeaders = await User.find({ ministerioIds: { $in: ministerioIds }, ativo: true }).select('nome email role ministerioIds').lean();
    const leadersByMinist = {};
    allLeaders.forEach(u => {
      (u.ministerioIds || []).forEach(mid => {
        const k = String(mid);
        if (!leadersByMinist[k]) leadersByMinist[k] = [];
        leadersByMinist[k].push({ nome: u.nome, email: u.email, role: u.role });
      });
    });
    const withLeaders = list.map(m => ({ ...m, lideres: leadersByMinist[String(m._id)] || [] }));
    res.json(withLeaders);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao listar ministérios.');
  }
});

// POST /api/ministros - Criar ministério (admin)
app.post('/api/ministros', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const nome = String(req.body?.nome || '').trim();
    if (!nome) return sendError(res, 400, 'Nome do ministério é obrigatório.');
    const slug = nome.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const existing = await Ministerio.findOne({ $or: [{ nome }, { slug }] });
    if (existing) return sendError(res, 400, 'Ministério com esse nome já existe.');
    const doc = await Ministerio.create({ nome, slug: slug || nome });
    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao criar ministério.');
  }
});

// PUT /api/ministros/:id - Atualizar ministério ou atribuir líderes (admin). liderIds = array de userId.
app.put('/api/ministros/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nome, ativo, liderId, liderIds } = req.body;
    const minist = await Ministerio.findById(req.params.id);
    if (!minist) return sendError(res, 404, 'Ministério não encontrado.');
    if (nome != null) minist.nome = String(nome).trim();
    if (ativo !== undefined) minist.ativo = !!ativo;
    await minist.save();
    const newLiderIds = Array.isArray(liderIds) ? liderIds.filter(Boolean) : (liderId ? [liderId] : undefined);
    if (newLiderIds !== undefined) {
      const exLideres = await User.find({ ministerioIds: minist._id }).select('_id role ministerioIds').lean();
      for (const u of exLideres) {
        const newIds = (u.ministerioIds || []).filter(id => String(id) !== String(minist._id));
        await User.findByIdAndUpdate(u._id, { ministerioIds: newIds, ...(newIds.length === 0 && u.role !== 'admin' ? { role: 'voluntario' } : {}) });
        await RoleHistory.create({ userId: u._id, fromRole: u.role || 'lider', toRole: newIds.length === 0 && u.role !== 'admin' ? 'voluntario' : (u.role || 'lider'), ministerioId: minist._id, changedBy: req.userId });
      }
      for (const uid of newLiderIds) {
        const u = await User.findById(uid).select('ministerioIds role').lean();
        if (!u) continue;
        const ids = [...(u.ministerioIds || []).map(id => id)];
        if (ids.some(id => String(id) === String(minist._id))) continue;
        ids.push(minist._id);
        const newRole = u.role === 'admin' ? 'admin' : 'lider';
        await User.findByIdAndUpdate(uid, { ministerioIds: ids, role: newRole });
        await RoleHistory.create({ userId: uid, fromRole: u.role || 'voluntario', toRole: newRole, ministerioId: minist._id, changedBy: req.userId });
      }
    }
    res.json(minist);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao atualizar ministério.');
  }
});

// DELETE /api/ministros/:id - Excluir ministério (admin)
app.delete('/api/ministros/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const minist = await Ministerio.findById(req.params.id);
    if (!minist) return sendError(res, 404, 'Ministério não encontrado.');
    const exLideres = await User.find({ ministerioIds: minist._id }).select('_id role ministerioIds').lean();
    for (const u of exLideres) {
      const newIds = (u.ministerioIds || []).filter(id => String(id) !== String(minist._id));
      await User.findByIdAndUpdate(u._id, { ministerioIds: newIds, ...(newIds.length === 0 && u.role !== 'admin' ? { role: 'voluntario' } : {}) });
      await RoleHistory.create({ userId: u._id, fromRole: u.role || 'lider', toRole: newIds.length === 0 && u.role !== 'admin' ? 'voluntario' : (u.role || 'lider'), ministerioId: minist._id, changedBy: req.userId });
    }
    await Ministerio.findByIdAndDelete(minist._id);
    res.json({ ok: true, message: 'Ministério excluído.' });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao excluir ministério.');
  }
});

// GET /api/users/foto - Foto de um usuário por email (admin ou líder, para exibir no perfil)
app.get('/api/users/foto', requireAuth, async (req, res) => {
  try {
    const role = String(req.userRole || '').toLowerCase();
    if (role !== 'admin' && role !== 'lider') return res.status(403).json({ error: 'Acesso negado.' });
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Parâmetro email é obrigatório.' });
    const user = await User.findOne({ email }).select('fotoUrl').lean();
    res.json({ fotoUrl: user?.fotoUrl || null });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao buscar foto.');
  }
});

// GET /api/users - Listar usuários (admin only). Query: search (nome/email), ativo (true|false).
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const { search, ativo } = req.query || {};
    const filter = {};
    if (ativo === 'true') filter.ativo = true;
    if (ativo === 'false') filter.ativo = false;
    if (search && typeof search === 'string' && search.trim()) {
      const s = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ nome: new RegExp(s, 'i') }, { email: new RegExp(s, 'i') }];
    }
    const users = await User.find(filter, '-senha -resetToken -resetTokenExpires').populate('ministerioIds', 'nome').sort({ nome: 1 }).lean();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao listar usuários.' });
  }
});

// GET /api/users/by-email?email=xxx - Buscar usuário por email (admin, para definir líderes)
app.get('/api/users/by-email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return sendError(res, 400, 'Email inválido.');
    const user = await User.findOne({ email }, '-senha -resetToken -resetTokenExpires').populate('ministerioIds', 'nome').lean();
    if (!user) return sendError(res, 404, 'Nenhum usuário encontrado com este email.');
    res.json(user);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao buscar usuário.');
  }
});

// GET /api/users/:id/history - Histórico de alteração de role (admin)
app.get('/api/users/:id/history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const list = await RoleHistory.find({ userId: req.params.id }).sort({ createdAt: -1 }).populate('changedBy', 'nome').populate('ministerioId', 'nome').lean();
    res.json(list);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao carregar histórico.');
  }
});

// PUT /api/users/:id - Editar usuário e role (admin); registra histórico. ministerioIds = array (líder pode ter vários; admin também pode ter).
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nome, role, ativo, ministerioId, ministerioIds } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'Usuário não encontrado.');
    const fromRole = user.role;
    const updates = {};
    if (nome !== undefined) updates.nome = nome;
    if (ativo !== undefined) updates.ativo = ativo;
    if (role !== undefined) {
      if (!['admin', 'voluntario', 'lider'].includes(role)) return sendError(res, 400, 'Role inválido.');
      updates.role = role;
    }
    const newRole = role !== undefined ? role : user.role;
    const rawIds = Array.isArray(ministerioIds) ? ministerioIds : (ministerioId != null ? [ministerioId] : undefined);
    if (newRole === 'voluntario') {
      updates.ministerioIds = [];
    } else if (rawIds !== undefined && (newRole === 'lider' || newRole === 'admin')) {
      updates.ministerioIds = rawIds.filter(Boolean);
    }
    const updated = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).populate('ministerioIds', 'nome');
    if (newRole === 'voluntario') {
      try { await ensureVoluntarioInList({ email: updated.email, nome: updated.nome }); } catch (_) {}
      invalidateCache();
    }
    if (role !== undefined && role !== fromRole) {
      await RoleHistory.create({
        userId: user._id,
        fromRole,
        toRole: role,
        ministerioId: (updates.ministerioIds && updates.ministerioIds[0]) || null,
        changedBy: req.userId,
      });
    } else if (rawIds !== undefined && (newRole === 'lider' || newRole === 'admin')) {
      await RoleHistory.create({
        userId: user._id,
        fromRole: newRole,
        toRole: newRole,
        ministerioId: (updates.ministerioIds && updates.ministerioIds[0]) || null,
        changedBy: req.userId,
      });
    }
    invalidateCache();
    res.json(updated.toJSON ? updated.toJSON() : updated);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao editar usuário.');
  }
});

// DELETE /api/users/:id - Apenas master admin (MASTER_ADMIN_EMAIL no .env)
app.delete('/api/users/:id', requireAuth, requireMasterAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'Usuário não encontrado.');
    const email = (user.email || '').toString().trim().toLowerCase();
    if (email === MASTER_ADMIN_EMAIL) return sendError(res, 400, 'O administrador master não pode ser excluído.');
    await User.findByIdAndDelete(req.params.id);
    invalidateCache();
    res.json({ ok: true, message: 'Usuário excluído.' });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao excluir usuário.');
  }
});

// POST /api/fix-datacheckin - Corrige dataCheckin de check-ins com eventoId (admin only).
// Necessário uma vez: bug antigo em getEventDateStringSaoPaulo causava data -1 dia.
app.post('/api/fix-datacheckin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const dryRun = req.query.dry !== 'false';
    const checkins = await Checkin.find({ eventoId: { $exists: true, $ne: null } })
      .select('_id eventoId dataCheckin').lean();
    const eventIds = [...new Set(checkins.map(c => String(c.eventoId)))];
    const eventos = await EventoCheckin.find({ _id: { $in: eventIds } }).select('_id data').lean();
    const eventoMap = new Map(eventos.map(e => [String(e._id), e]));

    const errados = [];
    for (const c of checkins) {
      const evento = eventoMap.get(String(c.eventoId));
      if (!evento || !evento.data) continue;
      const d = evento.data instanceof Date ? evento.data : new Date(evento.data);
      // Data correta: UTC midnight do evento → meia-noite BRT (T03:00:00Z)
      const dataCorreta = new Date(d.toISOString().slice(0, 10) + 'T03:00:00.000Z');
      const dataAtual = c.dataCheckin instanceof Date ? c.dataCheckin : new Date(c.dataCheckin);
      if (!dataAtual || dataAtual.getTime() !== dataCorreta.getTime()) {
        errados.push({ id: c._id, de: dataAtual?.toISOString(), para: dataCorreta.toISOString() });
        if (!dryRun) {
          await Checkin.updateOne({ _id: c._id }, { $set: { dataCheckin: dataCorreta } });
        }
      }
    }
    res.json({ dryRun, total: checkins.length, errados: errados.length, detalhes: errados });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao corrigir dataCheckin.');
  }
});

// POST /api/migrate - Migrar dados das CSVs para o MongoDB (admin only)
app.post('/api/migrate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado. Configure MONGODB_URI no .env.');
    if (!VOLUNTARIOS_CSV_PATH && !CSV_URL) return sendError(res, 400, 'VOLUNTARIOS_CSV_PATH ou CSV_URL não configurado.');
    const volResult = await syncVoluntarios();
    const checkResult = CHECKIN_CSV_PATH ? await syncCheckins() : { inserted: 0, updated: 0, skipped: true };

    res.json({ 
      success: true, 
      message: 'Migração concluída!',
      voluntarios: volResult,
      checkins: checkResult 
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro na migração.');
  }
});

// POST /api/send-cadastro-incompleto - Envia email de convite de cadastro para voluntários
// que fizeram check-in mas não têm perfil completo (Voluntario com nome preenchido). Admin only.
// ?dry=true → apenas lista os elegíveis sem enviar.
app.post('/api/send-cadastro-incompleto', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return sendError(res, 500, 'RESEND_API_KEY não configurada.');
    const dryRun = String(req.query.dry || 'false') !== 'false';
    const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
    const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';

    // Emails únicos com check-in
    const checkinsAgg = await Checkin.aggregate([
      { $group: { _id: { $toLower: '$email' }, nome: { $first: '$nome' } } },
      { $match: { _id: { $ne: null, $nin: ['', null] } } },
    ]);

    // Voluntarios com perfil (nome preenchido)
    const perfis = await Voluntario.find({ email: { $exists: true, $ne: '' }, nome: { $exists: true, $ne: '' } }).select('email').lean();
    const emailsComPerfil = new Set(perfis.map(v => (v.email || '').toLowerCase().trim()));

    const elegíveis = checkinsAgg
      .filter(c => c._id && !emailsComPerfil.has(c._id.trim()))
      .map(c => ({ email: c._id.trim(), nome: (c.nome || '').trim() }))
      .sort((a, b) => a.email.localeCompare(b.email));

    if (dryRun || !elegíveis.length) {
      return res.json({ dryRun: true, total: elegíveis.length, elegíveis });
    }

    const buildHtml = (nome) => {
      const n = (nome || '').trim() || 'voluntário(a)';
      return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Complete seu cadastro — Celeiro SP</title></head><body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);"><tr><td style="background:#1a1a2e;padding:32px 40px;text-align:center;"><p style="margin:0;font-size:13px;color:#f59e0b;text-transform:uppercase;letter-spacing:.1em;font-weight:600;">Igreja Celeiro São Paulo</p><h1 style="margin:8px 0 0;font-size:24px;color:#ffffff;font-weight:700;">Equipe de Voluntários</h1></td></tr><tr><td style="padding:40px 40px 32px;"><p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">Olá, <strong>${n}</strong>! 👋</p><p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;"><strong>Obrigado por servir como voluntário no Celeiro São Paulo!</strong> Sua dedicação é fundamental para que o propósito de Deus se cumpra aqui.</p><p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">Recebemos o seu check-in — mas ainda não temos seus dados completos em nossa base de voluntários. Para que possamos te conhecer melhor e manter um registro organizado do time, pedimos que você crie sua conta na plataforma e preencha suas informações.</p><table cellpadding="0" cellspacing="0" style="margin:32px auto;"><tr><td style="border-radius:8px;background:#f59e0b;"><a href="https://voluntariosceleirosp.com/" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:700;color:#1a1a2e;text-decoration:none;border-radius:8px;letter-spacing:.02em;">Criar minha conta agora →</a></td></tr></table><p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">Após criar sua conta e fazer login, você poderá:</p><ul style="margin:0 0 24px;padding-left:20px;color:#374151;font-size:15px;line-height:1.8;"><li>Acompanhar o histórico completo dos seus check-ins</li><li>Manter seus dados de contato atualizados</li><li>Ver os eventos e cultos disponíveis para voluntários</li></ul><p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">Ficamos felizes em ter você no time. Se tiver qualquer dúvida, é só responder este email.</p></td></tr><tr><td style="padding:0 40px 40px;"><table cellpadding="0" cellspacing="0"><tr><td style="border-left:3px solid #f59e0b;padding-left:16px;"><p style="margin:0;font-size:15px;font-weight:700;color:#1a1a2e;">Com gratidão,</p><p style="margin:4px 0 0;font-size:14px;color:#6b7280;">Equipe Voluntários Celeiro São Paulo</p><p style="margin:4px 0 0;font-size:13px;color:#9ca3af;"><a href="https://voluntariosceleirosp.com/" style="color:#f59e0b;text-decoration:none;">voluntariosceleirosp.com</a></p></td></tr></table></td></tr><tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;"><p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">Você recebeu este email porque realizou um check-in como voluntário no Celeiro SP.<br>Igreja Celeiro São Paulo · São Paulo, SP</p></td></tr></table></td></tr></table></body></html>`;
    };

    const resend = new Resend(apiKey);
    const results = [];
    for (const v of elegíveis) {
      try {
        const { error } = await resend.emails.send({
          from, to: v.email, reply_to: replyTo,
          subject: 'Complete seu cadastro — Voluntários Celeiro SP',
          html: buildHtml(v.nome),
        });
        results.push({ email: v.email, ok: !error, error: error?.message || null });
      } catch (e) {
        results.push({ email: v.email, ok: false, error: e.message });
      }
      if (results.length < elegíveis.length) await new Promise(r => setTimeout(r, 500));
    }
    const sent = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    console.log(`send-cadastro-incompleto: ${sent} enviados, ${failed} falhas.`);
    res.json({ sent, failed, total: elegíveis.length, results });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao enviar emails.');
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// ESCALAS
// ──────────────────────────────────────────────────────────────────────────────

// GET /api/escalas — lista escalas (admin: todas; lider: só ativas)
// Admin: totalCandidaturas/totalAprovados = todos. Líder: só do(s) ministério(s) que lidera
app.get('/api/escalas', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    const query = isAdmin ? {} : { ativo: true };
    const escalas = await Escala.find(query).sort({ createdAt: -1 }).lean();
    const ids = escalas.map(e => e._id);
    let countMatch = { escalaId: { $in: ids } };
    if (isLider) {
      const nomes = req.userMinisterioNomes && req.userMinisterioNomes.length
        ? req.userMinisterioNomes.map(String).map(s => s.trim()).filter(Boolean)
        : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
      if (nomes.length > 0) {
        const orConditions = [
          { ministerio: { $in: nomes } },
          ...nomes.map((n) => ({ ministerio: new RegExp(escapeRegex(n), 'i') })),
        ];
        countMatch = { escalaId: { $in: ids }, $or: orConditions };
      } else {
        countMatch = { escalaId: { $in: ids }, ministerio: '__nenhum__' };
      }
    }
    const counts = await Candidatura.aggregate([
      { $match: countMatch },
      { $group: { _id: '$escalaId', total: { $sum: 1 }, aprovados: { $sum: { $cond: [{ $eq: ['$status', 'aprovado'] }, 1, 0] } } } },
    ]);
    const countMap = new Map(counts.map(c => [String(c._id), c]));
    const result = escalas.map(e => ({
      ...e,
      totalCandidaturas: countMap.get(String(e._id))?.total || 0,
      totalAprovados: countMap.get(String(e._id))?.aprovados || 0,
    }));
    res.json(result);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// GET /api/escalas/candidaturas-all — todas as candidaturas com info de escala (admin: todas; líder: seus ministérios)
app.get('/api/escalas/candidaturas-all', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const escalas = await Escala.find(isAdmin ? {} : { ativo: true }).sort({ createdAt: -1 }).lean();
    const ids = escalas.map((e) => e._id);
    let query = { escalaId: { $in: ids } };
    if (isLider) {
      const nomes = req.userMinisterioNomes?.length ? req.userMinisterioNomes.map((n) => String(n).trim()).filter(Boolean) : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
      if (!nomes.length) return res.json([]);
      const orConditions = [
        { ministerio: { $in: nomes } },
        ...nomes.map((n) => ({ ministerio: new RegExp(escapeRegex(n), 'i') })),
      ];
      query = { escalaId: { $in: ids }, $or: orConditions };
    }
    const candidaturas = await Candidatura.find(query).sort({ createdAt: -1 }).lean();
    if (!candidaturas.length) return res.json([]);

    const escalaMap = new Map(escalas.map((e) => [String(e._id), e]));
    const emails = [...new Set(candidaturas.map((c) => (c.email || '').toLowerCase()).filter(Boolean))];

    const condAprovado = { $cond: { if: { $eq: ['$status', 'aprovado'] }, then: 1, else: 0 } };
    const condDesistencia = { $cond: { if: { $eq: ['$status', 'desistencia'] }, then: 1, else: 0 } };
    const condFalta = { $cond: { if: { $eq: ['$status', 'falta'] }, then: 1, else: 0 } };
    const [statsAgg, checkinsAgg] = await Promise.all([
      Candidatura.aggregate([
        { $match: { email: { $in: emails } } },
        { $group: { _id: '$email', totalParticipacoes: { $sum: condAprovado }, totalDesistencias: { $sum: condDesistencia }, totalFaltas: { $sum: condFalta } } },
      ]),
      Checkin.aggregate([
        { $match: { email: { $in: emails } } },
        { $group: { _id: { $toLower: '$email' }, totalCheckins: { $sum: 1 }, ministerios: { $addToSet: '$ministerio' } } },
      ]),
    ]);
    const statsMap = new Map(statsAgg.map((s) => [s._id, s]));
    const checkinsMap = new Map(checkinsAgg.map((c) => [c._id, { total: c.totalCheckins, ministerios: (c.ministerios || []).filter(Boolean) }]));

    const liderMinisterios = isLider ? (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean) : [];
    const result = candidaturas.map((c) => {
      const stats = statsMap.get(c.email) || {};
      const ci = checkinsMap.get((c.email || '').toLowerCase()) || { total: 0, ministerios: [] };
      const jaServiuMinLider = liderMinisterios.length > 0 && ci.ministerios.some((m) => liderMinisterios.some((lm) => (m || '').toLowerCase().includes((lm || '').toLowerCase())));
      const escala = escalaMap.get(String(c.escalaId));
      return {
        ...c,
        escalaNome: escala?.nome,
        escalaData: escala?.data,
        totalCheckins: ci.total,
        totalParticipacoes: stats.totalParticipacoes || 0,
        totalDesistencias: stats.totalDesistencias || 0,
        totalFaltas: stats.totalFaltas || 0,
        jaServiuAlgum: (ci.total || 0) + (stats.totalParticipacoes || 0) > 0,
        jaServiuMinLider,
      };
    });
    result.sort((a, b) => {
      const aAp = a.status === 'aprovado' ? 1 : 0;
      const bAp = b.status === 'aprovado' ? 1 : 0;
      if (bAp !== aAp) return bAp - aAp;
      if ((b.totalCheckins || 0) !== (a.totalCheckins || 0)) return (b.totalCheckins || 0) - (a.totalCheckins || 0);
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message);
  }
});

// POST /api/candidaturas/bulk-status — atualiza status de várias candidaturas de uma vez
app.post('/api/candidaturas/bulk-status', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const { ids, status } = req.body || {};
    const validStatus = ['aprovado', 'desistencia', 'falta'];
    if (!status || !validStatus.includes(status)) return sendError(res, 400, `Status inválido. Use: ${validStatus.join(', ')}`);
    const idList = Array.isArray(ids) ? ids.filter((id) => id && String(id).trim()).map(String) : [];
    if (!idList.length) return sendError(res, 400, 'Informe ao menos um id.');

    const candidaturas = await Candidatura.find({ _id: { $in: idList } }).lean();
    const nomes = isLider ? (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean) : [];
    if (isLider && nomes.length) {
      const validas = candidaturas.filter((c) => {
        const m = (c.ministerio || '').trim();
        return nomes.includes(m) || nomes.some((n) => new RegExp(escapeRegex(n), 'i').test(m));
      });
      if (validas.length !== candidaturas.length) return sendError(res, 403, 'Algumas candidaturas não são do seu ministério.');
    }

    const update = { status };
    if (status === 'aprovado') update.aprovadoPor = req.userId;
    if (status === 'aprovado') update.aprovadoEm = new Date();

    const result = await Candidatura.updateMany({ _id: { $in: idList } }, { $set: update });
    if (status === 'aprovado' && result.modifiedCount > 0) {
      for (const c of candidaturas) {
        if (c.status !== 'aprovado' && c.email && !c.emailEnviado) {
          try {
            const escala = await Escala.findById(c.escalaId).lean();
            const resend = new Resend(process.env.RESEND_API_KEY);
            if (process.env.RESEND_API_KEY && escala) {
              await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>',
                to: c.email,
                reply_to: process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com',
                subject: `Participação confirmada — ${escala.nome || 'Escala'}`,
                html: `<p>Olá! Sua participação na escala <strong>${escala.nome}</strong> foi confirmada. Obrigado por servir!</p>`,
              });
              await Candidatura.updateOne({ _id: c._id }, { emailEnviado: true });
            }
          } catch (_) {}
        }
      }
    }
    invalidateCache();
    res.json({ ok: true, modified: result.modifiedCount });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message);
  }
});

// GET /api/escalas/export-csv — exporta todas as escalas com candidaturas em CSV (admin only)
function escapeCsv(val) {
  const s = String(val ?? '').replace(/"/g, '""');
  return /[,"\n\r]/.test(s) ? `"${s}"` : s;
}
app.get('/api/escalas/export-csv', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const escalas = await Escala.find({}).sort({ createdAt: -1 }).lean();
    const ids = escalas.map((e) => e._id);
    const candidaturas = await Candidatura.find({ escalaId: { $in: ids } }).sort({ ministerio: 1, nome: 1 }).lean();
    const escalaMap = new Map(escalas.map((e) => [String(e._id), e]));
    const header = ['Escala', 'Data', 'Nome', 'Email', 'Telefone', 'Ministério', 'Status'];
    const rows = candidaturas.map((c) => {
      const escala = escalaMap.get(String(c.escalaId));
      const dataStr = escala?.data ? new Date(escala.data).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
      return [escala?.nome || '', dataStr, c.nome || '', c.email || '', c.telefone || '', c.ministerio || '', c.status || ''].map(escapeCsv).join(',');
    });
    const csv = '\uFEFF' + header.map(escapeCsv).join(',') + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="escalas-export.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao exportar.');
  }
});

// POST /api/escalas — cria escala (admin only)
app.post('/api/escalas', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nome, data, descricao, ativo } = req.body || {};
    if (!nome || !String(nome).trim()) return sendError(res, 400, 'Nome é obrigatório.');
    const escala = await Escala.create({
      nome: String(nome).trim(),
      data: data ? new Date(data) : null,
      descricao: (descricao || '').trim(),
      ativo: typeof ativo === 'boolean' ? ativo : true,
      criadoPor: req.userId,
    });
    res.status(201).json(escala);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// PUT /api/escalas/:id — atualiza escala (admin only)
app.put('/api/escalas/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nome, data, descricao, ativo } = req.body || {};
    const update = {};
    if (nome !== undefined) update.nome = String(nome).trim();
    if (data !== undefined) update.data = data ? new Date(data) : null;
    if (descricao !== undefined) update.descricao = String(descricao).trim();
    if (typeof ativo === 'boolean') update.ativo = ativo;
    const escala = await Escala.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!escala) return sendError(res, 404, 'Escala não encontrada.');
    res.json(escala);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// DELETE /api/escalas/:id — exclui escala (admin only, só se sem candidaturas)
app.delete('/api/escalas/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await Candidatura.countDocuments({ escalaId: req.params.id });
    if (count > 0) return sendError(res, 400, `Esta escala tem ${count} candidatura(s). Remova-as antes de excluir.`);
    const escala = await Escala.findByIdAndDelete(req.params.id);
    if (!escala) return sendError(res, 404, 'Escala não encontrada.');
    res.json({ ok: true });
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// GET /api/escala-publica/:id — info pública da escala para o form de candidatura
app.get('/api/escala-publica/:id', async (req, res) => {
  try {
    const escala = await Escala.findById(req.params.id).select('nome data descricao ativo').lean();
    if (!escala) return sendError(res, 404, 'Escala não encontrada.');
    if (!escala.ativo) return sendError(res, 404, 'Esta escala não está aceitando candidaturas no momento.');
    const ministerios = await Ministerio.find({ ativo: true }).sort({ nome: 1 }).select('nome').lean();
    const ministeriosList = ministerios.length > 0 ? ministerios.map(m => m.nome).filter(Boolean) : MINISTERIOS_PADRAO_PUBLIC;
    res.json({
      escala: { _id: escala._id, nome: escala.nome, data: escala.data, descricao: escala.descricao },
      ministerios: ministeriosList,
    });
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// POST /api/candidaturas — candidatura pública (sem auth). Quem se candidata é considerado voluntário.
app.post('/api/candidaturas', async (req, res) => {
  try {
    const { escalaId, nome, email, telefone, ministerio } = req.body || {};
    const em = (email || '').toString().trim().toLowerCase();
    if (!em || !em.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');
    if (!escalaId) return sendError(res, 400, 'Escala é obrigatória.');
    if (!ministerio) return sendError(res, 400, 'Ministério é obrigatório.');
    const escala = await Escala.findById(escalaId).lean();
    if (!escala || !escala.ativo) return sendError(res, 404, 'Escala não encontrada ou não está ativa.');
    const existing = await Candidatura.findOne({ escalaId, email: em });
    if (existing) {
      try { await ensureVoluntarioInList({ email: em, nome: (nome || '').toString().trim(), ministerio: (ministerio || '').toString().trim() }); } catch (_) {}
      return res.status(200).json({ message: 'Você já se candidatou para esta escala.', candidatura: existing });
    }
    const candidatura = await Candidatura.create({
      escalaId,
      nome: (nome || '').toString().trim(),
      email: em,
      telefone: (telefone || '').toString().trim(),
      ministerio: (ministerio || '').toString().trim(),
    });
    // Garante que o candidato apareça na lista de voluntários
    try { await ensureVoluntarioInList({ email: em, nome: (nome || '').toString().trim(), ministerio: (ministerio || '').toString().trim() }); } catch (_) {}

    // Email de confirmação de recebimento
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && em) {
      try {
        const escalaNome = escala?.nome || 'Escala';
        const escalaData = escala?.data ? new Date(escala.data).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
        const nomeDisplay = (nome || '').toString().trim() || 'voluntário(a)';
        const resend = new Resend(apiKey);
        const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
        const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
        await resend.emails.send({
          from, to: em, reply_to: replyTo,
          subject: `Recebemos sua candidatura — ${escalaNome}`,
          html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Recebemos sua candidatura</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
      <tr><td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
        <p style="margin:0;font-size:13px;color:#f59e0b;text-transform:uppercase;letter-spacing:.1em;font-weight:600;">Igreja Celeiro São Paulo</p>
        <h1 style="margin:8px 0 0;font-size:24px;color:#fff;font-weight:700;">Equipe de Voluntários</h1>
      </td></tr>
      <tr><td style="padding:40px 40px 32px;">
        <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">Olá, <strong>${nomeDisplay}</strong>!</p>
        <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">Recebemos o preenchimento da escala <strong>${escalaNome}</strong>${escalaData ? ` (${escalaData})` : ''}. Obrigado por se candidatar!</p>
        <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">Quando o líder do ministério aprovar todos os voluntários, você vai receber um email de confirmação.</p>
        <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">Ministério informado: <strong>${(ministerio || '').toString().trim() || '—'}</strong></p>
        <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">Se tiver dúvidas, responda este email.</p>
      </td></tr>
      <tr><td style="padding:0 40px 40px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="border-left:3px solid #f59e0b;padding-left:16px;">
            <p style="margin:0;font-size:15px;font-weight:700;color:#1a1a2e;">Com gratidão,</p>
            <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">Equipe Voluntários Celeiro São Paulo</p>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">Igreja Celeiro São Paulo · São Paulo, SP</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`,
        });
      } catch (_) {}
    }

    res.status(201).json({ message: 'Candidatura registrada! Aguarde a aprovação do líder do seu ministério.', candidatura });
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// GET /api/escalas/:id/candidaturas — lista candidaturas de uma escala (com stats de histórico)
// Admin: vê todos. Líder: só candidaturas do(s) ministério(s) que lidera
app.get('/api/escalas/:id/candidaturas', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    let query = { escalaId: req.params.id };
    if (isLider) {
      const nomes = req.userMinisterioNomes && req.userMinisterioNomes.length
        ? req.userMinisterioNomes.map(String).map(s => s.trim()).filter(Boolean)
        : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
      if (!nomes.length) return res.json([]);
      const orConditions = [
        { ministerio: { $in: nomes } },
        ...nomes.map((n) => ({ ministerio: new RegExp(escapeRegex(n), 'i') })),
      ];
      query = { escalaId: req.params.id, $or: orConditions };
    }
    const candidaturas = await Candidatura.find(query).sort({ createdAt: -1 }).lean();
    if (!candidaturas.length) return res.json([]);

    const emails = [...new Set(candidaturas.map(c => c.email).filter(Boolean))];

    // Stats históricos de candidaturas por email (todas as escalas)
    const statsAgg = await Candidatura.aggregate([
      { $match: { email: { $in: emails } } },
      {
        $group: {
          _id: '$email',
          totalParticipacoes: { $sum: { $cond: [{ $eq: ['$status', 'aprovado'] }, 1, 0] } },
          totalDesistencias: { $sum: { $cond: [{ $eq: ['$status', 'desistencia'] }, 1, 0] } },
          totalFaltas: { $sum: { $cond: [{ $eq: ['$status', 'falta'] }, 1, 0] } },
        },
      },
    ]);
    const statsMap = new Map(statsAgg.map(s => [s._id, s]));

    // Total de check-ins por email
    const checkinsAgg = await Checkin.aggregate([
      { $match: { email: { $in: emails } } },
      { $group: { _id: { $toLower: '$email' }, totalCheckins: { $sum: 1 } } },
    ]);
    const checkinsMap = new Map(checkinsAgg.map(c => [c._id, c.totalCheckins]));

    const result = candidaturas.map(c => {
      const stats = statsMap.get(c.email) || {};
      return {
        ...c,
        totalCheckins: checkinsMap.get((c.email || '').toLowerCase()) || 0,
        totalParticipacoes: stats.totalParticipacoes || 0,
        totalDesistencias: stats.totalDesistencias || 0,
        totalFaltas: stats.totalFaltas || 0,
      };
    });
    // Ordenação para curadoria: 1) aprovados primeiro; 2) não aprovados com check-ins anteriores primeiro
    result.sort((a, b) => {
      const aAprovado = a.status === 'aprovado' ? 1 : 0;
      const bAprovado = b.status === 'aprovado' ? 1 : 0;
      if (bAprovado !== aAprovado) return bAprovado - aAprovado;
      const aCheckins = a.totalCheckins || 0;
      const bCheckins = b.totalCheckins || 0;
      if (bCheckins !== aCheckins) return bCheckins - aCheckins;
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    res.json(result);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// PUT /api/candidaturas/:id/status — atualiza status de candidatura
app.put('/api/candidaturas/:id/status', requireAuth, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const { status } = req.body || {};
    const validStatus = ['pendente', 'aprovado', 'desistencia', 'falta'];
    if (!validStatus.includes(status)) return sendError(res, 400, `Status inválido. Use: ${validStatus.join(', ')}`);

    const candidatura = await Candidatura.findById(req.params.id).lean();
    if (!candidatura) return sendError(res, 404, 'Candidatura não encontrada.');

    // Líder só pode alterar candidaturas do seu ministério
    if (isLider) {
      const nomes = req.userMinisterioNomes && req.userMinisterioNomes.length
        ? req.userMinisterioNomes.map(String).map(s => s.trim()).filter(Boolean)
        : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
      const candMin = (candidatura.ministerio || '').toString().trim();
      const pertence = nomes.length > 0 && (
        nomes.includes(candMin) ||
        nomes.some((n) => new RegExp(escapeRegex(n), 'i').test(candMin))
      );
      if (!pertence) return sendError(res, 403, 'Acesso negado. Esta candidatura não é do seu ministério.');
    }

    const update = { status };
    if (status === 'aprovado') { update.aprovadoPor = req.userId; update.aprovadoEm = new Date(); }

    const updated = await Candidatura.findByIdAndUpdate(req.params.id, update, { new: true }).lean();

    // Envia email de confirmação ao aprovar
    if (status === 'aprovado' && !candidatura.emailEnviado && candidatura.email) {
      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey) {
        try {
          const escala = await Escala.findById(candidatura.escalaId).lean();
          const resend = new Resend(apiKey);
          const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
          const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
          const nomeDisplay = (candidatura.nome || '').trim() || 'voluntário(a)';
          const escalaNome = escala?.nome || 'Escala';
          const escalaData = escala?.data ? new Date(escala.data).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
          const { error } = await resend.emails.send({
            from, to: candidatura.email, reply_to: replyTo,
            subject: `Participação confirmada — ${escalaNome}`,
            html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Participação confirmada</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
      <tr><td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
        <p style="margin:0;font-size:13px;color:#f59e0b;text-transform:uppercase;letter-spacing:.1em;font-weight:600;">Igreja Celeiro São Paulo</p>
        <h1 style="margin:8px 0 0;font-size:24px;color:#fff;font-weight:700;">Equipe de Voluntários</h1>
      </td></tr>
      <tr><td style="padding:40px 40px 32px;">
        <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">Olá, <strong>${nomeDisplay}</strong>! 🎉</p>
        <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">Sua participação na escala foi <strong>confirmada</strong>. Estamos animados em contar com você!</p>
        <table cellpadding="0" cellspacing="0" style="margin:24px 0;width:100%;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
          <tr><td style="padding:20px 24px;">
            <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Escala</p>
            <p style="margin:0;font-size:18px;font-weight:700;color:#1a1a2e;">${escalaNome}</p>
            ${escalaData ? `<p style="margin:4px 0 0;font-size:14px;color:#6b7280;">${escalaData}</p>` : ''}
            <p style="margin:12px 0 0;font-size:14px;color:#374151;">Ministério: <strong>${candidatura.ministerio}</strong></p>
          </td></tr>
        </table>
        <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">Você pode acompanhar suas escalas diretamente na plataforma:</p>
        <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
          <tr><td style="border-radius:8px;background:#f59e0b;">
            <a href="https://voluntariosceleirosp.com/" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:700;color:#1a1a2e;text-decoration:none;border-radius:8px;">Ver minhas escalas →</a>
          </td></tr>
        </table>
        <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">Obrigado por servir! Se tiver dúvidas, responda este email.</p>
      </td></tr>
      <tr><td style="padding:0 40px 40px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="border-left:3px solid #f59e0b;padding-left:16px;">
            <p style="margin:0;font-size:15px;font-weight:700;color:#1a1a2e;">Com gratidão,</p>
            <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">Equipe Voluntários Celeiro São Paulo</p>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">Igreja Celeiro São Paulo · São Paulo, SP</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`,
          });
          if (!error) await Candidatura.updateOne({ _id: candidatura._id }, { emailEnviado: true });
        } catch (_) {}
      }
    }

    res.json(updated);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// GET /api/minhas-candidaturas — candidaturas do usuário logado
app.get('/api/minhas-candidaturas', requireAuth, async (req, res) => {
  try {
    const email = (req.userEmail || '').toLowerCase().trim();
    if (!email) return res.json([]);
    const candidaturas = await Candidatura.find({ email }).sort({ createdAt: -1 }).lean();
    // Enriquece com nome da escala
    const escalaIds = [...new Set(candidaturas.map(c => String(c.escalaId)))];
    const escalas = await Escala.find({ _id: { $in: escalaIds } }).select('nome data').lean();
    const escalaMap = new Map(escalas.map(e => [String(e._id), e]));
    const result = candidaturas.map(c => ({
      ...c,
      escalaNome: escalaMap.get(String(c.escalaId))?.nome || '',
      escalaData: escalaMap.get(String(c.escalaId))?.data || null,
    }));
    res.json(result);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// Servir arquivos estáticos (deve estar APÓS as rotas da API)
app.use(express.static(join(__dirname, '..')));

/** Correção única: check-ins com eventoId e dataCheckin errado (bug getEventDateStringSaoPaulo).
 *  Idempotente — registros já corretos não são tocados. */
async function fixDataCheckinOnce() {
  try {
    const checkins = await Checkin.find({ eventoId: { $exists: true, $ne: null } })
      .select('_id eventoId dataCheckin').lean();
    if (!checkins.length) return;
    const eventIds = [...new Set(checkins.map(c => String(c.eventoId)))];
    const eventos = await EventoCheckin.find({ _id: { $in: eventIds } }).select('_id data').lean();
    const eventoMap = new Map(eventos.map(e => [String(e._id), e]));
    let fixed = 0;
    for (const c of checkins) {
      const ev = eventoMap.get(String(c.eventoId));
      if (!ev || !ev.data) continue;
      const d = ev.data instanceof Date ? ev.data : new Date(ev.data);
      const dataCorreta = new Date(d.toISOString().slice(0, 10) + 'T03:00:00.000Z');
      const dataAtual = c.dataCheckin instanceof Date ? c.dataCheckin : new Date(c.dataCheckin);
      if (!dataAtual || dataAtual.getTime() !== dataCorreta.getTime()) {
        await Checkin.updateOne({ _id: c._id }, { $set: { dataCheckin: dataCorreta } });
        fixed++;
      }
    }
    if (fixed > 0) console.log(`✅ fixDataCheckinOnce: ${fixed} check-in(s) corrigidos.`);
  } catch (err) {
    console.error('fixDataCheckinOnce erro:', err.message);
  }
}

// Conectar MongoDB e só então iniciar o servidor (evita "buffering timed out" no login)
async function start() {
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ MongoDB conectado');
      await fixDataCheckinOnce();
      setImmediate(() => syncLegadoVoluntarios()); // Legado: vincular check-ins e garantir voluntários
    } catch (err) {
      console.error('❌ MongoDB erro:', err);
      process.exit(1);
    }
  } else {
    console.warn('MONGODB_URI não configurado - usando apenas cache em memória');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API Celeiro rodando na porta ${PORT}`);
    console.log('POST /api/login - autenticação admin');
    console.log('GET /api/voluntarios - lista voluntários da planilha');
    console.log('GET /api/checkins - lista check-ins e resumo');
    console.log('POST /api/send-email - envia email via Resend (body: { to: string[], subject, html? })');
    const grokKey = (process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim();
    console.log(grokKey ? '✅ Grok API: configurada (versículo do dia + revisão de email)' : '⚠️ Grok API: não configurada (defina GROK_API_KEY no .env ou nas variáveis da cloud)');
  });
}
start();
