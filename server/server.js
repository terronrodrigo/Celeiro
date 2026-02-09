import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
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
import { normalizarEstado, normalizarCidade } from './utils/normalize-locale.js';

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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpe?g|png|gif|webp)$/i.test(file.mimetype)) {
      return cb(new Error('Apenas imagens (JPEG, PNG, GIF, WebP) são permitidas.'));
    }
    cb(null, true);
  },
});

const app = express();
const PORT = process.env.PORT || 3001;
const AUTH_TOKEN_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS || 24);
const ADMIN_USER = (process.env.ADMIN_USER || '').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || '').trim();

app.use(compression());
app.use(cors());
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// POST /api/cadastro - Cadastro público de voluntários (sem auth). Padroniza estado (UF) e cidade.
function parseNascimento(val) {
  if (!val) return undefined;
  if (val instanceof Date) return val;
  const s = String(val).trim();
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

app.post('/api/cadastro', async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'Serviço temporariamente indisponível. Tente em instantes.');

    const body = req.body || {};
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');

    const nome = (body.nome || '').trim();
    const nascimento = parseNascimento(body.nascimento);
    const whatsapp = (body.whatsapp || '').trim();
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
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  next();
}

// Funções de cache
function invalidateCache() {
  cache.voluntarios = null;
  cache.voluntariosTime = 0;
  cache.checkins = null;
  cache.checkinsTime = 0;
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
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

function dateOnlyFromMs(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
  const dataCheckinStr = timestampMs ? new Date(timestampMs).toISOString().slice(0,10) : null;
  const dataCheckin = dataCheckinStr ? getDayRangeUTC(dataCheckinStr).start : null;
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

  // Dedup by email + ministerio + timestamp_ms
  const byKey = new Map();
  checkins.forEach(c => {
    const key = `${c.email}-${c.ministerio}-${c.timestamp_ms || 0}`;
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

app.post('/api/login', async (req, res) => {
  try {
    const { username, password, email } = req.body || {};
    const login = String(email || username || '').trim();
    const senha = String(password || '').trim();
    if (!login || !senha) return res.status(400).json({ error: 'Envie email/usuário e senha.' });

    // 1) Tentar login admin (username do .env)
    if (ADMIN_USER && ADMIN_PASS && login === ADMIN_USER && senha === ADMIN_PASS) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
      authTokens.set(token, { user: ADMIN_USER, userId: null, role: 'admin', email: null, expiresAt });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json({ token, user: { nome: ADMIN_USER, email: null, role: 'admin' }, expiresAt });
    }

    // 2) Login por email (User/voluntário)
    const user = await User.findOne({ email: login.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    if (!user.ativo) return res.status(403).json({ error: 'Usuário desativado.' });
    const valida = await user.compararSenha(senha);
    if (!valida) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    user.ultimoAcesso = new Date();
    await user.save();

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    let ministerioNome = null;
    if (user.role === 'lider' && user.ministerioId) {
      const min = await Ministerio.findById(user.ministerioId).select('nome').lean();
      ministerioNome = min?.nome || null;
    }
    authTokens.set(token, { user: user.nome, userId: user._id, role: user.role, email: user.email, ministerioId: user.ministerioId, ministerioNome, expiresAt });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json({ token, user: { nome: user.nome, email: user.email, role: user.role, ministerioId: user.ministerioId, ministerioNome, fotoUrl: user.fotoUrl || null }, expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao fazer login.' });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const payload = { user: req.user, role: req.userRole, email: req.userEmail };
  if (req.userRole === 'lider' && req.userMinisterioId) {
    payload.ministerioId = req.userMinisterioId;
    payload.ministerioNome = req.userMinisterioNome;
  }
  try {
    const user = await User.findById(req.userId).select('fotoUrl').lean();
    if (user && user.fotoUrl) payload.fotoUrl = user.fotoUrl;
  } catch (_) {}
  res.json(payload);
});

// Upload de foto de perfil (todos os usuários autenticados)
app.post('/api/me/foto', requireAuth, (req, res, next) => {
  uploadFoto.single('foto')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 400, 'Arquivo muito grande. Máximo 5 MB.');
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

app.get('/api/voluntarios', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (isCacheValid('voluntarios')) {
      return res.json(cache.voluntarios);
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

    if (voluntarios.length === 0) {
      return sendError(res, 404, 'Nenhum voluntário encontrado no MongoDB.');
    }
    
    const areasCount = {};
    const dispCount = {};
    const normalized = voluntarios.map(v => ({
      ...v,
      areas: Array.isArray(v.areas) ? v.areas.join(', ') : (v.areas || ''),
      disponibilidade: Array.isArray(v.disponibilidade) ? v.disponibilidade.join(', ') : (v.disponibilidade || ''),
    }));

    const emails = [...new Set(normalized.map(v => (v.email || '').toLowerCase().trim()).filter(Boolean))];
    const usersByEmail = {};
    if (emails.length > 0) {
      const users = await User.find({ email: { $in: emails } }).select('email fotoUrl').lean();
      users.forEach(u => { if (u.email) usersByEmail[u.email.toLowerCase()] = u.fotoUrl || null; });
    }
    normalized.forEach(v => {
      v.fotoUrl = usersByEmail[(v.email || '').toLowerCase()] || null;
    });
    normalized.forEach(v => {
      (v.areas || '').split(',').map(a => a.trim()).filter(Boolean).forEach(a => {
        areasCount[a] = (areasCount[a] || 0) + 1;
      });
      (v.disponibilidade || '').split(',').map(d => d.trim()).filter(Boolean).forEach(d => {
        dispCount[d] = (dispCount[d] || 0) + 1;
      });
    });
    
    const data = {
      voluntarios: normalized,
      resumo: {
        total: normalized.length,
        areas: Object.entries(areasCount).sort((a, b) => b[1] - a[1]),
        disponibilidade: Object.entries(dispCount).sort((a, b) => b[1] - a[1]),
      },
    };
    cache.voluntarios = data;
    cache.voluntariosTime = Date.now();
    res.json(data);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao carregar voluntários');
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
      if (req.userId) query.userId = req.userId;
      else if (req.userEmail) query.email = req.userEmail.toLowerCase();
      else return res.json({ checkins: [], resumo: { total: 0, ministerios: [] } });
    }
    if (dataFiltro) {
      const dateStr = String(dataFiltro).trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const { start, end } = getDayRangeUTC(dateStr);
        if (start && end) query.dataCheckin = { $gte: start, $lt: end };
      }
    }
    if (eventoId) query.eventoId = eventoId;
    if (ministerio) query.ministerio = ministerio;

    let checkinsData = await Checkin.find(query).sort({ timestampMs: -1 }).lean();

    if (isAdmin && checkinsData.length === 0 && CHECKIN_CSV_PATH) {
      await syncCheckins();
      checkinsData = await Checkin.find(query).sort({ timestampMs: -1 }).lean();
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

// Líder: check-ins do seu ministério (ministerio string = nome do ministério do líder)
app.get('/api/checkins/ministerio', requireAuth, async (req, res) => {
  try {
    if (String(req.userRole || '').toLowerCase() !== 'lider' || !req.userMinisterioNome) {
      return res.status(403).json({ error: 'Acesso apenas para líderes de ministério.' });
    }
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const ministerioNome = String(req.userMinisterioNome).trim();
    const { data: dataFiltro } = req.query;
    const query = { ministerio: ministerioNome };
    if (dataFiltro) {
      const dateStr = String(dataFiltro).trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const { start, end } = getDayRangeUTC(dateStr);
        if (start && end) query.dataCheckin = { $gte: start, $lt: end };
      }
    }
    const checkinsData = await Checkin.find(query).sort({ timestampMs: -1 }).lean();
    const ministeriosCount = {};
    checkinsData.forEach(c => {
      const m = (c.ministerio || '').trim();
      if (m) ministeriosCount[m] = (ministeriosCount[m] || 0) + 1;
    });
    const emailsMin = [...new Set(checkinsData.map(c => (c.email || '').toLowerCase().trim()).filter(Boolean))];
    const fotoByEmailMin = {};
    if (emailsMin.length > 0) {
      const users = await User.find({ email: { $in: emailsMin } }).select('email fotoUrl').lean();
      users.forEach(u => { if (u.email) fotoByEmailMin[u.email.toLowerCase()] = u.fotoUrl || null; });
    }
    const normalized = checkinsData.map(c => {
      const ms = c.timestampMs || (c.timestamp ? new Date(c.timestamp).getTime() : null);
      return {
        ...c,
        timestamp: formatDatePtBr(ms),
        timestampMs: ms,
        fotoUrl: fotoByEmailMin[(c.email || '').toLowerCase()] || null,
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

// Timezone para "hoje" e datas de eventos (evita servidor em UTC não bater com Brasil)
const TZ_APP = process.env.TZ || process.env.APP_TIMEZONE || 'America/Sao_Paulo';

/** Retorna a data de hoje no fuso da aplicação como YYYY-MM-DD. */
function getHojeDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_APP });
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
    const { data, label, ativo } = req.body || {};
    if (!data) return sendError(res, 400, 'Campo "data" é obrigatório (YYYY-MM-DD ou ISO).');
    const dateStr = typeof data === 'string' ? data.trim().slice(0, 10) : '';
    const dataOnly = parseDateAsUTC(dateStr);
    if (!dataOnly || Number.isNaN(dataOnly.getTime())) return sendError(res, 400, 'Data inválida.');
    const evento = await EventoCheckin.create({
      data: dataOnly,
      label: label || `Culto ${dataOnly.toLocaleDateString('pt-BR', { timeZone: TZ_APP })}`,
      criadoPor: req.userId,
      ativo: typeof ativo === 'boolean' ? ativo : true,
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

// Voluntário confirma presença no dia (check-in)
app.post('/api/checkins/confirmar', requireAuth, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const { eventoId, ministerio } = req.body || {};
    if (!eventoId) return sendError(res, 400, 'eventoId é obrigatório.');
    const email = req.userEmail || (req.userId && (await User.findById(req.userId).select('email').lean())?.email);
    const nome = req.user || (req.userId && (await User.findById(req.userId).select('nome').lean())?.nome) || req.user;
    if (!email) return sendError(res, 403, 'Usuário sem email. Faça login como voluntário.');

    const evento = await EventoCheckin.findById(eventoId);
    if (!evento || !evento.ativo) return sendError(res, 404, 'Evento não encontrado ou inativo.');
    const hoje = new Date();
    const start = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const eventDate = new Date(evento.data);
    const eventDayStart = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
    if (eventDayStart < start || eventDayStart >= end) return sendError(res, 400, 'Só é possível confirmar check-in no próprio dia do evento.');

    const dataCheckinStr = evento.data.toISOString().slice(0,10);
    const dataCheckin = getDayRangeUTC(dataCheckinStr).start;
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
    invalidateCache();
    res.status(201).json(checkin);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao confirmar check-in.');
  }
});

// Perfil do voluntário/líder (dados no cadastro Voluntario)
app.get('/api/me/perfil', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const email = req.userEmail || (req.userId && (await User.findById(req.userId).select('email').lean())?.email);
    if (!email) return sendError(res, 403, 'Perfil disponível apenas para usuários com email.');
    let perfil = await Voluntario.findOne({ email: email.toLowerCase() }).lean();
    if (!perfil) return res.json(null);
    const areasStr = Array.isArray(perfil.areas) ? perfil.areas.join(', ') : (perfil.areas || '');
    res.json({ ...perfil, areas: areasStr });
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
    if (body.nascimento != null && typeof body.nascimento === 'string') body.nascimento = parseNascimento(body.nascimento) || body.nascimento;
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

app.post('/api/send-email', requireAuth, requireAdmin, async (req, res) => {
  const { to, subject, html, text, voluntarios: voluntariosMap } = req.body;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <onboarding@resend.dev>';

  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY não configurada. Configure no .env do servidor.' });
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

  try {
    const results = [];
    for (const email of validTo) {
      const htmlFinal = baseHtml ? personalize(baseHtml, email) : undefined;
      const { data, error } = await resend.emails.send({
        from,
        to: email,
        subject,
        html: htmlFinal,
        text: !html && text ? personalize(text, email) : undefined,
      });
      results.push({ email, id: data?.id, error: error?.message });
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
    
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    authTokens.set(token, { user: email, userId: user._id, role: user.role, expiresAt });
    
    res.status(201).json({ token, user: user.toJSON(), expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao registrar usuário.' });
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
    
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    authTokens.set(token, { user: email, userId: user._id, role: user.role, expiresAt });
    
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
    await user.save();
    
    res.json({ ok: true, mensagem: 'Senha alterada com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao trocar senha.' });
  }
});

// GET /api/ministros - Listar ministérios (admin)
app.get('/api/ministros', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const list = await Ministerio.find({}).sort({ nome: 1 }).lean();
    const withLeaders = await Promise.all(list.map(async (m) => {
      const leader = await User.findOne({ ministerioId: m._id, role: 'lider', ativo: true }).select('nome email').lean();
      return { ...m, lider: leader };
    }));
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

// PUT /api/ministros/:id - Atualizar ministério ou atribuir líder (admin)
app.put('/api/ministros/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nome, ativo, liderId } = req.body;
    const minist = await Ministerio.findById(req.params.id);
    if (!minist) return sendError(res, 404, 'Ministério não encontrado.');
    if (nome != null) minist.nome = String(nome).trim();
    if (ativo !== undefined) minist.ativo = !!ativo;
    await minist.save();
    if (liderId !== undefined) {
      const exLideres = await User.find({ ministerioId: minist._id }).select('_id role').lean();
      for (const u of exLideres) {
        await RoleHistory.create({ userId: u._id, fromRole: u.role || 'lider', toRole: 'voluntario', ministerioId: minist._id, changedBy: req.userId });
      }
      await User.updateMany({ ministerioId: minist._id }, { $unset: { ministerioId: 1 }, role: 'voluntario' });
      if (liderId) {
        await User.findByIdAndUpdate(liderId, { ministerioId: minist._id, role: 'lider' });
        await RoleHistory.create({ userId: liderId, fromRole: 'voluntario', toRole: 'lider', ministerioId: minist._id, changedBy: req.userId });
      }
    }
    res.json(minist);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao atualizar ministério.');
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

// GET /api/users - Listar todos os usuários (admin only)
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const mongoReady = mongoose.connection.readyState === 1;
    if (!mongoReady) return sendError(res, 500, 'MongoDB não conectado.');
    const users = await User.find({}, '-senha').populate('ministerioId', 'nome').lean();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao listar usuários.' });
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

// PUT /api/users/:id - Editar usuário e role (admin); registra histórico
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nome, role, ativo, ministerioId } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return sendError(res, 404, 'Usuário não encontrado.');
    const fromRole = user.role;
    const fromMinisterioId = user.ministerioId;
    const updates = {};
    if (nome !== undefined) updates.nome = nome;
    if (ativo !== undefined) updates.ativo = ativo;
    if (role !== undefined) {
      if (!['admin', 'voluntario', 'lider'].includes(role)) return sendError(res, 400, 'Role inválido.');
      updates.role = role;
    }
    const newRole = role !== undefined ? role : user.role;
    if (ministerioId !== undefined) updates.ministerioId = newRole === 'lider' ? ministerioId || null : null;
    const updated = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).populate('ministerioId', 'nome');
    if (role !== undefined && role !== fromRole) {
      await RoleHistory.create({
        userId: user._id,
        fromRole,
        toRole: role,
        ministerioId: role === 'lider' ? (ministerioId || updated.ministerioId) : fromMinisterioId,
        changedBy: req.userId,
      });
    } else if (newRole === 'lider' && ministerioId !== undefined && String(ministerioId || '') !== String(fromMinisterioId || '')) {
      await RoleHistory.create({
        userId: user._id,
        fromRole: 'lider',
        toRole: 'lider',
        ministerioId: ministerioId || updated.ministerioId,
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

// DELETE /api/users/:id - Deletar usuário (admin only)
app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    
    res.json({ ok: true, mensagem: 'Usuário deletado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao deletar usuário.' });
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

// Servir arquivos estáticos (deve estar APÓS as rotas da API)
app.use(express.static(join(__dirname, '..')));

// Conectar MongoDB
if (!process.env.MONGODB_URI) {
  console.warn('MONGODB_URI não configurado - usando apenas cache em memória');
} else {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ MongoDB erro:', err));
}

// Iniciar servidor (0.0.0.0 para aceitar conexões em container/cloud)
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Celeiro rodando na porta ${PORT}`);
  console.log('POST /api/login - autenticação admin');
  console.log('GET /api/voluntarios - lista voluntários da planilha');
  console.log('GET /api/checkins - lista check-ins e resumo');
  console.log('POST /api/send-email - envia email via Resend (body: { to: string[], subject, html? })');
});
