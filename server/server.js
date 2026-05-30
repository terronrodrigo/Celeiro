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
import Igreja from './models/Igreja.js';
import Voluntario from './models/Voluntario.js';
import Checkin from './models/Checkin.js';
import EventoCheckin from './models/EventoCheckin.js';
import Ministerio from './models/Ministerio.js';
import RoleHistory from './models/RoleHistory.js';
import Escala from './models/Escala.js';
import Candidatura from './models/Candidatura.js';
import EscalaInscricoesPorMinisterio from './models/EscalaInscricoesPorMinisterio.js';
import EventoFormulario from './models/EventoFormulario.js';
import FormularioMembro from './models/FormularioMembro.js';
import FormularioConsolidacao from './models/FormularioConsolidacao.js';
import FormularioBatismo from './models/FormularioBatismo.js';
import FormularioApresentacao from './models/FormularioApresentacao.js';
import { normalizarEstado, normalizarCidade } from './utils/normalize-locale.js';
import { createWhatsAppHandler } from './whatsapp/handler.js';
import { processBrdidWebhook, getLastVerification } from './brdid/whatsapp-verification.js';
import { resolveTenant, tQ, publicIgrejaFromRequest, DEFAULT_IGREJA_SLUG, listIgrejasAtivas } from './tenant-context.js';
import { initDatabase, isDbReady, isMongo, isPostgres, getDbMode } from './db/connection.js';
import { EMPTY_VOLUNTARIOS, EMPTY_ARRAY, emptyCheckinsPayload } from './db/stubs.js';
import {
  resolveUserForEmailPasswordLogin,
  loadMinisterioNomesForUserPg,
  touchUserOnLoginPg,
  GLOBAL_LOGIN_SLUG,
  choicesForMultiTenantLoginPg,
} from './db/login.js';
import {
  pgHasAdmin, pgCreateAdmin, pgFindUserById, pgFindUsersByEmail, pgFindMinisteriosByIds, pgFindIgrejaById,
  pgFindIgrejaBySlug,
  pgListMinisterios, pgFindMinisterioByNome, pgCreateMinisterio, pgLeadersByMinisterioId,
  pgListUsers, pgFindUserByEmailInIgreja, pgCreateUser, pgUpdateUser, pgUpsertUserWithPasswordHash,
  pgSetUserResetToken, pgFindUserByResetToken, pgUpdateUserPassword,
  pgFindVoluntarioByEmail, pgUpsertVoluntarioPerfil,
  pgSetUserFotoUrl, pgFindUserFotoUrl,
  pgFindMinisterioById, pgUpdateMinisterio, pgDeleteMinisterio, pgSetMinisterioLideres,
  pgListRoleHistoryByUser,
} from './db/postgres/repos.js';
import {
  pgListEscalas, pgFindEscalaById, pgFindEscalasByIds, pgCreateEscala, pgUpdateEscala, pgCountCandidaturasByEscala,
  pgListEventosCheckin, pgListEventosCheckinHoje, pgFindEventoCheckinById,
  pgCreateEventoCheckin, pgUpdateEventoCheckin, pgDeleteEventoCheckin, pgBulkDeleteEventosCheckin, pgCreateCheckin,
  pgCreateCandidatura, pgFindCandidaturaDuplicada, pgFindEventoCheckinPorData,
  pgListCandidaturasByEscalaIds,
  pgDeleteEscala, pgBulkDeleteEscalas, pgGetEscalaInscricaoStatus, pgSetEscalaInscricaoStatus,
  pgCountAprovadosByMinisterio, pgAutoLinkEscalasOrfas, pgFindEscalaByEventoCheckin,
  pgListAcompanhamentoEscala, pgBackfillCheckinCandidaturas, pgAutoMarcarFaltas,
  pgListMinhasCandidaturasParaEscalas, pgFindEventosCheckinByIds, pgListMeusCheckins,
  pgClearEventoAberturaEmailEnviado,
  pgListEventosCheckinSemEscalaAtiva,
  pgPurgeEventosCheckinSemEscalaAtiva,
} from './db/postgres/escalas-checkin.js';
import { buildCheckinPublicUrl, resolveAppBaseUrl } from './lib/checkin-public-url.js';
import { generateCheckinQrPng } from './lib/checkin-qrcode.js';
import { sendCheckinAberturaEmailsForEvento, runCheckinAberturaEmailJob } from './lib/checkin-abertura-email.js';
import {
  runEscalaLembreteEmailJob,
  sendEscalaLembreteEmailsForIgreja,
  getCultoDataYmdForLembrete,
  resolveEscalaLembreteTipoForToday,
} from './lib/escala-lembrete-email.js';
import {
  pgListEventosFormulario, pgFindEventoFormularioById, pgCreateEventoFormulario,
  pgUpdateEventoFormulario, pgDeleteEventoFormulario,
  pgCreateFormularioMembro, pgListFormulariosMembro,
  pgCreateFormularioConsolidacao, pgListFormulariosConsolidacao,
  pgCreateFormularioBatismo, pgListFormulariosBatismoByEvento,
  pgCreateFormularioApresentacao, pgListFormulariosApresentacaoByEvento,
} from './db/postgres/formularios.js';
import {
  buildVisaoConsolidada,
  formatVisaoConsolidadaTexto,
  pickDayFromVisao,
  parseDataQuery,
  detectTurnoEscala,
} from './lib/escala-consolidada.js';
import { weekdayBrasilia, addDaysYmd } from './lib/brasilia.js';
import {
  pgListCultosRecorrentes, pgFindCultoRecorrente, pgCreateCultoRecorrente,
  pgUpdateCultoRecorrente, pgDeleteCultoRecorrente, syncCultosRecorrentes,
  startRecurringCultosScheduler,
} from './db/postgres/cultos-recorrentes.js';
import { DIAS_SEMANA, formatDataPtBr } from './lib/brasilia.js';
import { buildWaMeUrl, buildMensagemAprovacaoEscala, phoneToWaMeDigits } from './lib/whatsapp-links.js';
import { isValidEntityId } from './lib/ids.js';
import { filterCandidaturasForLider, voluntarioMatchesLiderMinisterios, normalizeVoluntarioMinisteriosPatch, splitVoluntarioMinisterios } from './lib/ministerio-match.js';
import { enrichCandidaturasForPanel } from './lib/candidatura-enrich.js';
import {
  isWithinCheckinWindow,
  isCheckinEventAberto,
  isEscalaAbertaParaCandidatura,
  sortEscalasByDataDesc,
  checkinFechadoMensagem,
} from './lib/escala-checkin-rules.js';
import {
  pgListVoluntarios, pgListVoluntarioEmails, buildVoluntariosResumo, pgEnsureVoluntarioInList,
  pgBackfillVoluntariosFromCheckins,
  pgListCheckins, pgListCandidaturasByEscala, pgFindCandidaturaById,
  pgUpdateCandidaturaStatus, pgBulkUpdateCandidaturaStatus, pgCandidaturaStatsByEmails,
  pgListCandidaturasByEmail, pgListCandidaturasForEscalas,
  pgListCheckinEmails,
  getPostgresPool,
  pgAttachParticipacaoStats, computePerfilCheckinGap, pgApplyCheckinComplemento,
} from './db/postgres/operational-data.js';
import {
  pgFindConviteByToken, pgUpsertConviteLider, pgListConvitesLider,
  pgIncrementConviteUso, conviteLiderValido,
} from './db/postgres/convites-lider.js';
import {
  pgSaveAuthSession, pgLoadAuthSession, pgDeleteAuthSession,
} from './db/postgres/auth-sessions.js';

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

/** Converte string data-only (YYYY-MM-DD) como data civil em Brasília; retorna 00:00 BRT em UTC. Usado para escalas. */
function parseDateOnlyToUTC(dateStr) {
  if (dateStr == null || dateStr === '') return null;
  if (dateStr instanceof Date) {
    const s = dateStr.toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
    return parseDateAsBrasilia(s);
  }
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(match[0] + 'T03:00:00.000Z');
  return new Date(str);
}

/** Retorna data da escala como YYYY-MM-DD no fuso de Brasília para exibição no cliente. */
function escalaDataToYMD(dateVal) {
  if (dateVal == null) return null;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
}

const app = express();
app.set('trust proxy', 1); // Necessário quando atrás de reverse proxy (Railway, Render, etc.)
const PORT = process.env.PORT || 3001;
const AUTH_TOKEN_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS || 24);
const ADMIN_USER = (process.env.ADMIN_USER || '').trim();
const ADMIN_PASS = (process.env.ADMIN_PASS || '').trim();
const SETUP_SECRET = (process.env.SETUP_SECRET || '').trim();

app.use(compression());
const corsOrigins = (process.env.CORS_ORIGINS || process.env.APP_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (corsOrigins.length) {
  app.use(cors({
    origin(origin, cb) {
      if (!origin || corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS bloqueado'));
    },
    credentials: true,
  }));
} else if (process.env.NODE_ENV === 'production') {
  app.use(cors({ origin: false }));
} else {
  app.use(cors());
}

// WhatsApp webhook precisa do body raw para verificar assinatura (antes de express.json)
const createAuthTokenForUser = async (user) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
  let ministerioIds = Array.isArray(user.ministerioIds) ? user.ministerioIds : [];
  if (ministerioIds.length === 0 && user.ministerioId) ministerioIds = [user.ministerioId];
  ministerioIds = ministerioIds.map((m) => (m && typeof m === 'object' && m._id != null ? m._id : m)).filter(Boolean);
  const ministerioNomes = [];
  const minFilter = user.igrejaId ? { _id: { $in: ministerioIds }, igrejaId: user.igrejaId } : { _id: { $in: ministerioIds } };
  if (ministerioIds.length > 0) {
    if (isMongo()) {
      const mins = await Ministerio.find(minFilter).select('nome').lean();
      mins.forEach(m => { if (m?.nome) ministerioNomes.push(m.nome); });
    } else if (isPostgres() && user.igrejaId) {
      const mins = await pgFindMinisteriosByIds(ministerioIds, user.igrejaId);
      mins.forEach(m => { if (m?.nome) ministerioNomes.push(m.nome); });
    }
  }
  const ministerioId = ministerioIds[0] || null;
  const ministerioNome = ministerioNomes[0] || null;
  const roleNorm = String(user.role || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || 'voluntario';
  const roleFinal = roleNorm === 'lider' || roleNorm.includes('lider') ? 'lider' : roleNorm;
  const igrejaIdStr = user.igrejaId ? String(user.igrejaId) : null;
  const isGlobalAdmin = roleFinal === 'admin' && !user.igrejaId;
  const sessionData = {
    user: user.nome, userId: user._id, role: roleFinal, email: user.email,
    ministerioId, ministerioNome, ministerioIds, ministerioNomes, expiresAt,
    mustChangePassword: !!user.mustChangePassword,
    igrejaId: igrejaIdStr,
    isGlobalAdmin,
  };
  const sessionPersisted = await persistAuthToken(token, sessionData);
  return { token, expiresAt, sessionPersisted };
};
const whatsappHandler = createWhatsAppHandler({ createAuthTokenForUser });
const whatsappWebhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });
app.get('/api/whatsapp/webhook', (req, res) => whatsappHandler.handleVerify(req, res));
app.post('/api/whatsapp/webhook', whatsappWebhookLimiter, express.raw({ type: 'application/json' }), (req, res) => whatsappHandler.handleWebhook(req, res));

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
  voluntariosIgrejaId: null,
  checkins: null,
  checkinsTime: 0,
  checkinsIgrejaId: null,
};
const CACHE_TTL = (Number(process.env.CACHE_TTL_MINUTES) || 30) * 60 * 1000;

const authTokens = new Map();

function matchesEnvAdminCredentials(login, senha) {
  if (!ADMIN_USER || !ADMIN_PASS) return false;
  const u = String(login || '').trim();
  const adminUser = String(ADMIN_USER).trim();
  const userOk = u === adminUser
    || u.toLowerCase() === adminUser.toLowerCase()
    || (adminUser.includes('@') && u.toLowerCase() === adminUser.toLowerCase());
  return userOk && String(senha) === String(ADMIN_PASS);
}

async function persistAuthToken(token, data) {
  authTokens.set(token, data);
  if (!isPostgres()) return true;
  try {
    await pgSaveAuthSession(token, data);
    return true;
  } catch (err) {
    console.error('Erro ao persistir sessão:', err.message || err);
    return false;
  }
}

async function loadAuthTokenData(token) {
  const cached = authTokens.get(token);
  if (cached && !isTokenExpired(cached)) return cached;
  if (!isPostgres()) return cached || null;
  const fromPg = await pgLoadAuthSession(token);
  if (fromPg) {
    authTokens.set(token, fromPg);
    return fromPg;
  }
  return null;
}

// Segurança: headers HTTP (Helmet) e rate limiting em rotas sensíveis
app.use(helmet({ contentSecurityPolicy: false })); // CSP desativado para não quebrar recursos estáticos/APIs

// Request id middleware: propaga x-request-id ou gera um curto, usado em logs e respostas 5xx.
app.use((req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req._requestId = (incoming && String(incoming).slice(0, 36)) || crypto.randomBytes(4).toString('hex');
  res.setHeader('x-request-id', req._requestId);
  next();
});
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
app.use('/api/auth/register-lider', cadastroLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/cadastro', cadastroLimiter);
app.use('/api/checkin-public', publicCheckinLimiter);
const formularioPublicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: 'Muitas requisições. Aguarde um pouco.' },
});
app.use('/api/formulario-publico', formularioPublicLimiter);
app.use('/api/formularios/membro', cadastroLimiter);
app.use('/api/formularios/consolidacao', cadastroLimiter);
const candidaturaPublicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: 'Muitas candidaturas. Aguarde um pouco.' },
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: isDbReady() ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    db: getDbMode(),
    mongodb: isMongo() ? 'connected' : 'disconnected',
    postgres: isPostgres() ? 'connected' : 'disconnected',
  });
});

/** Rotas que ainda usam Mongoose: em modo só-Postgres devolvem payload vazio até migração do Mongo. */
function guardMongoData(res, emptyPayload, message = 'Banco de dados indisponível.') {
  if (!isDbReady()) {
    sendError(res, 503, message);
    return false;
  }
  if (!isMongo()) {
    res.json(emptyPayload);
    return false;
  }
  return true;
}

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
    if (!isDbReady()) return sendError(res, 503, 'Serviço temporariamente indisponível.');

    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Use ?igreja=slug na URL ou igrejaSlug no corpo.');

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

    if (isPostgres()) {
      const igrejaId = String(igrejaDoc._id);
      const existing = await pgFindVoluntarioByEmail(igrejaId, email);
      await pgUpsertVoluntarioPerfil(igrejaId, email, clean);
      invalidateCache();
      return res.status(existing ? 200 : 201).json({
        ok: true,
        message: existing ? 'Cadastro atualizado com sucesso.' : 'Cadastro realizado com sucesso.',
      });
    }
    if (!isMongo()) return sendError(res, 503, 'Cadastro indisponível até migração dos dados.');

    const existing = await Voluntario.findOne({ email, igrejaId: igrejaDoc._id });
    if (existing) {
      await Voluntario.updateOne({ email, igrejaId: igrejaDoc._id }, { $set: clean });
      return res.status(200).json({ ok: true, message: 'Cadastro atualizado com sucesso.' });
    }
    await Voluntario.create({ ...clean, igrejaId: igrejaDoc._id });
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

async function requireAuth(req, res, next) {
  try {
    const token = getAuthToken(req);
    if (!token) return res.status(401).json({ error: 'Não autenticado.' });
    const data = await loadAuthTokenData(token);
    if (!data || isTokenExpired(data)) {
      authTokens.delete(token);
      if (isPostgres()) await pgDeleteAuthSession(token).catch(() => {});
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
    req.authIgrejaIdStr = data.igrejaId != null && data.igrejaId !== '' ? String(data.igrejaId) : null;
    req.authIsGlobalAdmin = data.isGlobalAdmin === true;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
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

// Lista igrejas (admin global: todas; admin vinculado a uma igreja: só a sua). Sem resolveTenant.
app.get('/api/igrejas', requireAuth, async (req, res) => {
  try {
    if (!isDbReady()) return sendError(res, 503, 'Banco de dados indisponível.');
    if (req.authIsGlobalAdmin) {
      const list = await listIgrejasAtivas();
      return res.json(list);
    }
    if (req.userRole === 'admin' && req.authIgrejaIdStr) {
      if (isMongo() && !mongoose.Types.ObjectId.isValid(req.authIgrejaIdStr)) {
        return res.json([]);
      }
      const ig = isMongo()
        ? await Igreja.findById(req.authIgrejaIdStr).select('nome slug ativo').lean()
        : await pgFindIgrejaById(req.authIgrejaIdStr);
      return res.json(ig ? [ig] : []);
    }
    return res.status(403).json({ error: 'Acesso negado.' });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao listar igrejas.');
  }
});

// ─── WhatsApp: mensagens via wa.me (sem custo de API) ─────────────────────────
/** Monta texto + link wa.me para avisar voluntário (aprovação de escala + check-in do dia). */
app.get('/api/whatsapp/mensagem-escala', requireAuth, resolveTenant, async (req, res) => {
  try {
    const role = String(req.userRole || '').toLowerCase();
    if (role !== 'admin' && role !== 'lider') return sendError(res, 403, 'Acesso negado.');
    const escalaId = (req.query.escalaId || '').trim();
    const telefone = (req.query.telefone || '').trim();
    const nome = (req.query.nome || '').trim();
    if (!escalaId) return sendError(res, 400, 'escalaId é obrigatório.');
    if (!telefone) return sendError(res, 400, 'telefone é obrigatório.');
    const digits = phoneToWaMeDigits(telefone);
    if (!digits) return sendError(res, 400, 'Telefone inválido. Use DDD + número (10 ou 11 dígitos).');

    let escala = null;
    let eventoCheckinId = null;
    if (isPostgres()) {
      escala = await pgFindEscalaById(escalaId, req.tenantIgrejaId);
      if (!escala) return sendError(res, 404, 'Escala não encontrada.');
      const ymd = escala.data ? escalaDataToYMD(escala.data) : null;
      if (ymd) {
        const ev = await pgFindEventoCheckinPorData(req.tenantIgrejaId, ymd);
        if (ev) eventoCheckinId = ev._id;
      }
    } else if (isMongo()) {
      escala = await Escala.findOne({ _id: escalaId, ...tQ(req) }).lean();
      if (!escala) return sendError(res, 404, 'Escala não encontrada.');
      const ymd = escala.data ? escalaDataToYMD(escala.data) : null;
      if (ymd) {
        const { start, end } = getDayRangeBrasilia(ymd);
        const ev = await EventoCheckin.findOne({
          ...tQ(req),
          ativo: true,
          data: { $gte: start, $lt: end },
        }).select('_id').lean();
        if (ev) eventoCheckinId = ev._id;
      }
    } else {
      return sendError(res, 503, 'Banco indisponível.');
    }

    const slug = req.tenantIgrejaSlug || DEFAULT_IGREJA_SLUG;
    const base = (process.env.APP_URL || '').replace(/\/$/, '')
      || `${req.protocol}://${req.get('host')}`;
    const appBase = base || 'https://voluntariosceleirosp.com';
    let checkinUrl = '';
    if (eventoCheckinId) {
      checkinUrl = `${appBase}?checkin=${encodeURIComponent(eventoCheckinId)}&igreja=${encodeURIComponent(slug)}`;
    }
    const escalaDataLabel = escala.data
      ? new Date(escala.data).toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })
      : '';
    const texto = buildMensagemAprovacaoEscala({
      nomeVoluntario: nome,
      escalaNome: escala.nome,
      escalaDataLabel,
      checkinUrl,
      liderNome: req.user,
    });
    const waUrl = buildWaMeUrl(telefone, texto);
    res.json({
      metodo: 'wa_me',
      custo: 'gratuito',
      observacao: 'Abre o WhatsApp do líder com a mensagem pronta. Não usa API paga da Meta (evita custo fora da janela de 24h).',
      texto,
      waUrl,
      checkinUrl: checkinUrl || null,
      telefoneE164: digits,
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao montar mensagem.');
  }
});

// ─── BR DID – Webhook verificação WhatsApp (https://brdid.com.br/api-docs/) ───
// POST: recebe dados da chamada/áudio quando WhatsApp envia código de verificação
// Protege opcionalmente com token compartilhado em BRDID_WEBHOOK_TOKEN.
const brdidWebhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.post('/api/brdid/whatsapp-verification', brdidWebhookLimiter, async (req, res) => {
  try {
    if (process.env.BRDID_WEBHOOK_TOKEN) {
      const provided = (
        req.headers['x-brdid-token']
        || req.query?.token
        || req.body?.token
        || ''
      ).toString();
      if (provided !== process.env.BRDID_WEBHOOK_TOKEN) {
        return res.status(401).json({ status: 'erro', message: 'Não autorizado.' });
      }
    }
    const payload = req.body || {};
    const result = await processBrdidWebhook(payload);
    res.status(200).json({ status: 'ok', recebido: true, codigo: result.codigo_extraido || null });
  } catch (err) {
    const isProd = process.env.NODE_ENV === 'production';
    console.error('BR DID webhook erro:', err?.message || err);
    res.status(500).json({ status: 'erro', message: isProd ? 'Erro interno.' : err.message });
  }
});
// GET: admin consulta último código recebido (para digitar no WhatsApp Business)
app.get('/api/brdid/whatsapp-verification/latest', requireAuth, resolveTenant, requireAdmin, (req, res) => {
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
/** Contagem de inscrições/aprovações em escala e check-ins por email (Mongo). */
async function mongoAttachParticipacaoStats(req, voluntarios) {
  if (!voluntarios?.length || !isMongo()) return voluntarios || [];
  const emails = [...new Set(voluntarios.map((v) => (v.email || '').toLowerCase().trim()).filter(Boolean))];
  if (!emails.length) return voluntarios;
  const baseMatch = { ...tQ(req), email: { $in: emails } };
  const [candAgg, ckAgg] = await Promise.all([
    Candidatura.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { $toLower: '$email' },
          vezesEscalaInscricao: { $sum: 1 },
          vezesEscalaAprovado: { $sum: { $cond: [{ $eq: ['$status', 'aprovado'] }, 1, 0] } },
        },
      },
    ]),
    Checkin.aggregate([
      { $match: baseMatch },
      { $group: { _id: { $toLower: '$email' }, vezesCheckin: { $sum: 1 } } },
    ]),
  ]);
  const mc = new Map(candAgg.map((x) => [x._id, x]));
  const mk = new Map(ckAgg.map((x) => [x._id, x.vezesCheckin]));
  return voluntarios.map((v) => {
    const em = (v.email || '').toLowerCase().trim();
    const c = mc.get(em);
    return {
      ...v,
      vezesEscalaAprovado: c?.vezesEscalaAprovado ?? 0,
      vezesEscalaInscricao: c?.vezesEscalaInscricao ?? 0,
      vezesCheckin: mk.get(em) ?? 0,
    };
  });
}

function invalidateCache() {
  cache.voluntarios = null;
  cache.voluntariosTime = 0;
  cache.voluntariosIgrejaId = null;
  cache.checkins = null;
  cache.checkinsTime = 0;
  cache.checkinsIgrejaId = null;
}

/** Garante que o email esteja na lista de voluntários (mesmo com dados incompletos). Usado em registro, role voluntário e check-in. */
async function ensureVoluntarioInList({ email, nome, ministerio, igrejaId, telefone } = {}) {
  const em = (email || '').toString().trim().toLowerCase();
  if (!em || !em.includes('@')) return null;
  if (!igrejaId) return null;
  const telStr = (telefone || '').toString().trim();
  if (isPostgres()) {
    return pgEnsureVoluntarioInList({ email: em, nome, ministerio, igrejaId, telefone: telStr });
  }
  const setFields = {};
  const nomeStr = (nome || '').toString().trim();
  if (nomeStr) setFields.nome = nomeStr;
  const minStr = (ministerio || '').toString().trim();
  if (minStr) {
    const doc = await Voluntario.findOne({ email: em, igrejaId }).select('ministerio ministerios').lean();
    const cur = splitVoluntarioMinisterios(doc || {});
    const set = new Set(cur);
    set.add(minStr);
    const arr = [...set];
    setFields.ministerio = arr.join(', ');
    setFields.ministerios = arr;
  }
  if (telStr) setFields.telefone = telStr;
  const update = {
    $setOnInsert: {
      email: em, igrejaId, ativo: true, fonte: 'manual', timestamp: new Date(), timestampMs: Date.now(),
    },
    ...(Object.keys(setFields).length ? { $set: setFields } : {}),
  };
  const doc = await Voluntario.findOneAndUpdate(
    { email: em, igrejaId },
    update,
    { upsert: true, new: true }
  ).lean();
  return doc;
}

/** Grava batismo no perfil (Mongo) só se ainda não está definido como sim/não. */
async function mergeVoluntarioBatizadoMongo(email, igrejaId, batizado) {
  if (batizado !== true && batizado !== false) return;
  const em = (email || '').toString().trim().toLowerCase();
  if (!em || !igrejaId) return;
  const cur = await Voluntario.findOne({ email: em, igrejaId }).select('batizado').lean();
  if (!cur) return;
  if (cur.batizado === true || cur.batizado === false) return;
  await Voluntario.updateOne({ _id: cur._id }, { $set: { batizado } });
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
    const users = await User.find({}).select('email nome igrejaId').lean();
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
        if (u.igrejaId) {
          await ensureVoluntarioInList({ email: em, nome: (u.nome || '').toString().trim(), igrejaId: u.igrejaId });
        }
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
  const isProd = process.env.NODE_ENV === 'production';
  const requestId = res?.req?._requestId || crypto.randomBytes(4).toString('hex');
  const safeMessage = isProd && status >= 500
    ? `Erro interno. Tente novamente ou contate o suporte. (id ${requestId})`
    : message;
  if (status >= 500) {
    try {
      const route = res?.req ? `${res.req.method} ${res.req.originalUrl || res.req.url}` : 'unknown';
      console.error(`[err ${requestId}] ${status} ${route}: ${message}`);
    } catch (_) {}
  }
  const payload = { error: safeMessage, requestId };
  if (details && !isProd) payload.details = details;
  res.setHeader('x-request-id', requestId);
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

async function syncVoluntariosFromText(text, igrejaId) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB não conectado. Configure MONGODB_URI no .env.');
  }
  if (!igrejaId) {
    throw new Error('igrejaId é obrigatório para importar voluntários (escopo da igreja).');
  }
  const rows = parseCsvRows(text);
  if (!rows.length) return { inserted: 0, updated: 0 };
  const headers = rows[0].map(h => (h || '').trim());
  const colMap = buildColMap(headers, COLS);
  const voluntarios = rows.slice(1).map(row => rowToVoluntario(headers, row, colMap)).filter(Boolean);
  const byEmail = new Map();
  voluntarios.forEach(v => byEmail.set(v.email.toLowerCase(), v));
  const unique = Array.from(byEmail.values());

  const operations = unique.map((doc) => ({
    updateOne: {
      filter: { email: doc.email.toLowerCase(), igrejaId },
      update: { $set: { ...doc, igrejaId, fonte: 'planilha', ativo: true } },
      upsert: true,
    },
  }));
  const result = await Voluntario.bulkWrite(operations, { ordered: false });
  invalidateCache();
  return { inserted: result.upsertedCount || 0, updated: result.modifiedCount || 0 };
}

async function syncCheckinsFromText(text, igrejaId) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB não conectado. Configure MONGODB_URI no .env.');
  }
  if (!igrejaId) {
    throw new Error('igrejaId é obrigatório para importar check-ins.');
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

  const operations = unique.map((doc) => ({
    updateOne: {
      filter: { email: doc.email, ministerio: doc.ministerio, timestampMs: doc.timestampMs, igrejaId },
      update: { $set: { ...doc, igrejaId } },
      upsert: true,
    },
  }));
  const result = await Checkin.bulkWrite(operations, { ordered: false });
  invalidateCache();
  return { inserted: result.upsertedCount || 0, updated: result.modifiedCount || 0 };
}

async function syncVoluntarios(igrejaId) {
  const text = await readCsvTextFromSource({
    path: VOLUNTARIOS_CSV_PATH,
    url: VOLUNTARIOS_CSV_PATH ? '' : CSV_URL,
  });
  return await syncVoluntariosFromText(text, igrejaId);
}

async function syncCheckins(igrejaId) {
  const text = await readCsvTextFromSource({
    path: CHECKIN_CSV_PATH,
    url: '',
  });
  return await syncCheckinsFromText(text, igrejaId);
}

/** CSV/Sheets legados da plataforma (voluntários + check-ins) são sempre do Celeiro. */
async function getCeleiroIgrejaIdForLegacyImport() {
  const g = await Igreja.findOne({ slug: DEFAULT_IGREJA_SLUG }).select('_id').lean();
  if (!g?._id) {
    throw new Error(`Igreja "${DEFAULT_IGREJA_SLUG}" não encontrada. Rode: node scripts/migrate-multi-igreja.js`);
  }
  return g._id;
}

/** Detecta erro de índice legado único em users.email (sem igrejaId). */
function isLegacyUsersEmailIndexConflict(err) {
  if (!err || err.code !== 11000) return false;
  const msg = String(err.message || '');
  return msg.includes('collection:') && msg.includes('.users') && msg.includes('index: email_1');
}

/** Garante índice composto de users por tenant e remove índice legado email_1 quando existir. */
async function ensureUsersTenantEmailIndex() {
  if (mongoose.connection.readyState !== 1) return { changed: false };
  const col = mongoose.connection.db.collection('users');
  const indexes = await col.indexes();
  const hasLegacyEmailUnique = indexes.some((i) => (
    i?.name === 'email_1'
    && i?.unique === true
    && i?.key
    && Object.keys(i.key).length === 1
    && i.key.email === 1
  ));
  if (hasLegacyEmailUnique) {
    await col.dropIndex('email_1');
  }
  const hasTenantComposite = indexes.some((i) => (
    i?.name === 'email_1_igrejaId_1'
    && i?.unique === true
    && i?.key?.email === 1
    && i?.key?.igrejaId === 1
  ));
  if (!hasTenantComposite) {
    await col.createIndex({ email: 1, igrejaId: 1 }, { unique: true, name: 'email_1_igrejaId_1' });
  }
  return { changed: hasLegacyEmailUnique || !hasTenantComposite };
}

/** Tenta criar usuário; se bater no índice legado email_1, auto-corrige índices e tenta uma vez de novo. */
async function createUserWithLegacyIndexSelfHeal(payload) {
  try {
    return await User.create(payload);
  } catch (err) {
    if (!isLegacyUsersEmailIndexConflict(err)) throw err;
    console.warn('⚠️ Detectado índice legado users.email_1; corrigindo automaticamente...');
    await ensureUsersTenantEmailIndex();
    return await User.create(payload);
  }
}

async function finalizeDbUserLogin(res, user, { withCheckinLink = false } = {}) {
  let ministerioIds = Array.isArray(user.ministerioIds) ? user.ministerioIds : [];
  if (ministerioIds.length === 0 && user.ministerioId) {
    ministerioIds = [user.ministerioId];
    user.ministerioIds = ministerioIds;
  }
  await touchUserOnLoginPg(user, ministerioIds);
  if (withCheckinLink && isMongo()) {
    try {
      await vincularCheckinsAoUsuario(user._id, user.email);
    } catch (_) {}
  }

  const { ministerioIds: mIds, ministerioNomes, ministerioId, ministerioNome } = await loadMinisterioNomesForUserPg(Ministerio, user);
  ministerioIds = mIds;
  const roleNorm = String(user.role || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || 'voluntario';
  const roleFinal = roleNorm === 'lider' || roleNorm.includes('lider') ? 'lider' : roleNorm;
  const igrejaIdStr = user.igrejaId ? String(user.igrejaId) : null;
  const isGlobalAdmin = roleFinal === 'admin' && !user.igrejaId;
  const mustChangePassword = user.mustChangePassword === true;
  const { token, expiresAt, sessionPersisted } = await createAuthTokenForUser(user);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const isMasterAdmin = MASTER_ADMIN_EMAIL && (user.email || '').toString().trim().toLowerCase() === MASTER_ADMIN_EMAIL;
  let igrejaNome = null;
  let igrejaSlug = null;
  if (user.igrejaId) {
    const ig = isMongo()
      ? await Igreja.findById(user.igrejaId).select('nome slug').lean()
      : await pgFindIgrejaById(user.igrejaId);
    if (ig) { igrejaNome = ig.nome; igrejaSlug = ig.slug; }
  }
  const payload = {
    token,
    loginMode: 'db',
    user: {
      nome: user.nome, email: user.email, role: roleFinal, ministerioId, ministerioNome, ministerioIds, ministerioNomes,
      fotoUrl: user.fotoUrl || null, mustChangePassword, isMasterAdmin,
      igrejaId: igrejaIdStr, igrejaNome, igrejaSlug, isGlobalAdmin,
    },
    expiresAt,
  };
  if (!sessionPersisted) {
    payload.sessionWarning = 'Sessão não gravada no banco; login pode falhar após reinício do servidor.';
  }
  return res.json(payload);
}

// Setup inicial: criar primeiro admin (após deploy). Protegido por SETUP_SECRET.
app.get('/api/setup/status', async (_req, res) => {
  try {
    if (!isDbReady()) {
      return res.status(503).json({ needsSetup: false, error: 'Banco de dados indisponível. Configure DATABASE_URL ou MONGODB_URI no Railway.' });
    }
    const hasAdmin = isMongo()
      ? await User.exists({ role: 'admin' })
      : await pgHasAdmin();
    res.json({ needsSetup: !!SETUP_SECRET && !hasAdmin });
  } catch (err) {
    const isProd = process.env.NODE_ENV === 'production';
    res.status(500).json({ needsSetup: false, error: isProd ? 'Erro interno.' : (err.message || 'Erro') });
  }
});

app.post('/api/setup', async (req, res) => {
  try {
    if (!isDbReady()) {
      return res.status(503).json({ error: 'Banco de dados indisponível. Configure DATABASE_URL ou MONGODB_URI no Railway.' });
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

    const hasAdmin = isMongo() ? await User.exists({ role: 'admin' }) : await pgHasAdmin();
    if (hasAdmin) return res.status(400).json({ error: 'Já existe um admin. Use login normal.' });

    if (isMongo()) {
      const existingGlobal = await User.exists({ email: emailVal, igrejaId: null });
      if (existingGlobal) {
        return res.status(400).json({ error: 'Este email já está cadastrado como admin global. Use outra conta ou faça login.' });
      }
      await createUserWithLegacyIndexSelfHeal({ email: emailVal, nome: nomeVal, senha: senhaVal, role: 'admin' });
    } else {
      const existing = await pgFindUsersByEmail(emailVal);
      if (existing.length) {
        return res.status(400).json({ error: 'Este email já está cadastrado. Use outra conta ou faça login.' });
      }
      await pgCreateAdmin({ email: emailVal, nome: nomeVal, senha: senhaVal });
    }
    res.status(201).json({ ok: true, message: 'Admin criado. Faça login com este email e senha.' });
  } catch (err) {
    console.error('setup:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao criar admin.');
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password, email } = req.body || {};
    const login = String(email || username || '').trim();
    const senha = String(password || '').trim();
    if (!login || !senha) return res.status(400).json({ error: 'Envie email/usuário e senha.' });

    // 1) Login admin (ADMIN_USER / ADMIN_PASS no Railway)
    if (matchesEnvAdminCredentials(login, senha)) {
      let adminFotoUrl = null;
      try {
        if (isMongo()) {
          const adminUser = await User.findOne({ email: String(ADMIN_USER).toLowerCase(), igrejaId: null }).select('fotoUrl').lean()
            || await User.findOne({ email: String(ADMIN_USER).toLowerCase() }).select('fotoUrl').lean();
          if (adminUser?.fotoUrl) adminFotoUrl = adminUser.fotoUrl;
        } else if (isPostgres()) {
          const users = await pgFindUsersByEmail(String(ADMIN_USER).toLowerCase());
          const adminUser = users.find((u) => !u.igrejaId) || users[0];
          if (adminUser?.fotoUrl) adminFotoUrl = adminUser.fotoUrl;
        }
      } catch (err) {
        console.warn('Login admin: foto opcional não carregada:', err.message || err);
      }
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000;
      const sessionPersisted = await persistAuthToken(token, {
        user: ADMIN_USER, userId: null, role: 'admin', email: null, expiresAt,
        igrejaId: null, isGlobalAdmin: true,
        ministerioId: null, ministerioNome: null, ministerioIds: [], ministerioNomes: [],
        mustChangePassword: false,
      });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const payload = {
        token,
        loginMode: 'env_admin',
        user: { nome: ADMIN_USER, email: null, role: 'admin', fotoUrl: adminFotoUrl, isGlobalAdmin: true },
        expiresAt,
      };
      if (!sessionPersisted) {
        payload.sessionWarning = 'Sessão não gravada no banco; login pode falhar após reinício do servidor.';
      }
      return res.json(payload);
    }

    // 2) Login por email (User) — pode haver mais de uma conta com o mesmo email (igrejas diferentes)
    const igrejaSlugLogin = (req.body.igrejaSlug || req.body.igreja || '').toString().trim();
    const resolved = await resolveUserForEmailPasswordLogin(Igreja, User, login.toLowerCase(), senha, igrejaSlugLogin);
    if (!resolved.ok) {
      const body = { ...resolved.body };
      if (resolved.status === 401 && ADMIN_USER && ADMIN_PASS) {
        const looksLikeEmail = login.includes('@');
        const notEnvUser = login.toLowerCase() !== String(ADMIN_USER).trim().toLowerCase();
        if (looksLikeEmail && notEnvUser) {
          body.hint = `Se você usa o admin do deploy, o usuário é "${ADMIN_USER}" (variável ADMIN_USER), não necessariamente seu email.`;
        }
      }
      return res.status(resolved.status).json(body);
    }
    return finalizeDbUserLogin(res, resolved.user, { withCheckinLink: false });
  } catch (err) {
    console.error('login:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao fazer login.');
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
  let igrejaSlug = null;
  try {
    let userEmail = req.userEmail;
    let dbUser = null;
    if (req.userId) {
      if (isMongo()) {
        dbUser = await User.findById(req.userId).select('nome fotoUrl mustChangePassword email role ministerioIds igrejaId').lean();
      } else if (isPostgres()) {
        const u = await pgFindUserById(req.userId);
        if (u) {
          dbUser = {
            nome: u.nome,
            fotoUrl: u.fotoUrl,
            mustChangePassword: u.mustChangePassword,
            email: u.email,
            role: u.role,
            ministerioIds: u.ministerioIds,
            igrejaId: u.igrejaId,
          };
        }
      }
      if (dbUser) {
        if (dbUser.nome) displayName = dbUser.nome;
        if (dbUser.fotoUrl) fotoUrl = dbUser.fotoUrl;
        if (dbUser.mustChangePassword) mustChangePassword = true;
        if (dbUser.email) userEmail = dbUser.email;
        if (dbUser.role) {
          const r = String(dbUser.role).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          role = r === 'lider' || r.includes('lider') ? 'lider' : r;
        }
        const loaded = await loadMinisterioNomesForUserPg(Ministerio, dbUser);
        ministerioIds = loaded.ministerioIds;
        ministerioNomes = loaded.ministerioNomes;
        ministerioId = loaded.ministerioId;
        ministerioNome = loaded.ministerioNome;
        if (dbUser.igrejaId) {
          const ig = isMongo()
            ? await Igreja.findById(dbUser.igrejaId).select('slug').lean()
            : await pgFindIgrejaById(dbUser.igrejaId);
          if (ig?.slug) igrejaSlug = ig.slug;
        }
      }
    } else if (req.userRole === 'admin' && ADMIN_USER) {
      if (isMongo()) {
        const adminUser = await User.findOne({ email: String(ADMIN_USER).toLowerCase(), igrejaId: null }).select('fotoUrl').lean()
          || await User.findOne({ email: String(ADMIN_USER).toLowerCase() }).select('fotoUrl').lean();
        if (adminUser && adminUser.fotoUrl) fotoUrl = adminUser.fotoUrl;
      } else {
        const users = await pgFindUsersByEmail(String(ADMIN_USER).toLowerCase());
        const adminUser = users.find((u) => !u.igrejaId) || users[0];
        if (adminUser?.fotoUrl) fotoUrl = adminUser.fotoUrl;
      }
    }
    const email = userEmail;
    if (email) {
      const emLower = email.toLowerCase();
      if (isPostgres() && dbUser?.igrejaId) {
        const vol = await pgFindVoluntarioByEmail(dbUser.igrejaId, emLower);
        if (vol?.nome && String(vol.nome).trim()) displayName = vol.nome.trim();
      } else if (isMongo()) {
        const volQ = { email: emLower };
        if (dbUser?.igrejaId) volQ.igrejaId = dbUser.igrejaId;
        const vol = await Voluntario.findOne(volQ).select('nome').lean();
        if (vol && vol.nome && String(vol.nome).trim()) displayName = vol.nome.trim();
      }
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
  if (igrejaSlug) payload.igrejaSlug = igrejaSlug;
  payload.isGlobalAdmin = !!req.authIsGlobalAdmin;
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
    const relativePath = '/uploads/avatars/' + req.file.filename;
    let oldUrl = null;
    if (isPostgres()) {
      const user = await pgFindUserById(req.userId);
      if (!user) return sendError(res, 404, 'Usuário não encontrado.');
      oldUrl = user.fotoUrl || null;
      await pgSetUserFotoUrl(req.userId, relativePath);
    } else {
      const user = await User.findById(req.userId);
      if (!user) return sendError(res, 404, 'Usuário não encontrado.');
      oldUrl = user.fotoUrl || null;
      user.fotoUrl = relativePath;
      await user.save();
    }
    if (oldUrl) {
      const oldPath = join(UPLOADS_DIR, oldUrl.split('/').pop() || '');
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }
    res.json({ fotoUrl: relativePath });
  } catch (err) {
    console.error('me/foto upload:', err?.message || err);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    sendError(res, 500, err.message || 'Erro ao salvar foto.');
  }
});

// Remover foto de perfil
app.delete('/api/me/foto', requireAuth, async (req, res) => {
  try {
    let oldUrl = null;
    if (isPostgres()) {
      const user = await pgFindUserById(req.userId);
      if (!user) return sendError(res, 404, 'Usuário não encontrado.');
      oldUrl = user.fotoUrl || null;
      await pgSetUserFotoUrl(req.userId, null);
    } else {
      const user = await User.findById(req.userId);
      if (!user) return sendError(res, 404, 'Usuário não encontrado.');
      oldUrl = user.fotoUrl || null;
      user.fotoUrl = null;
      await user.save();
    }
    if (oldUrl) {
      const oldPath = join(UPLOADS_DIR, oldUrl.split('/').pop() || '');
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (_) {}
      }
    }
    res.json({ fotoUrl: null });
  } catch (err) {
    console.error('me/foto delete:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao remover foto.');
  }
});

app.post('/api/logout', requireAuth, async (req, res) => {
  authTokens.delete(req.token);
  if (isPostgres()) await pgDeleteAuthSession(req.token).catch(() => {});
  invalidateCache();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ ok: true });
});

app.get('/api/voluntarios', requireAuth, resolveTenant, requireAdminOrLider, async (req, res) => {
  try {
    const isLider = req.userRole === 'lider';
    const ministerioNomes = (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean);

    // Aceita string CSV ou array (perfil novo grava arrays no JSONB do voluntário).
    const splitMulti = (v) => {
      if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
      if (v == null) return [];
      return String(v).split(',').map((x) => x.trim()).filter(Boolean);
    };
    const buildResumo = (list) => {
      const ministeriosCount = {};
      const dispCount = {};
      (list || []).forEach(v => {
        splitVoluntarioMinisterios(v).forEach(m => {
          if (m) ministeriosCount[m] = (ministeriosCount[m] || 0) + 1;
        });
        splitMulti(v.disponibilidade).forEach(d => {
          dispCount[d] = (dispCount[d] || 0) + 1;
        });
      });
      return {
        total: (list || []).length,
        ministerios: Object.entries(ministeriosCount).sort((a, b) => b[1] - a[1]),
        disponibilidade: Object.entries(dispCount).sort((a, b) => b[1] - a[1]),
      };
    };

    const filterByMinisterio = (list) => {
      if (!isLider || ministerioNomes.length === 0) return list || [];
      return (list || []).filter((v) => voluntarioMatchesLiderMinisterios(v, ministerioNomes));
    };

    const tenantIdStr = String(req.tenantIgrejaId);
    const attachParticipacaoStats = async (list) => {
      if (isPostgres()) return pgAttachParticipacaoStats(req.tenantIgrejaId, list);
      return mongoAttachParticipacaoStats(req, list);
    };
    if (
      isCacheValid('voluntarios') &&
      cache.voluntariosIgrejaId != null &&
      String(cache.voluntariosIgrejaId) === tenantIdStr &&
      cache.voluntarios &&
      Array.isArray(cache.voluntarios.voluntarios)
    ) {
      const baseList = isLider ? filterByMinisterio(cache.voluntarios.voluntarios) : cache.voluntarios.voluntarios;
      const withStats = await attachParticipacaoStats(baseList);
      return res.json({ voluntarios: withStats, resumo: buildResumo(withStats) });
    }

    if (isPostgres()) {
      let voluntariosPg = await pgListVoluntarios(req.tenantIgrejaId);
      voluntariosPg = filterByMinisterio(voluntariosPg);
      const resumoPg = buildVoluntariosResumo(voluntariosPg);
      const payloadPgCache = { voluntarios: voluntariosPg, resumo: resumoPg };
      if (!isLider) {
        cache.voluntarios = payloadPgCache;
        cache.voluntariosTime = Date.now();
        cache.voluntariosIgrejaId = tenantIdStr;
      }
      const withStats = await pgAttachParticipacaoStats(req.tenantIgrejaId, voluntariosPg);
      return res.json({ voluntarios: withStats, resumo: buildResumo(withStats) });
    }

    if (!guardMongoData(res, EMPTY_VOLUNTARIOS, 'Banco de dados indisponível.')) return;

    const vq = { ativo: true, ...tQ(req) };
    let voluntarios = await Voluntario.find(vq).lean();

    if (voluntarios.length === 0 && (VOLUNTARIOS_CSV_PATH || CSV_URL)) {
      try {
        const celeiroId = await getCeleiroIgrejaIdForLegacyImport();
        await syncVoluntarios(celeiroId);
      } catch (e) {
        console.error('syncVoluntarios (planilha Celeiro):', e?.message || e);
      }
      voluntarios = await Voluntario.find(vq).lean();
    }

    // Para líder, evita o bloco pesado de upsert em toda request (causa lentidão/travamento).
    if (!isLider) {
      // Incluir na lista toda conta com role voluntário e todo email que fez check-in (batch em uma única ida ao DB)
      const existingEmails = new Set(voluntarios.map(v => (v.email || '').toLowerCase().trim()).filter(Boolean));
      const toInsert = []; // { email, nome? }
      try {
        const usersVoluntarios = await User.find({ role: 'voluntario', ...tQ(req) }).select('email nome').lean();
        (usersVoluntarios || []).forEach(u => {
          const em = (u.email || '').toLowerCase().trim();
          if (em && em.includes('@') && !existingEmails.has(em)) {
            toInsert.push({ email: em, nome: (u.nome || '').toString().trim() });
            existingEmails.add(em);
          }
        });
        const checkinEmails = await Checkin.distinct('email', { ...tQ(req) }).then(arr => (arr || []).map(e => (e || '').toLowerCase().trim()).filter(Boolean));
        checkinEmails.forEach(em => {
          if (em && em.includes('@') && !existingEmails.has(em)) {
            toInsert.push({ email: em });
            existingEmails.add(em);
          }
        });
        if (toInsert.length > 0) {
          const ops = toInsert.map(({ email, nome }) => ({
            updateOne: {
              filter: { email, ...tQ(req) },
              update: {
                $setOnInsert: {
                  email,
                  igrejaId: req.tenantIgrejaId,
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
          voluntarios = await Voluntario.find(vq).lean();
        }
      } catch (e) { /* não falhar a listagem */ }
    }

    if (voluntarios.length === 0) {
      return res.json({ voluntarios: [], resumo: { total: 0, ministerios: [], disponibilidade: [] } });
    }

    const normalizedAll = voluntarios.map(v => {
      const ministerios = splitVoluntarioMinisterios(v);
      return {
        ...v,
        ministerio: ministerios.length ? ministerios.join(', ') : (v.ministerio || ''),
        ministerios,
        areas: Array.isArray(v.areas) ? v.areas.join(', ') : (v.areas || ''),
        disponibilidade: Array.isArray(v.disponibilidade) ? v.disponibilidade.join(', ') : (v.disponibilidade || ''),
      };
    });

    const emails = [...new Set(normalizedAll.map(v => (v.email || '').toLowerCase().trim()).filter(Boolean))];
    const usersByEmail = {};
    if (emails.length > 0) {
      const uq = { email: { $in: emails }, igrejaId: req.tenantIgrejaId };
      const users = await User.find(uq).select('email fotoUrl').lean();
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
    cache.voluntariosIgrejaId = req.tenantIgrejaId;

    if (!isLider) {
      const withStats = await mongoAttachParticipacaoStats(req, normalizedAll);
      return res.json({ voluntarios: withStats, resumo: buildResumo(withStats) });
    }
    const filtered = filterByMinisterio(normalizedAll);
    const withStatsF = await mongoAttachParticipacaoStats(req, filtered);
    return res.json({
      voluntarios: withStatsF,
      resumo: buildResumo(withStatsF),
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao carregar voluntários');
  }
});

// Lista só os emails (para "selecionar todos" no front, com os mesmos filtros)
app.get('/api/voluntarios/emails', requireAuth, resolveTenant, requireAdminOrLider, async (req, res) => {
  try {
    const isLider = req.userRole === 'lider';
    const ministerioNomes = (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean);

    let list = [];
    const tenantIdStrEmails = String(req.tenantIgrejaId);
    if (isPostgres()) {
      list = await pgListVoluntarios(req.tenantIgrejaId);
      if (isLider && ministerioNomes.length > 0) {
        list = list.filter((v) => voluntarioMatchesLiderMinisterios(v, ministerioNomes));
      }
    } else if (
      !isLider &&
      isCacheValid('voluntarios') &&
      cache.voluntariosIgrejaId != null &&
      String(cache.voluntariosIgrejaId) === tenantIdStrEmails &&
      cache.voluntarios &&
      Array.isArray(cache.voluntarios.voluntarios)
    ) {
      list = cache.voluntarios.voluntarios;
    } else {
      if (!guardMongoData(res, { emails: [] })) return;
      let raw = await Voluntario.find({ ativo: true, ...tQ(req) }).lean();
      if (isLider && ministerioNomes.length > 0) {
        raw = raw.filter((v) => voluntarioMatchesLiderMinisterios(v, ministerioNomes));
      }
      list = raw.map(v => {
        const ministerios = splitVoluntarioMinisterios(v);
        return {
          ...v,
          ministerio: ministerios.length ? ministerios.join(', ') : (v.ministerio || ''),
          ministerios,
          areas: Array.isArray(v.areas) ? v.areas.join(', ') : (v.areas || ''),
          disponibilidade: Array.isArray(v.disponibilidade) ? v.disponibilidade.join(', ') : (v.disponibilidade || ''),
        };
      });
    }
    const { ministerio: ministerioParam, areas: areasParam, disponibilidade, estado, cidade, comCheckin, q } = req.query || {};
    let ministerioFiltro = (ministerioParam || '').toString().trim();
    if (!ministerioFiltro && areasParam) {
      const legacy = typeof areasParam === 'string' ? areasParam.split(',').map((s) => s.trim()).filter(Boolean) : [];
      ministerioFiltro = legacy[0] || '';
    }
    const qLower = (q && typeof q === 'string') ? q.trim().toLowerCase() : '';
    let checkinEmails = new Set();
    if (comCheckin) {
      if (isPostgres()) {
        const arr = await pgListCheckinEmails(req.tenantIgrejaId);
        checkinEmails = new Set(arr);
      } else if (isMongo()) {
        checkinEmails = new Set(await Checkin.distinct('email', { ...tQ(req) }).then(arr => (arr || []).map(e => (e || '').toLowerCase().trim()).filter(Boolean)));
      }
    }
    const filtered = list.filter(v => {
      if (qLower) {
        const nome = (v.nome || '').toLowerCase();
        const email = (v.email || '').toLowerCase();
        const cidadeStr = (v.cidade || '').toLowerCase();
        const ministerioStr = (v.ministerio || '').toLowerCase();
        if (!nome.includes(qLower) && !email.includes(qLower) && !cidadeStr.includes(qLower) && !ministerioStr.includes(qLower)) return false;
      }
      if (ministerioFiltro) {
        const mins = splitVoluntarioMinisterios(v);
        if (!mins.includes(ministerioFiltro)) return false;
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

app.get('/api/checkins', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const { data: dataFiltro, eventoId, ministerio } = req.query;

    if (isPostgres()) {
      let checkinsData;
      if (!isAdmin) {
        const userEmail = (req.userEmail || '').toString().trim().toLowerCase();
        if (!userEmail) return res.json(emptyCheckinsPayload());
        checkinsData = await pgListCheckins(req.tenantIgrejaId, { email: userEmail, limit: 500 });
      } else {
        checkinsData = await pgListCheckins(req.tenantIgrejaId, {
          dataYmd: dataFiltro ? String(dataFiltro).trim() : null,
          eventoId: eventoId || null,
          ministerio: ministerio || null,
          limit: 5000,
        });
      }
      const ministeriosCount = {};
      checkinsData.forEach((c) => {
        const m = (c.ministerio || '').trim();
        if (m) ministeriosCount[m] = (ministeriosCount[m] || 0) + 1;
      });
      const normalized = checkinsData.map((c) => {
        const ms = c.timestampMs || (c.dataCheckin ? new Date(c.dataCheckin).getTime() : null);
        return {
          ...c,
          timestamp: formatDatePtBr(ms),
          timestampMs: ms,
          fotoUrl: null,
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
        cache.checkinsIgrejaId = String(req.tenantIgrejaId);
      }
      return res.json(data);
    }

    if (!guardMongoData(res, emptyCheckinsPayload())) return;

    let query = { ...tQ(req) };
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

    let checkinsData = await Checkin.find(query).select('email nome ministerio timestamp timestampMs dataCheckin eventoId presente batizado').sort({ timestampMs: -1 }).lean();

    if (isAdmin && checkinsData.length === 0 && CHECKIN_CSV_PATH) {
      try {
        const celeiroId = await getCeleiroIgrejaIdForLegacyImport();
        await syncCheckins(celeiroId);
      } catch (e) {
        console.error('syncCheckins (CSV Celeiro):', e?.message || e);
      }
      checkinsData = await Checkin.find(query).select('email nome ministerio timestamp timestampMs dataCheckin eventoId presente batizado').sort({ timestampMs: -1 }).lean();
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
      const uqCh = { email: { $in: emailsCheckin }, igrejaId: req.tenantIgrejaId };
      const users = await User.find(uqCh).select('email fotoUrl').lean();
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
      cache.checkinsIgrejaId = String(req.tenantIgrejaId);
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
app.get('/api/checkins/ministerio', requireAuth, resolveTenant, async (req, res) => {
  try {
    const nomes = req.userMinisterioNomes && req.userMinisterioNomes.length ? req.userMinisterioNomes.map(String).map(s => s.trim()).filter(Boolean) : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
    if (nomes.length === 0) {
      return res.status(403).json({ error: 'Acesso apenas para líderes de ministério.' });
    }
    const { data: dataFiltro } = req.query;
    if (isPostgres()) {
      let checkinsData = await pgListCheckins(req.tenantIgrejaId, {
        dataYmd: dataFiltro ? String(dataFiltro).trim() : null,
        limit: 500,
      });
      checkinsData = checkinsData.filter((c) =>
        nomes.some((n) => {
          const m = (c.ministerio || '').toLowerCase();
          const ln = n.toLowerCase();
          return m === ln || m.includes(ln) || ln.includes(m);
        }),
      );
      const ministeriosCount = {};
      checkinsData.forEach((c) => {
        const m = (c.ministerio || '').trim();
        if (m) ministeriosCount[m] = (ministeriosCount[m] || 0) + 1;
      });
      const normalized = checkinsData.map((c) => {
        const ms = c.timestampMs || (c.dataCheckin ? new Date(c.dataCheckin).getTime() : null);
        return { ...c, timestamp: formatDatePtBr(ms), timestampMs: ms };
      });
      return res.json({
        checkins: normalized,
        resumo: { total: normalized.length, ministerios: Object.entries(ministeriosCount).sort((a, b) => b[1] - a[1]) },
      });
    }
    if (!guardMongoData(res, emptyCheckinsPayload())) return;
    const orConditions = [
      { ministerio: { $in: nomes } },
      ...nomes.map((n) => ({ ministerio: new RegExp(escapeRegex(n), 'i') })),
    ];
    const query = { $or: orConditions, ...tQ(req) };
    if (dataFiltro) {
      const dateCondition = queryDataCheckinDiaBrasilia(String(dataFiltro).trim());
      if (dateCondition) Object.assign(query, dateCondition);
    }
    // Limita a 500 check-ins mais recentes para performance
    const checkinsData = await Checkin.find(query).select('email nome ministerio timestamp timestampMs dataCheckin batizado').sort({ timestampMs: -1 }).limit(500).lean();
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

/** Dado YYYY-MM-DD, retorna o início desse dia em UTC (00:00:00.000Z). Legado; preferir parseDateAsBrasilia para eventos. */
function parseDateAsUTC(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(s + 'T00:00:00.000Z');
}

/** Dado YYYY-MM-DD (data civil em Brasília), retorna 00:00 desse dia em Brasília como Date (UTC). BRT = UTC-3. */
function parseDateAsBrasilia(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(s + 'T03:00:00.000Z');
}

/** Intervalo [início do dia, fim do dia) em UTC para a data YYYY-MM-DD no fuso da app. */
function getDayRangeUTC(dateStr) {
  const start = parseDateAsUTC(dateStr);
  if (!start) return { start: null, end: null };
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Intervalo do dia em Brasília (BRT = UTC-3): YYYY-MM-DD = 00:00–24:00 BRT em UTC. Usado para check-ins e filtros. */
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

/** Data do evento como YYYY-MM-DD no fuso de Brasília (eventos são gravados com parseDateAsBrasilia). */
function getEventDateStringSaoPaulo(evento) {
  if (!evento || !evento.data) return '';
  const d = evento.data instanceof Date ? evento.data : new Date(evento.data);
  return d.toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
}

/** @deprecated use isWithinCheckinWindow from escala-checkin-rules */
function isWithinEventWindow(evento) {
  return isWithinCheckinWindow(evento);
}

async function buildCultoMapForEscalas(igrejaId, escalas) {
  const map = new Map();
  if (!isPostgres()) return map;
  const ids = [...new Set(escalas.map((e) => e.cultoRecorrenteId).filter(Boolean))];
  await Promise.all(ids.map(async (id) => {
    const culto = await pgFindCultoRecorrente(id, igrejaId);
    if (culto) map.set(id, culto);
  }));
  return map;
}

async function enrichEscalasCandidatura(igrejaId, escalas) {
  const cultoMap = await buildCultoMapForEscalas(igrejaId, escalas);
  const hoje = getHojeDateString();
  return sortEscalasByDataDesc(escalas).map((e) => {
    const culto = e.cultoRecorrenteId ? cultoMap.get(e.cultoRecorrenteId) : null;
    const candidaturaAberta = isEscalaAbertaParaCandidatura(e, culto, hoje);
    return { ...e, candidaturaAberta };
  });
}

function enrichEventosCheckinAberto(eventos) {
  return eventos.map((ev) => ({
    ...ev,
    checkinAberto: isCheckinEventAberto(ev),
  }));
}

// ─── Cultos recorrentes (PostgreSQL) ───────────────────────────────────────────
app.get('/api/cultos-recorrentes/meta', requireAuth, (_req, res) => {
  res.json({ diasSemana: DIAS_SEMANA, timezone: TZ_BRASILIA });
});

app.get('/api/cultos-recorrentes', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Cultos recorrentes disponível em modo PostgreSQL.');
    const list = await pgListCultosRecorrentes(req.tenantIgrejaId);
    res.json(list);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao listar cultos recorrentes.');
  }
});

app.post('/api/cultos-recorrentes', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Cultos recorrentes disponível em modo PostgreSQL.');
    const body = req.body || {};
    const nome = String(body.nome || '').trim();
    if (!nome) return sendError(res, 400, 'Nome é obrigatório.');
    const diaSemana = Number(body.diaSemana);
    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
      return sendError(res, 400, 'Dia da semana inválido (0=domingo … 6=sábado).');
    }
    const horario = parseHHMM(body.horario);
    if (!horario) return sendError(res, 400, 'Horário inválido (use HH:mm, horário de Brasília).');
    const culto = await pgCreateCultoRecorrente({
      igrejaId: req.tenantIgrejaId,
      nome,
      diaSemana,
      horario,
      horarioCheckinInicio: body.horarioCheckinInicio,
      horarioCheckinFim: body.horarioCheckinFim,
      gerarEscala: body.gerarEscala,
      gerarCheckin: body.gerarCheckin,
      semanasAFrente: body.semanasAFrente,
      ativo: body.ativo,
      criadoPor: req.userId,
    });
    const sync = await syncCultosRecorrentes({ igrejaId: req.tenantIgrejaId, cultoId: culto._id });
    res.status(201).json({ culto, sync });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao criar culto recorrente.');
  }
});

app.put('/api/cultos-recorrentes/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Cultos recorrentes disponível em modo PostgreSQL.');
    const culto = await pgUpdateCultoRecorrente(req.params.id, req.tenantIgrejaId, req.body || {});
    if (!culto) return sendError(res, 404, 'Culto não encontrado.');
    const sync = await syncCultosRecorrentes({ igrejaId: req.tenantIgrejaId, cultoId: culto._id });
    res.json({ culto, sync });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao atualizar culto.');
  }
});

app.delete('/api/cultos-recorrentes/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Cultos recorrentes disponível em modo PostgreSQL.');
    const ok = await pgDeleteCultoRecorrente(req.params.id, req.tenantIgrejaId);
    if (!ok) return sendError(res, 404, 'Culto não encontrado.');
    invalidateCache();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao excluir culto.');
  }
});

app.post('/api/cultos-recorrentes/sync', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Cultos recorrentes disponível em modo PostgreSQL.');
    const sync = await syncCultosRecorrentes({ igrejaId: req.tenantIgrejaId });
    res.json(sync);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao sincronizar.');
  }
});

// Eventos de check-in:
// - admin: todos (ativos + inativos), smart sort (próxima futura primeiro, depois histórico desc)
// - líder/voluntário: somente eventos ativos e apenas a *próxima* ocorrência futura de cada culto
//   recorrente (eventos avulsos sem cultoRecorrenteId também aparecem se forem futuros).
app.get('/api/eventos-checkin', requireAuth, resolveTenant, async (req, res) => {
  try {
    const role = String(req.userRole || '').toLowerCase();
    const isAdmin = role === 'admin';
    const dataYmd = req.query.data ? String(req.query.data).slice(0, 10) : null;
    if (isPostgres()) {
      const eventos = await pgListEventosCheckin(req.tenantIgrejaId, {
        ativoOnly: !isAdmin,
        dataYmd,
        // Para líder/voluntário (sem filtro de data específica), aplicar próxima por culto.
        nextPerCultoOnly: !isAdmin && !dataYmd,
      });
      return res.json(eventos);
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const { data } = req.query;
    const query = { ...tQ(req) };
    if (!isAdmin) query.ativo = true;
    if (data) {
      const { start, end } = getDayRangeBrasilia(data);
      if (start && end) query.data = { $gte: start, $lt: end };
    }
    const eventos = await EventoCheckin.find(query).sort({ data: -1 }).lean();
    res.json(eventos);
  } catch (err) {
    console.error('eventos-checkin list:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao listar eventos.');
  }
});

app.get('/api/eventos-checkin/hoje', requireAuth, resolveTenant, async (req, res) => {
  try {
    if (isPostgres()) {
      const eventos = await pgListEventosCheckinHoje(req.tenantIgrejaId);
      return res.json(enrichEventosCheckinAberto(eventos));
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    const hojeStr = getHojeDateString();
    const { start, end } = getDayRangeBrasilia(hojeStr);
    if (!start || !end) return res.json([]);
    const eventos = await EventoCheckin.find({ ...tQ(req), ativo: true, data: { $gte: start, $lt: end } }).sort({ data: 1 }).lean();
    res.json(enrichEventosCheckinAberto(eventos));
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao listar eventos de hoje.');
  }
});

app.post('/api/eventos-checkin', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const { data, label, ativo, horarioInicio, horarioFim } = req.body || {};
    if (!data) return sendError(res, 400, 'Campo "data" é obrigatório (YYYY-MM-DD ou ISO).');
    const dateStr = typeof data === 'string' ? data.trim().slice(0, 10) : '';
    if (isPostgres()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return sendError(res, 400, 'Data inválida.');
      const hin = horarioInicio != null ? parseHHMM(horarioInicio) : null;
      const hfi = horarioFim != null ? parseHHMM(horarioFim) : null;
      if (horarioInicio != null && horarioInicio !== '' && !hin) return sendError(res, 400, 'horarioInicio deve ser HH:mm.');
      if (horarioFim != null && horarioFim !== '' && !hfi) return sendError(res, 400, 'horarioFim deve ser HH:mm.');
      const evento = await pgCreateEventoCheckin({
        igrejaId: req.tenantIgrejaId,
        dataYmd: dateStr,
        label: (label || '').trim() || `Culto ${formatDataPtBr(dateStr)}`,
        ativo: typeof ativo === 'boolean' ? ativo : true,
        horarioInicio: hin || '',
        horarioFim: hfi || '',
        criadoPor: req.userId,
      });
      return res.status(201).json(evento);
    }
    const dataOnly = parseDateAsBrasilia(dateStr);
    if (!dataOnly || Number.isNaN(dataOnly.getTime())) return sendError(res, 400, 'Data inválida.');
    const hin = horarioInicio != null ? parseHHMM(horarioInicio) : null;
    const hfi = horarioFim != null ? parseHHMM(horarioFim) : null;
    if (horarioInicio != null && horarioInicio !== '' && !hin) return sendError(res, 400, 'horarioInicio deve ser HH:mm (ex: 19:00).');
    if (horarioFim != null && horarioFim !== '' && !hfi) return sendError(res, 400, 'horarioFim deve ser HH:mm (ex: 22:00).');
    const evento = await EventoCheckin.create({
      ...tQ(req),
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

app.put('/api/eventos-checkin/:id/ativo', requireAuth, resolveTenant, requireAdminOrLider, async (req, res) => {
  try {
    const { ativo } = req.body;
    if (typeof ativo !== 'boolean') return sendError(res, 400, 'ativo deve ser boolean.');
    if (isPostgres()) {
      const evento = await pgUpdateEventoCheckin(req.params.id, req.tenantIgrejaId, { ativo });
      if (!evento) return sendError(res, 404, 'Evento não encontrado.');
      return res.json(evento);
    }
    const evento = await EventoCheckin.findOneAndUpdate({ _id: req.params.id, ...tQ(req) }, { ativo }, { new: true });
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    invalidateCache();
    res.json(evento);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message);
  }
});

app.put('/api/eventos-checkin/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const { label, ativo, horarioInicio, horarioFim } = req.body || {};
    if (isPostgres()) {
      const hin = horarioInicio != null ? parseHHMM(horarioInicio) : undefined;
      const hfi = horarioFim != null ? parseHHMM(horarioFim) : undefined;
      if (horarioInicio != null && horarioInicio !== '' && !hin) return sendError(res, 400, 'horarioInicio deve ser HH:mm.');
      if (horarioFim != null && horarioFim !== '' && !hfi) return sendError(res, 400, 'horarioFim deve ser HH:mm.');
      const evento = await pgUpdateEventoCheckin(req.params.id, req.tenantIgrejaId, {
        label: typeof label === 'string' ? label.trim() : undefined,
        ativo: typeof ativo === 'boolean' ? ativo : undefined,
        horarioInicio: horarioInicio !== undefined ? (hin || '') : undefined,
        horarioFim: horarioFim !== undefined ? (hfi || '') : undefined,
      });
      if (!evento) return sendError(res, 404, 'Evento não encontrado.');
      return res.json(evento);
    }
    const update = {};
    if (typeof label === 'string') update.label = label.trim();
    if (typeof ativo === 'boolean') update.ativo = ativo;
    const hin = horarioInicio != null ? parseHHMM(horarioInicio) : undefined;
    const hfi = horarioFim != null ? parseHHMM(horarioFim) : undefined;
    if (horarioInicio !== undefined) update.horarioInicio = hin || '';
    if (horarioFim !== undefined) update.horarioFim = hfi || '';
    if (horarioInicio != null && horarioInicio !== '' && !hin) return sendError(res, 400, 'horarioInicio deve ser HH:mm (ex: 19:00).');
    if (horarioFim != null && horarioFim !== '' && !hfi) return sendError(res, 400, 'horarioFim deve ser HH:mm (ex: 22:00).');
    const evento = await EventoCheckin.findOneAndUpdate({ _id: req.params.id, ...tQ(req) }, update, { new: true });
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    invalidateCache();
    res.json(evento);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao atualizar evento.');
  }
});

// QR code PNG do link público de check-in
app.get('/api/eventos-checkin/:id/qr.png', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Disponível em modo PostgreSQL.');
    const evento = await pgFindEventoCheckinById(req.params.id, req.tenantIgrejaId);
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    const slug = req.tenantIgrejaSlug || DEFAULT_IGREJA_SLUG;
    const checkinUrl = buildCheckinPublicUrl({
      appBase: resolveAppBaseUrl(req),
      eventoId: evento._id,
      igrejaSlug: slug,
    });
    const ymd = escalaDataToYMD(evento.data);
    const eventoDataLabel = ymd ? formatDataPtBr(ymd) : '';
    const eventoLabel = (evento.label || '').trim() || (eventoDataLabel ? `Culto ${eventoDataLabel}` : 'Check-in');
    const png = await generateCheckinQrPng(checkinUrl, {
      title: eventoLabel,
      subtitle: eventoDataLabel ? `Check-in · ${eventoDataLabel}` : 'Check-in de presença',
    });
    const safeLabel = ((evento.label || 'checkin').replace(/[^\w\-]+/g, '-').slice(0, 40) || 'checkin');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="checkin-qr-${safeLabel}.png"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(png);
  } catch (err) {
    console.error('eventos-checkin qr:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao gerar QR code.');
  }
});

// Disparo manual do email de abertura (voluntários da igreja)
app.post('/api/eventos-checkin/:id/enviar-email-abertura', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Disponível em modo PostgreSQL.');
    const force = req.body?.force === true;
    const evento = await pgFindEventoCheckinById(req.params.id, req.tenantIgrejaId);
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    if (evento.emailAberturaEnviadoEm && !force) {
      return sendError(res, 409, 'Email de abertura já foi enviado. Confirme reenvio.');
    }
    if (force && evento.emailAberturaEnviadoEm) {
      await pgClearEventoAberturaEmailEnviado(evento._id, req.tenantIgrejaId);
    }
    const r = await sendCheckinAberturaEmailsForEvento(evento, {
      appBase: resolveAppBaseUrl(req),
      markSent: true,
    });
    if (r.skipped) return sendError(res, 503, 'RESEND_API_KEY não configurada.');
    res.json({
      ok: true,
      sent: r.sent,
      failed: r.failed,
      total: r.total,
      checkinUrl: r.checkinUrl,
    });
  } catch (err) {
    console.error('enviar-email-abertura:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao enviar emails.');
  }
});

// POST /api/eventos-checkin/purge-orfaos — remove eventos sem escala ativa (+ checkins)
app.post('/api/eventos-checkin/purge-orfaos', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Disponível em modo PostgreSQL.');
    const dryRun = req.body?.dryRun !== false && req.query?.dryRun !== 'false';
    if (dryRun) {
      const orphans = await pgListEventosCheckinSemEscalaAtiva(req.tenantIgrejaId);
      const checkinsCount = orphans.reduce((s, o) => s + (o.checkinsCount || 0), 0);
      return res.json({
        ok: true,
        dryRun: true,
        orphansCount: orphans.length,
        checkinsCount,
        sample: orphans.slice(0, 15).map((o) => ({
          _id: o._id,
          label: o.label,
          data: o.data,
          checkinsCount: o.checkinsCount,
        })),
      });
    }
    const r = await pgPurgeEventosCheckinSemEscalaAtiva(req.tenantIgrejaId, { dryRun: false });
    invalidateCache();
    res.json({
      ok: true,
      deleted: r.deleted,
      orphansCount: r.orphans?.length || 0,
      message: r.deleted.eventos
        ? `${r.deleted.eventos} evento(s) e ${r.deleted.checkins} registro(s) de presença removidos.`
        : 'Nenhum evento órfão encontrado.',
    });
  } catch (err) {
    console.error('eventos-checkin purge-orfaos:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao limpar eventos órfãos.');
  }
});

// POST /api/eventos-checkin/bulk-delete — exclui vários eventos (admin)
app.post('/api/eventos-checkin/bulk-delete', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Disponível em modo PostgreSQL.');
    const body = req.body || {};
    const ids = Array.isArray(body.ids)
      ? body.ids.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (!ids.length) return sendError(res, 400, 'Informe ao menos um evento (ids).');
    if (ids.length > 100) return sendError(res, 400, 'Máximo de 100 eventos por operação.');
    const r = await pgBulkDeleteEventosCheckin(ids, req.tenantIgrejaId);
    if (r.error) return sendError(res, 400, r.error);
    invalidateCache();
    res.json({
      ok: true,
      deleted: r.deleted,
      checkinsCount: r.checkinsCount || 0,
      escalasUnlinked: r.escalasUnlinked || 0,
      message: r.deleted === 1 ? 'Evento excluído.' : `${r.deleted} eventos excluídos.`,
    });
  } catch (err) {
    console.error('eventos-checkin bulk-delete:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao excluir eventos.');
  }
});

app.delete('/api/eventos-checkin/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (isPostgres()) {
      const ok = await pgDeleteEventoCheckin(req.params.id, req.tenantIgrejaId);
      if (!ok) return sendError(res, 404, 'Evento não encontrado.');
      return res.json({ ok: true, message: 'Evento excluído.' });
    }
    const evento = await EventoCheckin.findOneAndDelete({ _id: req.params.id, ...tQ(req) });
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    invalidateCache();
    res.json({ ok: true, message: 'Evento excluído.' });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao excluir evento.');
  }
});

// Voluntário confirma presença no dia (check-in)
app.post('/api/checkins/confirmar', requireAuth, resolveTenant, async (req, res) => {
  try {
    const { eventoId, ministerio, batizado: batizadoRaw } = req.body || {};
    if (isPostgres()) {
      if (!eventoId) return sendError(res, 400, 'eventoId é obrigatório.');
      const batizado = batizadoRaw === true || batizadoRaw === 'sim' ? true : (batizadoRaw === false || batizadoRaw === 'nao' ? false : null);
      let email = req.userEmail;
      let nome = req.user;
      if (req.userId && (!email || !nome)) {
        const u = await pgFindUserById(req.userId);
        if (u) { email = u.email; nome = u.nome; }
      }
      if (!email) return sendError(res, 403, 'Usuário sem email.');
      const r = await pgCreateCheckin({
        igrejaId: req.tenantIgrejaId, eventoId, email, nome: nome || '', ministerio: ministerio || '', batizado, userId: req.userId,
      });
      if (r.error === 'not_found') return sendError(res, 404, 'Evento não encontrado ou inativo.');
      if (r.duplicate) {
        try {
          await pgEnsureVoluntarioInList({
            email, nome: nome || '', ministerio: ministerio || '', igrejaId: req.tenantIgrejaId, fonte: 'checkin', batizado,
          });
        } catch (_) {}
        invalidateCache();
        return res.json({ message: 'Check-in já realizado.', checkin: { _id: r.id } });
      }
      // Sincroniza o catálogo de voluntários (paridade com Mongo): quem faz check-in vira voluntário.
      try {
        await pgEnsureVoluntarioInList({
          email, nome: nome || '', ministerio: ministerio || '', igrejaId: req.tenantIgrejaId, fonte: 'checkin', batizado,
        });
      } catch (_) {}
      invalidateCache();
      return res.status(201).json({ message: 'Check-in realizado!', checkin: { _id: r.id } });
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    if (!eventoId) return sendError(res, 400, 'eventoId é obrigatório.');
    const batizado = batizadoRaw === true || batizadoRaw === 'sim' ? true : (batizadoRaw === false || batizadoRaw === 'nao' ? false : null);
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

    const evento = await EventoCheckin.findOne({ _id: eventoId, ...tQ(req) }).lean();
    if (!evento || !isCheckinEventAberto(evento)) {
      return sendError(res, 404, checkinFechadoMensagem(evento));
    }
    const eventDateStr = getEventDateStringSaoPaulo(evento) || new Date(evento.data).toISOString().slice(0, 10);
    const dataCheckin = getDayRangeBrasilia(eventDateStr).start;
    const existing = await Checkin.findOne({ eventoId, email: email.toLowerCase(), dataCheckin, ...tQ(req) });
    if (existing) {
      try {
        await ensureVoluntarioInList({
          email: email.toLowerCase(), nome: nome || '', ministerio: ministerio || '', igrejaId: req.tenantIgrejaId,
        });
        await mergeVoluntarioBatizadoMongo(email, req.tenantIgrejaId, batizado);
      } catch (_) {}
      invalidateCache();
      return res.json({ message: 'Check-in já realizado.', checkin: existing });
    }

    const checkin = await Checkin.create({
      ...tQ(req),
      email: email.toLowerCase(),
      nome: nome || '',
      ministerio: ministerio || '',
      timestamp: new Date(),
      timestampMs: Date.now(),
      dataCheckin,
      presente: true,
      batizado: batizado ?? null,
      eventoId,
      userId: req.userId,
    });
    try {
      await ensureVoluntarioInList({
        email: email.toLowerCase(), nome: nome || '', ministerio: ministerio || '', igrejaId: req.tenantIgrejaId,
      });
      await mergeVoluntarioBatizadoMongo(email, req.tenantIgrejaId, batizado);
    } catch (_) {}
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
    if (!isDbReady()) return sendError(res, 503, 'Serviço temporariamente indisponível.');
    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (isPostgres()) {
      if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Use ?igreja=slug no link.');
      const evento = await pgFindEventoCheckinById(req.params.eventoId, igrejaDoc._id);
      if (!evento || !isCheckinEventAberto(evento)) {
        return sendError(res, 404, checkinFechadoMensagem(evento));
      }
      const ministerios = await pgListMinisterios(igrejaDoc._id);
      const ministeriosList = ministerios.length > 0
        ? ministerios.filter((m) => m.ativo !== false).map((m) => m.nome).filter(Boolean)
        : MINISTERIOS_PADRAO_PUBLIC;
      return res.json({
        evento: {
          _id: evento._id,
          label: (evento.label || '').trim() || 'Check-in de presença',
          data: evento.data,
          horarioInicio: (evento.horarioInicio || '').trim() || null,
          horarioFim: (evento.horarioFim || '').trim() || null,
          checkinAberto: true,
        },
        ministerios: ministeriosList,
      });
    }
    if (!isMongo()) return sendError(res, 503, 'Check-in público indisponível até migração dos dados do MongoDB.');
    if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Use ?igreja=slug no link.');
    const evento = await EventoCheckin.findById(req.params.eventoId).lean();
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    if (String(evento.igrejaId) !== String(igrejaDoc._id)) return sendError(res, 404, 'Evento não encontrado.');
    if (!isCheckinEventAberto(evento)) return sendError(res, 404, checkinFechadoMensagem(evento));
    const ministerios = await Ministerio.find({ igrejaId: igrejaDoc._id }).sort({ nome: 1 }).select('nome').lean();
    const ministeriosList = ministerios.length > 0 ? ministerios.map(m => m.nome).filter(Boolean) : MINISTERIOS_PADRAO_PUBLIC;
    res.json({
      evento: {
        _id: evento._id,
        label: (evento.label || '').trim() || 'Check-in de presença',
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
    if (!isDbReady()) return sendError(res, 503, 'Serviço temporariamente indisponível.');
    const { eventoId, email, ministerio, nome, batizado: batizadoRaw } = req.body || {};
    if (isPostgres()) {
      const em = (email || '').toString().trim().toLowerCase();
      if (!em || !em.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');
      if (!eventoId) return sendError(res, 400, 'Evento é obrigatório.');
      const batizado = batizadoRaw === true || batizadoRaw === 'sim' ? true : (batizadoRaw === false || batizadoRaw === 'nao' ? false : null);
      const igrejaDoc = await publicIgrejaFromRequest(req);
      if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada.');
      const r = await pgCreateCheckin({
        igrejaId: igrejaDoc._id, eventoId, email: em, nome: (nome || '').trim(), ministerio: (ministerio || '').trim(), batizado,
      });
      if (r.error === 'not_found') return sendError(res, 404, 'Evento não encontrado ou check-in encerrado.');
      if (r.duplicate) return res.status(200).json({ message: 'Check-in já realizado.', checkin: { _id: r.id } });
      try {
        await pgEnsureVoluntarioInList({
          email: em, nome: (nome || '').trim(), ministerio: (ministerio || '').trim(), igrejaId: igrejaDoc._id, fonte: 'checkin',
        });
      } catch (_) {}
      invalidateCache();
      return res.status(201).json({ message: 'Check-in realizado!', checkin: { _id: r.id } });
    }
    if (!isMongo()) return sendError(res, 503, 'Check-in público indisponível até migração dos dados do MongoDB.');
    const em = (email || '').toString().trim().toLowerCase();
    if (!em || !em.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');
    if (!eventoId) return sendError(res, 400, 'Evento é obrigatório.');
    const batizado = batizadoRaw === true || batizadoRaw === 'sim' ? true : (batizadoRaw === false || batizadoRaw === 'nao' ? false : null);
    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Use ?igreja=slug ou igrejaSlug no corpo.');
    const evento = await EventoCheckin.findById(eventoId).lean();
    if (!evento || !isCheckinEventAberto(evento)) {
      return sendError(res, 404, checkinFechadoMensagem(evento));
    }
    if (String(evento.igrejaId) !== String(igrejaDoc._id)) return sendError(res, 404, 'Evento não encontrado.');
    const eventDateStr = getEventDateStringSaoPaulo(evento) || new Date(evento.data).toISOString().slice(0, 10);
    const dataCheckin = getDayRangeBrasilia(eventDateStr).start;
    const existing = await Checkin.findOne({ eventoId, email: em, dataCheckin, igrejaId: igrejaDoc._id });
    if (existing) {
      try {
        await ensureVoluntarioInList({
          email: em, nome: (nome || '').toString().trim(), ministerio: (ministerio || '').toString().trim(), igrejaId: igrejaDoc._id,
        });
      } catch (_) {}
      return res.status(200).json({ message: 'Check-in já realizado.', checkin: existing });
    }
    const checkin = await Checkin.create({
      igrejaId: igrejaDoc._id,
      email: em,
      nome: (nome || '').toString().trim() || '',
      ministerio: (ministerio || '').toString().trim() || '',
      timestamp: new Date(),
      timestampMs: Date.now(),
      dataCheckin,
      presente: true,
      batizado: batizado ?? null,
      eventoId: evento._id,
    });
    try {
      await ensureVoluntarioInList({
        email: em, nome: (nome || '').toString().trim(), ministerio: (ministerio || '').toString().trim(), igrejaId: igrejaDoc._id,
      });
    } catch (_) {}
    invalidateCache();
    res.status(201).json({ message: 'Check-in realizado!', checkin });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao registrar check-in.');
  }
});

// ─── Formulários (membros, batismo, apresentação) ───
// Eventos de formulário (batismo / apresentação) — por data, como check-in
app.get('/api/eventos-formulario', requireAuth, resolveTenant, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const { tipo, data } = req.query;
    const isAdmin = String(req.userRole || '').toLowerCase() === 'admin';
    if (isPostgres()) {
      const eventos = await pgListEventosFormulario(req.tenantIgrejaId, {
        tipo,
        ativo: !isAdmin ? true : undefined,
        data,
      });
      return res.json(eventos);
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    const query = { ...tQ(req) };
    if (tipo && (tipo === 'batismo' || tipo === 'apresentacao')) query.tipo = tipo;
    if (!isAdmin) query.ativo = true;
    if (data) {
      const { start, end } = getDayRangeBrasilia(data);
      if (start && end) query.data = { $gte: start, $lt: end };
    }
    const eventos = await EventoFormulario.find(query).sort({ data: -1 }).lean();
    res.json(eventos);
  } catch (err) {
    console.error('eventos-formulario list:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao listar eventos.');
  }
});

app.post('/api/eventos-formulario', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const { data, label, tipo, ativo, horarioInicio, horarioFim } = req.body || {};
    if (!data) return sendError(res, 400, 'Campo "data" é obrigatório (YYYY-MM-DD ou ISO).');
    if (!tipo || (tipo !== 'batismo' && tipo !== 'apresentacao')) return sendError(res, 400, 'Campo "tipo" deve ser "batismo" ou "apresentacao".');
    const dateStr = typeof data === 'string' ? data.trim().slice(0, 10) : '';
    const dataOnly = parseDateAsBrasilia(dateStr);
    if (!dataOnly || Number.isNaN(dataOnly.getTime())) return sendError(res, 400, 'Data inválida.');
    const hin = horarioInicio != null ? parseHHMM(horarioInicio) : null;
    const hfi = horarioFim != null ? parseHHMM(horarioFim) : null;
    if (horarioInicio != null && horarioInicio !== '' && !hin) return sendError(res, 400, 'horarioInicio deve ser HH:mm.');
    if (horarioFim != null && horarioFim !== '' && !hfi) return sendError(res, 400, 'horarioFim deve ser HH:mm.');
    const nomeTipo = tipo === 'batismo' ? 'Batismo' : 'Apresentação de bebês';
    const labelFinal = label || `${nomeTipo} ${dataOnly.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA })}`;
    if (isPostgres()) {
      const evento = await pgCreateEventoFormulario({
        igrejaId: req.tenantIgrejaId,
        tipo,
        dataYmd: dateStr,
        label: labelFinal,
        ativo: typeof ativo === 'boolean' ? ativo : true,
        horarioInicio: hin || '',
        horarioFim: hfi || '',
        criadoPor: req.userId,
      });
      return res.status(201).json(evento);
    }
    const evento = await EventoFormulario.create({
      ...tQ(req),
      data: dataOnly,
      label: labelFinal,
      tipo,
      criadoPor: req.userId,
      ativo: typeof ativo === 'boolean' ? ativo : true,
      horarioInicio: hin || '',
      horarioFim: hfi || '',
    });
    res.status(201).json(evento);
  } catch (err) {
    console.error('eventos-formulario create:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao criar evento.');
  }
});

app.put('/api/eventos-formulario/:id/ativo', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const { ativo } = req.body;
    if (typeof ativo !== 'boolean') return sendError(res, 400, 'ativo deve ser boolean.');
    if (isPostgres()) {
      const evento = await pgUpdateEventoFormulario(req.params.id, req.tenantIgrejaId, { ativo });
      if (!evento) return sendError(res, 404, 'Evento não encontrado.');
      return res.json(evento);
    }
    const evento = await EventoFormulario.findOneAndUpdate({ _id: req.params.id, ...tQ(req) }, { ativo }, { new: true });
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    res.json(evento);
  } catch (err) {
    console.error('eventos-formulario ativo:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao atualizar status.');
  }
});

app.put('/api/eventos-formulario/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const { label, ativo, horarioInicio, horarioFim } = req.body || {};
    const hin = horarioInicio != null ? parseHHMM(horarioInicio) : undefined;
    const hfi = horarioFim != null ? parseHHMM(horarioFim) : undefined;
    if (horarioInicio != null && horarioInicio !== '' && !hin) return sendError(res, 400, 'horarioInicio deve ser HH:mm.');
    if (horarioFim != null && horarioFim !== '' && !hfi) return sendError(res, 400, 'horarioFim deve ser HH:mm.');
    if (isPostgres()) {
      const evento = await pgUpdateEventoFormulario(req.params.id, req.tenantIgrejaId, {
        label: typeof label === 'string' ? label.trim() : undefined,
        ativo: typeof ativo === 'boolean' ? ativo : undefined,
        horarioInicio: horarioInicio !== undefined ? (hin || '') : undefined,
        horarioFim: horarioFim !== undefined ? (hfi || '') : undefined,
      });
      if (!evento) return sendError(res, 404, 'Evento não encontrado.');
      return res.json(evento);
    }
    const update = {};
    if (typeof label === 'string') update.label = label.trim();
    if (typeof ativo === 'boolean') update.ativo = ativo;
    if (horarioInicio !== undefined) update.horarioInicio = hin || '';
    if (horarioFim !== undefined) update.horarioFim = hfi || '';
    const evento = await EventoFormulario.findOneAndUpdate({ _id: req.params.id, ...tQ(req) }, update, { new: true });
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    res.json(evento);
  } catch (err) {
    console.error('eventos-formulario update:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao atualizar evento.');
  }
});

app.delete('/api/eventos-formulario/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (isPostgres()) {
      const ok = await pgDeleteEventoFormulario(req.params.id, req.tenantIgrejaId);
      if (!ok) return sendError(res, 404, 'Evento não encontrado.');
      return res.json({ ok: true, message: 'Evento excluído.' });
    }
    const evento = await EventoFormulario.findOneAndDelete({ _id: req.params.id, ...tQ(req) });
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    res.json({ ok: true, message: 'Evento excluído.' });
  } catch (err) {
    console.error('eventos-formulario delete:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao excluir evento.');
  }
});

// Público: dados do evento de formulário (batismo ou apresentação)
app.get('/api/formulario-publico/:tipo/:eventoId', async (req, res) => {
  try {
    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Use ?igreja=slug no link.');
    const { tipo, eventoId } = req.params;
    if (tipo !== 'batismo' && tipo !== 'apresentacao') return sendError(res, 400, 'Tipo inválido.');
    let evento = null;
    if (isPostgres()) {
      evento = await pgFindEventoFormularioById(eventoId, igrejaDoc._id);
    } else if (isMongo()) {
      evento = await EventoFormulario.findById(eventoId).lean();
      if (evento && String(evento.igrejaId) !== String(igrejaDoc._id)) evento = null;
    } else {
      return sendError(res, 503, 'Serviço temporariamente indisponível.');
    }
    if (!evento) return sendError(res, 404, 'Evento não encontrado.');
    if (evento.tipo !== tipo) return sendError(res, 404, 'Evento não encontrado.');
    if (evento.ativo !== true) return sendError(res, 404, 'Formulário não está aberto para este evento.');
    const nomeTipo = tipo === 'batismo' ? 'Batismo' : 'Apresentação de Bebês';
    let label = (evento.label || '').trim() || nomeTipo;
    label = label.replace(tipo === 'batismo' ? /^Batismo:\s*/i : /^Apresentação de Bebês:\s*/i, '');
    label = label.replace(/\s*\(\d{1,2}\/\d{1,2}\/\d{2,4}\)\s*$/, '').replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '').trim();
    res.json({
      evento: {
        _id: evento._id,
        label: label || nomeTipo,
        data: evento.data,
        tipo: evento.tipo,
      },
    });
  } catch (err) {
    console.error('formulario-publico get:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao carregar dados.');
  }
});

// Público: enviar formulário batismo / apresentação
app.post('/api/formulario-publico', async (req, res) => {
  try {
    const body = req.body || {};
    const tipo = (body.tipo || '').trim().toLowerCase();
    const eventoId = body.eventoId;
    if (tipo !== 'batismo' && tipo !== 'apresentacao') {
      return sendError(res, 400, 'Campo "tipo" deve ser "batismo" ou "apresentacao".');
    }
    if (!eventoId) return sendError(res, 400, 'eventoId é obrigatório.');
    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Envie "igreja" (slug) no corpo.');

    let evento = null;
    if (isPostgres()) {
      evento = await pgFindEventoFormularioById(eventoId, igrejaDoc._id);
    } else if (isMongo()) {
      evento = await EventoFormulario.findById(eventoId).lean();
      if (evento && String(evento.igrejaId) !== String(igrejaDoc._id)) evento = null;
    } else {
      return sendError(res, 503, 'Serviço temporariamente indisponível.');
    }
    if (!evento || evento.tipo !== tipo || !evento.ativo) {
      return sendError(res, 404, 'Evento não encontrado ou formulário encerrado.');
    }

    if (tipo === 'batismo') {
      const nomeCompleto = (body.nomeCompleto || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      if (!nomeCompleto) return sendError(res, 400, 'Nome completo é obrigatório.');
      if (!email || !email.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');
      const dataNascimento = body.dataNascimento ? parseNascimento(body.dataNascimento) : undefined;
      const dados = {
        nomeCompleto,
        dataNascimento: dataNascimento ? dataNascimento.toISOString() : null,
        email,
        telefoneWhatsapp: (body.telefoneWhatsapp || '').trim() || '',
        reconheceJesus: (body.reconheceJesus || '').trim() || '',
        querMembroCeleiro: (body.querMembroCeleiro || '').trim() || '',
        batizarProximo: (body.batizarProximo || '').trim() || '',
        cursoBatismo: (body.cursoBatismo || '').trim() || '',
      };
      if (isPostgres()) {
        const id = await pgCreateFormularioBatismo(igrejaDoc._id, evento._id, dados);
        return res.status(201).json({ ok: true, message: 'Formulário de batismo enviado com sucesso!', id });
      }
      const doc = await FormularioBatismo.create({
        igrejaId: igrejaDoc._id,
        eventoId: evento._id,
        ...dados,
        dataNascimento: dataNascimento || undefined,
      });
      return res.status(201).json({ ok: true, message: 'Formulário de batismo enviado com sucesso!', id: doc._id });
    }

    // apresentação
    const nomeMae = (body.nomeMae || '').trim();
    const nomePai = (body.nomePai || '').trim();
    const quantidadeCriancas = Math.max(0, parseInt(body.quantidadeCriancas, 10) || 0);
    const criancasRaw = body.criancas;
    let criancas = [];
    if (Array.isArray(criancasRaw) && criancasRaw.length > 0) {
      criancas = criancasRaw.slice(0, 20).map(c => ({
        nomeCompleto: (c.nomeCompleto || '').trim(),
        dataNascimento: c.dataNascimento ? parseNascimento(c.dataNascimento) : undefined,
      })).filter(c => c.nomeCompleto || c.dataNascimento);
    }
    const emailContato = (body.emailContato || '').trim().toLowerCase();
    if (!emailContato || !emailContato.includes('@')) return sendError(res, 400, 'E-mail de contato é obrigatório e deve ser válido.');
    const dados = {
      nomeMae,
      nomePai,
      quantidadeCriancas: criancas.length || quantidadeCriancas,
      criancas: criancas.map((c) => ({
        nomeCompleto: c.nomeCompleto,
        dataNascimento: c.dataNascimento ? c.dataNascimento.toISOString() : null,
      })),
      endereco: (body.endereco || '').trim() || '',
      paisMembrosCeleiro: (body.paisMembrosCeleiro || '').trim() || '',
      emailContato,
      whatsappContato: (body.whatsappContato || '').trim() || '',
      compromissoEducar: (body.compromissoEducar || '').trim() || '',
    };
    if (isPostgres()) {
      const id = await pgCreateFormularioApresentacao(igrejaDoc._id, evento._id, dados);
      return res.status(201).json({ ok: true, message: 'Formulário de apresentação enviado com sucesso!', id });
    }
    const doc = await FormularioApresentacao.create({
      igrejaId: igrejaDoc._id,
      eventoId: evento._id,
      ...dados,
      criancas,
    });
    return res.status(201).json({ ok: true, message: 'Formulário de apresentação enviado com sucesso!', id: doc._id });
  } catch (err) {
    console.error('formulario-publico post:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao enviar formulário.');
  }
});

// Cadastro público: novo membro (um único link, como cadastro de voluntários)
app.post('/api/formularios/membro', async (req, res) => {
  try {
    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Envie "igreja" (slug) no corpo.');
    const body = req.body || {};
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');
    const nomeCompleto = (body.nomeCompleto || '').trim();
    if (!nomeCompleto) return sendError(res, 400, 'Nome completo é obrigatório.');
    const dataNascimento = body.dataNascimento ? parseNascimento(body.dataNascimento) : undefined;
    const dados = {
      nomeCompleto,
      dataNascimento: dataNascimento ? dataNascimento.toISOString() : null,
      email,
      enderecoCompleto: (body.enderecoCompleto || '').trim() || '',
      telefoneWhatsapp: (body.telefoneWhatsapp || '').trim() || '',
      batizado: (body.batizado || '').trim() || '',
      voluntario: (body.voluntario || '').trim() || '',
      grupoOracao: (body.grupoOracao || '').trim() || '',
      querMembroCeleiro: (body.querMembroCeleiro || '').trim() || '',
      compromissoRespeitar: (body.compromissoRespeitar || '').trim() || '',
      testemunho: (body.testemunho || '').trim() || '',
    };
    if (isPostgres()) {
      await pgCreateFormularioMembro(igrejaDoc._id, dados);
    } else if (isMongo()) {
      await FormularioMembro.create({
        igrejaId: igrejaDoc._id,
        ...dados,
        dataNascimento: dataNascimento || undefined,
      });
    } else {
      return sendError(res, 503, 'Serviço temporariamente indisponível.');
    }
    return res.status(201).json({ ok: true, message: 'Formulário de novo membro enviado com sucesso!' });
  } catch (err) {
    console.error('formularios/membro post:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao enviar formulário.');
  }
});

// Admin: listar inscrições formulário membros
app.get('/api/formularios/membro', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (isPostgres()) {
      const list = await pgListFormulariosMembro(req.tenantIgrejaId);
      return res.json(list);
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    const list = await FormularioMembro.find({ ...tQ(req) }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    console.error('formularios/membro list:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao listar inscrições.');
  }
});

// Cadastro público: Consolidação / Acolhimento (baseado no fluxo de decisão e acompanhamento)
app.post('/api/formularios/consolidacao', async (req, res) => {
  try {
    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Envie "igreja" na URL (?igreja=slug) ou "igrejaSlug" no corpo.');
    const body = req.body || {};
    const nomeCompleto = (body.nomeCompleto || '').trim();
    if (!nomeCompleto) return sendError(res, 400, 'Nome completo é obrigatório.');
    const idade = (body.idade || '').trim();
    if (!idade) return sendError(res, 400, 'Idade é obrigatória.');
    const genero = (body.genero || '').trim();
    if (!genero) return sendError(res, 400, 'Gênero é obrigatório.');
    const estadoCivil = (body.estadoCivil || '').trim();
    if (!estadoCivil) return sendError(res, 400, 'Estado civil é obrigatório.');
    const batizadoAguas = (body.batizadoAguas || '').trim();
    if (!batizadoAguas) return sendError(res, 400, 'Informe sobre o batismo nas águas.');
    const telefoneWhatsapp = (body.telefoneWhatsapp || '').trim();
    if (!telefoneWhatsapp) return sendError(res, 400, 'WhatsApp é obrigatório.');
    const bairroCidade = (body.bairroCidade || '').trim();
    if (!bairroCidade) return sendError(res, 400, 'Bairro e cidade são obrigatórios.');
    const decisaoHoje = (body.decisaoHoje || '').trim();
    if (!decisaoHoje) return sendError(res, 400, 'Informe a decisão de hoje.');
    const grupoOracao = (body.grupoOracao || '').trim();
    if (!grupoOracao) return sendError(res, 400, 'Responda sobre o Grupo de Oração.');
    const podeContato = (body.podeContato || '').trim();
    if (!podeContato) return sendError(res, 400, 'Informe se podemos entrar em contato.');
    const pedidoOracao = (body.pedidoOracao || '').trim();
    if (!pedidoOracao) return sendError(res, 400, 'O campo de ajuda/oração é obrigatório.');

    let emailOpcional = (body.emailOpcional || '').trim().toLowerCase();
    if (emailOpcional && !emailOpcional.includes('@')) return sendError(res, 400, 'E-mail opcional inválido.');

    const dataNascimento = body.dataNascimento ? parseNascimento(body.dataNascimento) : undefined;
    if (dataNascimento) {
      const t = dataNascimento.getTime();
      if (Number.isNaN(t) || t > Date.now() || t < new Date(1920, 0, 1).getTime()) {
        return sendError(res, 400, 'Data de nascimento inválida.');
      }
    }

    const dados = {
      nomeCompleto,
      dataNascimento: dataNascimento ? dataNascimento.toISOString() : null,
      idade,
      genero,
      estadoCivil,
      batizadoAguas,
      telefoneWhatsapp,
      bairroCidade,
      decisaoHoje,
      grupoOracao,
      podeContato,
      melhorDiaContato: (body.melhorDiaContato || '').trim() || '',
      melhorHorarioContato: (body.melhorHorarioContato || '').trim() || '',
      preferenciaContato: (body.preferenciaContato || '').trim() || '',
      pedidoOracao,
      emailOpcional: emailOpcional || '',
    };
    if (isPostgres()) {
      await pgCreateFormularioConsolidacao(igrejaDoc._id, dados);
    } else if (isMongo()) {
      await FormularioConsolidacao.create({
        igrejaId: igrejaDoc._id,
        ...dados,
        dataNascimento: dataNascimento || undefined,
      });
    } else {
      return sendError(res, 503, 'Serviço temporariamente indisponível.');
    }
    return res.status(201).json({ ok: true, message: 'Formulário enviado com sucesso! Nossa equipe entrará em contato quando aplicável.' });
  } catch (err) {
    console.error('formularios/consolidacao post:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao enviar formulário.');
  }
});

// Admin: listar inscrições Consolidação
app.get('/api/formularios/consolidacao', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (isPostgres()) {
      const list = await pgListFormulariosConsolidacao(req.tenantIgrejaId);
      return res.json(list);
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    const list = await FormularioConsolidacao.find({ ...tQ(req) }).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    console.error('formularios/consolidacao list:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao listar inscrições.');
  }
});

// Admin: listar inscrições batismo por evento (somente inscrições daquele evento)
app.get('/api/formularios/batismo/:eventoId', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const idRaw = (req.params.eventoId || '').trim();
    if (!idRaw) return res.json([]);
    if (isPostgres()) {
      const ev = await pgFindEventoFormularioById(idRaw, req.tenantIgrejaId);
      if (!ev || ev.tipo !== 'batismo') return res.json([]);
      const list = await pgListFormulariosBatismoByEvento(req.tenantIgrejaId, idRaw);
      return res.json(list);
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    if (!mongoose.Types.ObjectId.isValid(idRaw)) return res.json([]);
    const eventoOid = new mongoose.Types.ObjectId(idRaw);
    const ev = await EventoFormulario.findOne({ _id: eventoOid, tipo: 'batismo', ...tQ(req) }).select('_id').lean();
    if (!ev) return res.json([]);
    const baseQ = { ...tQ(req), $or: [{ eventoId: eventoOid }, { eventoId: idRaw }] };
    const list = await FormularioBatismo.find(baseQ).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    console.error('formularios/batismo list:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao listar inscrições.');
  }
});

// Admin: listar inscrições apresentação por evento (somente inscrições daquele evento)
app.get('/api/formularios/apresentacao/:eventoId', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const idRaw = (req.params.eventoId || '').trim();
    if (!idRaw) return res.json([]);
    if (isPostgres()) {
      const ev = await pgFindEventoFormularioById(idRaw, req.tenantIgrejaId);
      if (!ev || ev.tipo !== 'apresentacao') return res.json([]);
      const list = await pgListFormulariosApresentacaoByEvento(req.tenantIgrejaId, idRaw);
      return res.json(list);
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    if (!mongoose.Types.ObjectId.isValid(idRaw)) return res.json([]);
    const eventoOid = new mongoose.Types.ObjectId(idRaw);
    const ev = await EventoFormulario.findOne({ _id: eventoOid, tipo: 'apresentacao', ...tQ(req) }).select('_id').lean();
    if (!ev) return res.json([]);
    const baseQ = { ...tQ(req), $or: [{ eventoId: eventoOid }, { eventoId: idRaw }] };
    const list = await FormularioApresentacao.find(baseQ).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    console.error('formularios/apresentacao list:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao listar inscrições.');
  }
});

// Perfil do voluntário/líder (dados no cadastro Voluntario)
app.get('/api/me/perfil', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const emailLookup = (req.userEmail || '').toLowerCase().trim();
    if (isPostgres()) {
      const userRow = req.userId
        ? await pgFindUserById(req.userId)
        : (await pgFindUsersByEmail(emailLookup)).find(
          (u) => !req.authIgrejaIdStr || String(u.igrejaId || '') === String(req.authIgrejaIdStr || ''),
        ) || (await pgFindUsersByEmail(emailLookup))[0];
      const email = (req.userEmail || userRow?.email || emailLookup || '').toLowerCase().trim();
      if (!email) return sendError(res, 403, 'Perfil disponível apenas para usuários com email.');
      const igrejaId = userRow?.igrejaId || req.authIgrejaIdStr || req.tenantIgrejaId;
      const perfil = igrejaId ? await pgFindVoluntarioByEmail(igrejaId, email) : null;
      if (!perfil) return res.json({ fotoUrl: userRow?.fotoUrl ?? null });
      const areasStr = Array.isArray(perfil.areas) ? perfil.areas.join(', ') : (perfil.areas || '');
      return res.json({ ...perfil, areas: areasStr, fotoUrl: userRow?.fotoUrl ?? null });
    }
    if (!isMongo()) return sendError(res, 503, 'Perfil indisponível.');
    const userRow = req.userId
      ? await User.findById(req.userId).select('email fotoUrl igrejaId').lean()
      : await User.findOne({
        email: emailLookup,
        ...(req.authIgrejaIdStr && mongoose.Types.ObjectId.isValid(req.authIgrejaIdStr)
          ? { igrejaId: req.authIgrejaIdStr }
          : { igrejaId: null }),
      }).select('email fotoUrl igrejaId').lean();
    const email = (req.userEmail || userRow?.email || '').toLowerCase().trim();
    if (!email) return sendError(res, 403, 'Perfil disponível apenas para usuários com email.');
    const volFilter = { email };
    if (userRow?.igrejaId) volFilter.igrejaId = userRow.igrejaId;
    const [perfil, user] = await Promise.all([
      Voluntario.findOne(volFilter).lean(),
      Promise.resolve(userRow),
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
    if (isPostgres()) {
      const userRow = req.userId
        ? await pgFindUserById(req.userId)
        : null;
      const email = (req.userEmail || userRow?.email || '').toLowerCase().trim();
      if (!email) return sendError(res, 403, 'Perfil disponível apenas para usuários com email.');
      const igrejaId = userRow?.igrejaId || req.authIgrejaIdStr;
      if (!igrejaId) return sendError(res, 400, 'Conta sem igreja vinculada. Contate o administrador.');
      const body = { ...req.body };
      delete body.email;
      delete body._id;
      normalizeVoluntarioMinisteriosPatch(body);
      if (body.areas && typeof body.areas === 'string') {
        body.areas = body.areas.split(',').map((a) => a.trim()).filter(Boolean);
      }
      if (body.batizado !== undefined) {
        if (body.batizado === true || body.batizado === false) {
          /* keep */
        } else if (body.batizado === 'sim') body.batizado = true;
        else if (body.batizado === 'nao' || body.batizado === 'não') body.batizado = false;
        else delete body.batizado;
      }
      if (body.whatsapp != null) {
        const w = normalizarWhatsapp(body.whatsapp);
        if (body.whatsapp !== '' && w === null) {
          return sendError(res, 400, 'WhatsApp inválido. Informe 10 ou 11 dígitos (DDD + número).');
        }
        body.whatsapp = (w != null ? w : (body.whatsapp === '' ? undefined : body.whatsapp));
      }
      if (body.nascimento != null && body.nascimento !== '') {
        const n = parseNascimento(body.nascimento);
        body.nascimento = n || body.nascimento;
        if (n && !validarNascimento(n)) {
          return sendError(res, 400, 'Data de nascimento deve estar entre 1920 e 2015.');
        }
      } else if (body.nascimento != null && typeof body.nascimento === 'string') {
        body.nascimento = parseNascimento(body.nascimento) || body.nascimento;
      }
      if (body.estado != null) body.estado = normalizarEstado(body.estado);
      if (body.cidade != null) body.cidade = normalizarCidade(body.cidade);
      const perfil = await pgUpsertVoluntarioPerfil(igrejaId, email, body);
      invalidateCache();
      return res.json(perfil);
    }
    if (!isMongo()) return sendError(res, 503, 'Perfil indisponível.');
    const email = req.userEmail || (req.userId && (await User.findById(req.userId).select('email igrejaId').lean())?.email);
    if (!email) return sendError(res, 403, 'Perfil disponível apenas para usuários com email.');
    const uRow = req.userId
      ? await User.findById(req.userId).select('igrejaId').lean()
      : await User.findOne({
        email: email.toLowerCase(),
        ...(req.authIgrejaIdStr && mongoose.Types.ObjectId.isValid(req.authIgrejaIdStr)
          ? { igrejaId: req.authIgrejaIdStr }
          : { igrejaId: null }),
      }).select('igrejaId').lean();
    if (!uRow?.igrejaId) return sendError(res, 400, 'Conta sem igreja vinculada. Contate o administrador.');
    const body = { ...req.body };
    delete body.email;
    delete body._id;
    normalizeVoluntarioMinisteriosPatch(body);
    if (body.areas && typeof body.areas === 'string') body.areas = body.areas.split(',').map(a => a.trim()).filter(Boolean);
    if (body.batizado !== undefined) {
      if (body.batizado === true || body.batizado === false) {
        /* keep */
      } else if (body.batizado === 'sim') body.batizado = true;
      else if (body.batizado === 'nao' || body.batizado === 'não') body.batizado = false;
      else delete body.batizado;
    }
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
      { email: email.toLowerCase(), igrejaId: uRow.igrejaId },
      { $set: body, $setOnInsert: { email: email.toLowerCase(), igrejaId: uRow.igrejaId, ativo: true, fonte: 'manual' } },
      { new: true, upsert: true, runValidators: true }
    ).lean();
    invalidateCache();
    res.json(perfil);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao salvar perfil.');
  }
});

/** Voluntário: após check-in, ver se falta completar telefone/cidade/UF (uma vez ou após “pular”). */
app.get('/api/me/perfil-checkin-gap', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const emailLookup = (req.userEmail || '').toLowerCase().trim();
    if (isPostgres()) {
      const userRow = req.userId
        ? await pgFindUserById(req.userId)
        : (await pgFindUsersByEmail(emailLookup)).find(
          (u) => !req.authIgrejaIdStr || String(u.igrejaId || '') === String(req.authIgrejaIdStr || ''),
        ) || (await pgFindUsersByEmail(emailLookup))[0];
      const email = (req.userEmail || userRow?.email || emailLookup || '').toLowerCase().trim();
      if (!email) return res.json({ needsComplement: false, missing: [] });
      const igrejaId = userRow?.igrejaId || req.authIgrejaIdStr;
      if (!igrejaId) return res.json({ needsComplement: false, missing: [] });
      const { rows } = await getPostgresPool().query(
        'SELECT dados FROM voluntarios WHERE igreja_id = $1 AND LOWER(email) = $2 LIMIT 1',
        [igrejaId, email],
      );
      const gap = computePerfilCheckinGap(rows[0]?.dados || {});
      return res.json({ needsComplement: gap.needsComplement, missing: gap.missing });
    }
    if (!isMongo()) return res.json({ needsComplement: false, missing: [] });
    const userRow = req.userId
      ? await User.findById(req.userId).select('email igrejaId').lean()
      : await User.findOne({
        email: emailLookup,
        ...(req.authIgrejaIdStr && mongoose.Types.ObjectId.isValid(req.authIgrejaIdStr)
          ? { igrejaId: req.authIgrejaIdStr }
          : { igrejaId: null }),
      }).select('email igrejaId').lean();
    const email = (req.userEmail || userRow?.email || '').toLowerCase().trim();
    if (!email) return res.json({ needsComplement: false, missing: [] });
    const volFilter = { email };
    if (userRow?.igrejaId) volFilter.igrejaId = userRow.igrejaId;
    const vol = await Voluntario.findOne(volFilter).lean();
    if (!vol) return res.json({ needsComplement: false, missing: [] });
    const gap = computePerfilCheckinGap({
      telefone: vol.telefone,
      whatsapp: vol.whatsapp,
      cidade: vol.cidade,
      estado: vol.estado,
      perfilCheckinCompletoAt: vol.perfilCheckinCompletoAt,
      perfilCheckinSkip: vol.perfilCheckinSkip,
    });
    return res.json({ needsComplement: gap.needsComplement, missing: gap.missing });
  } catch (err) {
    console.error('me/perfil-checkin-gap', err?.message || err);
    res.json({ needsComplement: false, missing: [] });
  }
});

/** Voluntário: salvar complemento único ou marcar “agora não” (não repete o passo). */
app.put('/api/me/perfil-checkin-complemento', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const skip = body.skip === true;
    if (isPostgres()) {
      const userRow = req.userId ? await pgFindUserById(req.userId) : null;
      const email = (req.userEmail || userRow?.email || '').toLowerCase().trim();
      if (!email) return sendError(res, 403, 'Disponível apenas para usuários com email.');
      const igrejaId = userRow?.igrejaId || req.authIgrejaIdStr;
      if (!igrejaId) return sendError(res, 400, 'Conta sem igreja vinculada.');
      if (!skip) {
        const tel = `${body.telefone || ''} ${body.whatsapp || ''}`.trim();
        if (!tel) return sendError(res, 400, 'Informe telefone ou WhatsApp.');
        if (!(body.cidade || '').toString().trim()) return sendError(res, 400, 'Informe a cidade.');
        if (!(body.estado || '').toString().trim()) return sendError(res, 400, 'Informe o estado (UF).');
      }
      let whatsappNorm;
      if (!skip && body.whatsapp != null && String(body.whatsapp).trim()) {
        const w = normalizarWhatsapp(body.whatsapp);
        if (w === null) return sendError(res, 400, 'WhatsApp inválido. Informe 10 ou 11 dígitos (DDD + número).');
        whatsappNorm = w;
      }
      const r = await pgApplyCheckinComplemento(igrejaId, email, {
        skip,
        telefone: body.telefone,
        whatsapp: whatsappNorm,
        cidade: body.cidade != null ? normalizarCidade(body.cidade) : undefined,
        estado: body.estado != null ? normalizarEstado(body.estado) : undefined,
      });
      if (!r.ok) {
        return sendError(
          res,
          404,
          'Seu cadastro ainda não está na lista de voluntários. Abra Perfil e salve seus dados.',
        );
      }
      invalidateCache();
      return res.json({ ok: true });
    }
    if (!isMongo()) return sendError(res, 503, 'Indisponível.');
    const uRow = req.userId
      ? await User.findById(req.userId).select('email igrejaId').lean()
      : await User.findOne({
        email: (req.userEmail || '').toLowerCase(),
        ...(req.authIgrejaIdStr && mongoose.Types.ObjectId.isValid(req.authIgrejaIdStr)
          ? { igrejaId: req.authIgrejaIdStr }
          : { igrejaId: null }),
      }).select('email igrejaId').lean();
    const email = (req.userEmail || uRow?.email || '').toLowerCase().trim();
    if (!email) return sendError(res, 403, 'Disponível apenas para usuários com email.');
    if (!uRow?.igrejaId) return sendError(res, 400, 'Conta sem igreja vinculada.');
    const volFilter = { email, igrejaId: uRow.igrejaId };
    if (skip) {
      await Voluntario.updateOne(volFilter, {
        $set: { perfilCheckinSkip: true, perfilCheckinSkipAt: new Date() },
      });
    } else {
      const tel = `${body.telefone || ''} ${body.whatsapp || ''}`.trim();
      if (!tel) return sendError(res, 400, 'Informe telefone ou WhatsApp.');
      if (!(body.cidade || '').toString().trim()) return sendError(res, 400, 'Informe a cidade.');
      if (!(body.estado || '').toString().trim()) return sendError(res, 400, 'Informe o estado (UF).');
      const set = { perfilCheckinCompletoAt: new Date() };
      if (body.telefone != null && String(body.telefone).trim()) set.telefone = String(body.telefone).trim();
      if (body.whatsapp != null && String(body.whatsapp).trim()) {
        const w = normalizarWhatsapp(body.whatsapp);
        if (w === null) return sendError(res, 400, 'WhatsApp inválido.');
        set.whatsapp = w;
      }
      set.cidade = normalizarCidade(body.cidade);
      set.estado = normalizarEstado(body.estado);
      await Voluntario.updateOne(volFilter, {
        $set: set,
        $unset: { perfilCheckinSkip: 1, perfilCheckinSkipAt: 1 },
      });
    }
    invalidateCache();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao salvar dados.');
  }
});

// Revisar texto de email com LLM (Grok): devolve HTML profissional (links como botões, títulos em negrito).
app.post('/api/email/review-llm', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
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
    console.error('review-llm:', err?.message || err);
    sendError(res, 500, err.message || 'Erro interno ao revisar com IA.');
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
    console.error('versiculo-dia:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao buscar versículo.');
  }
});

app.post('/api/send-email', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
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
  const MAX_EMAIL_RECIPIENTS = Number(process.env.MAX_EMAIL_RECIPIENTS || 80);
  if (to.length > MAX_EMAIL_RECIPIENTS) {
    return res.status(400).json({ error: `Máximo de ${MAX_EMAIL_RECIPIENTS} destinatários por envio.` });
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
    console.error('send-email:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao enviar email');
  }
});

// ==================== NOVOS ENDPOINTS DE USUÁRIOS ====================

// POST /api/auth/register - Registrar novo usuário
// Body/query: igreja=slug (default celeiro-sp) — voluntário vincula à igreja do link.
app.post('/api/auth/register', async (req, res) => {
  try {
    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (!igrejaDoc) {
      return res.status(404).json({ error: 'Igreja não encontrada. Informe o slug no campo ou query "igreja".' });
    }
    const { email, nome, senha } = req.body || {};
    if (!email || !nome || !senha) {
      return res.status(400).json({ error: 'Email, nome e senha são obrigatórios.' });
    }
    const emailVal = String(email).trim().toLowerCase();
    const nomeVal = String(nome).trim();
    if (!emailVal.includes('@')) return res.status(400).json({ error: 'Email inválido.' });
    if (senha.length < 6) return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres.' });

    if (isPostgres()) {
      const existe = await pgFindUserByEmailInIgreja(igrejaDoc._id, emailVal);
      if (existe) {
        return res.status(409).json({ error: 'Email já registrado nesta igreja.' });
      }
      const user = await pgCreateUser({
        email: emailVal,
        nome: nomeVal,
        senha,
        role: 'voluntario',
        igrejaId: igrejaDoc._id,
        ministerioIds: [],
        mustChangePassword: false,
      });
      try {
        await ensureVoluntarioInList({ email: user.email, nome: user.nome, igrejaId: igrejaDoc._id });
      } catch (_) {}
      invalidateCache();
      const userRow = await pgFindUserById(user._id);
      const { token, expiresAt } = await createAuthTokenForUser(userRow);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const isMasterAdmin = MASTER_ADMIN_EMAIL && emailVal === MASTER_ADMIN_EMAIL;
      return res.status(201).json({
        token,
        user: {
          ...user,
          role: 'voluntario',
          ministerioId: null,
          ministerioNome: null,
          ministerioIds: [],
          ministerioNomes: [],
          fotoUrl: user.fotoUrl || null,
          mustChangePassword: false,
          isMasterAdmin,
          igrejaId: String(igrejaDoc._id),
          igrejaNome: igrejaDoc.nome,
          igrejaSlug: igrejaDoc.slug,
          isGlobalAdmin: false,
        },
        expiresAt,
      });
    }

    if (!isMongo()) return sendError(res, 503, 'Cadastro indisponível.');

    const existe = await User.findOne({ email: emailVal, igrejaId: igrejaDoc._id });
    if (existe) {
      return res.status(409).json({ error: 'Email já registrado nesta igreja.' });
    }

    const user = await createUserWithLegacyIndexSelfHeal({
      email: emailVal, nome: nomeVal, senha, role: 'voluntario', igrejaId: igrejaDoc._id,
    });
    try { await ensureVoluntarioInList({ email: user.email, nome: user.nome, igrejaId: igrejaDoc._id }); } catch (_) {}
    try { await vincularCheckinsAoUsuario(user._id, user.email); } catch (_) {}
    invalidateCache();

    const { token, expiresAt } = await createAuthTokenForUser(user);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const roleFinal = 'voluntario';
    const igrejaIdStr = String(igrejaDoc._id);
    const isMasterAdmin = MASTER_ADMIN_EMAIL && (user.email || '').toString().trim().toLowerCase() === MASTER_ADMIN_EMAIL;
    res.status(201).json({
      token,
      user: {
        ...user.toJSON(),
        role: roleFinal,
        ministerioId: null,
        ministerioNome: null,
        ministerioIds: [],
        ministerioNomes: [],
        fotoUrl: user.fotoUrl || null,
        mustChangePassword: false,
        isMasterAdmin,
        igrejaId: igrejaIdStr,
        igrejaNome: igrejaDoc.nome,
        igrejaSlug: igrejaDoc.slug,
        isGlobalAdmin: false,
      },
      expiresAt,
    });
  } catch (err) {
    console.error('register:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao registrar usuário.');
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
    const igrejaSlugFp = (req.body?.igrejaSlug || req.body?.igreja || '').toString().trim();

    if (isPostgres()) {
      const candidates = await pgFindUsersByEmail(email);
      const withPwd = candidates.filter((u) => u.senha);
      if (withPwd.length === 0) return res.json({ message: genericMessage });

      let user;
      if (withPwd.length === 1) {
        [user] = withPwd;
      } else if (!igrejaSlugFp) {
        const igrejas = await choicesForMultiTenantLoginPg(Igreja, withPwd);
        return res.status(409).json({
          error: 'Este email está cadastrado em mais de uma igreja. Escolha em qual deseja redefinir a senha.',
          needIgrejaChoice: true,
          igrejas,
        });
      } else {
        const slugLower = igrejaSlugFp.toLowerCase();
        let pool;
        if (slugLower === GLOBAL_LOGIN_SLUG || slugLower === 'global') {
          pool = withPwd.filter((u) => !u.igrejaId);
        } else {
          const ig = await pgFindIgrejaBySlug(igrejaSlugFp);
          if (!ig) return res.json({ message: genericMessage });
          const igId = String(ig._id);
          pool = withPwd.filter((u) => u.igrejaId && String(u.igrejaId) === igId);
        }
        if (pool.length !== 1) return res.json({ message: genericMessage });
        [user] = pool;
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      await pgSetUserResetToken(user._id, resetToken, new Date(Date.now() + RESET_TOKEN_EXPIRES_MS));
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
    }
    if (!isMongo()) return res.json({ message: genericMessage });

    const candidates = await User.find({ email }).select('_id nome senha googleId igrejaId').lean();
    const withPwd = candidates.filter((u) => u.senha);
    if (withPwd.length === 0) {
      return res.json({ message: genericMessage });
    }

    let user;
    if (withPwd.length === 1) {
      [user] = withPwd;
    } else if (!igrejaSlugFp) {
      const igrejas = await choicesForMultiTenantLoginPg(Igreja, withPwd);
      return res.status(409).json({
        error: 'Este email está cadastrado em mais de uma igreja. Escolha em qual deseja redefinir a senha.',
        needIgrejaChoice: true,
        igrejas,
      });
    } else {
      const slugLower = igrejaSlugFp.toLowerCase();
      let pool;
      if (slugLower === GLOBAL_LOGIN_SLUG || slugLower === 'global') {
        pool = withPwd.filter((u) => !u.igrejaId);
      } else {
        const ig = await Igreja.findOne({ slug: igrejaSlugFp }).lean();
        if (!ig) return res.json({ message: genericMessage });
        const igId = String(ig._id);
        pool = withPwd.filter((u) => u.igrejaId && String(u.igrejaId) === igId);
      }
      if (pool.length !== 1) return res.json({ message: genericMessage });
      [user] = pool;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    await User.updateOne(
      { _id: user._id },
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
    if (isPostgres()) {
      const user = await pgFindUserByResetToken(token.trim());
      if (!user) return res.status(400).json({ error: 'Link inválido ou expirado.' });
      await pgUpdateUserPassword(user._id, senha);
      return res.json({ message: 'Senha alterada. Faça login com a nova senha.' });
    }
    if (!isMongo()) return res.status(503).json({ error: 'Serviço temporariamente indisponível.' });
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
    console.error('reset-password:', err?.message || err);
    return sendError(res, 500, err.message || 'Erro ao redefinir senha.');
  }
});

// POST /api/auth/login-email - Login com email e senha
app.post('/api/auth/login-email', async (req, res) => {
  try {
    const { email, senha, igrejaSlug: igrejaSlugBody } = req.body || {};
    if (!email || !senha) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }
    const igrejaSlugLogin = (igrejaSlugBody || req.body?.igreja || '').toString().trim();
    const resolved = await resolveUserForEmailPasswordLogin(Igreja, User, email.toLowerCase(), senha, igrejaSlugLogin);
    if (!resolved.ok) {
      return res.status(resolved.status).json(resolved.body);
    }
    return finalizeDbUserLogin(res, resolved.user, { withCheckinLink: true });
  } catch (err) {
    console.error('login-email:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao fazer login.');
  }
});

// POST /api/auth/change-password - Trocar senha
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { senhaAtual, senhaNova } = req.body || {};
    if (!senhaAtual || !senhaNova) {
      return res.status(400).json({ error: 'Senha atual e nova são obrigatórias.' });
    }

    if (isPostgres()) {
      const user = await pgFindUserById(req.userId);
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
      if (!user.senha) {
        return res.status(403).json({ error: 'Usuário com autenticação Google não pode trocar senha aqui.' });
      }
      const valida = await user.compararSenha(senhaAtual);
      if (!valida) return res.status(401).json({ error: 'Senha atual inválida.' });
      await pgUpdateUserPassword(user._id, senhaNova);
      return res.json({ ok: true, mensagem: 'Senha alterada com sucesso.' });
    }
    if (!isMongo()) return res.status(503).json({ error: 'Serviço temporariamente indisponível.' });

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
    console.error('change-password:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao trocar senha.');
  }
});

// POST /api/users - Criar usuário (admin only). Senha temporária; usuário deve trocar no primeiro acesso.
app.post('/api/users', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const { email, nome, senha, role, ministerioIds } = req.body || {};
    const em = (email || '').toString().trim().toLowerCase();
    if (!em || !em.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');
    if (!(nome || '').toString().trim()) return sendError(res, 400, 'Nome é obrigatório.');
    const senhaVal = (senha || '').toString().trim();
    if (!senhaVal || senhaVal.length < 6) return sendError(res, 400, 'Senha temporária é obrigatória (mínimo 6 caracteres).');
    const roleVal = (role || 'voluntario').toString().toLowerCase();
    if (!['admin', 'voluntario', 'lider'].includes(roleVal)) return sendError(res, 400, 'Perfil inválido.');
    const rawIds = Array.isArray(ministerioIds) ? ministerioIds.filter(Boolean) : [];
    if (isPostgres()) {
      const existing = await pgFindUserByEmailInIgreja(req.tenantIgrejaId, em);
      if (existing) return sendError(res, 409, 'Já existe um usuário com este email nesta igreja.');
      const created = await pgCreateUser({
        email: em,
        nome: (nome || '').toString().trim(),
        senha: senhaVal,
        role: roleVal,
        igrejaId: req.tenantIgrejaId,
        ministerioIds: (roleVal === 'lider' || roleVal === 'admin') ? rawIds : [],
        mustChangePassword: true,
      });
      return res.status(201).json(created);
    }
    const existing = await User.findOne({ email: em, igrejaId: req.tenantIgrejaId });
    if (existing) return sendError(res, 409, 'Já existe um usuário com este email nesta igreja.');
    const user = await createUserWithLegacyIndexSelfHeal({
      email: em,
      nome: (nome || '').toString().trim(),
      senha: senhaVal,
      role: roleVal,
      ministerioIds: (roleVal === 'lider' || roleVal === 'admin') ? rawIds : [],
      ativo: true,
      mustChangePassword: true,
      igrejaId: req.tenantIgrejaId,
    });
    try {
      await ensureVoluntarioInList({ email: user.email, nome: user.nome, igrejaId: req.tenantIgrejaId });
    } catch (_) {}
    invalidateCache();
    const created = await User.findById(user._id).select('-senha -resetToken -resetTokenExpires').populate('ministerioIds', 'nome').lean();
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao criar usuário.');
  }
});

function buildConviteLiderPublicUrl(req, igrejaSlug, token) {
  const base = (process.env.APP_URL || '').trim()
    || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/?igreja=${encodeURIComponent(igrejaSlug)}&convite-lider=${encodeURIComponent(token)}`;
}

// GET /api/convite-lider — dados públicos do convite (sem auth)
app.get('/api/convite-lider', async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Convites de líder disponíveis em modo PostgreSQL.');
    const token = (req.query.token || '').toString().trim();
    if (!token) return sendError(res, 400, 'Token ausente.');
    const convite = await pgFindConviteByToken(token);
    if (!convite) return sendError(res, 404, 'Link inválido ou expirado.');
    if (!conviteLiderValido(convite)) return sendError(res, 410, 'Este link expirou. Peça um novo link ao administrador.');
    res.json({
      ministerioNome: convite.ministerioNome,
      igrejaNome: convite.igrejaNome,
      igrejaSlug: convite.igrejaSlug,
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao validar convite.');
  }
});

// POST /api/auth/register-lider — cadastro público de líder via link do ministério
app.post('/api/auth/register-lider', async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Cadastro de líder disponível em modo PostgreSQL.');
    const { token, nome, email, senha } = req.body || {};
    const tok = String(token || '').trim();
    const nomeVal = String(nome || '').trim();
    const emailVal = String(email || '').trim().toLowerCase();
    const senhaVal = String(senha || '');
    if (!tok || !nomeVal || !emailVal || !senhaVal) {
      return sendError(res, 400, 'Nome, email, senha e link são obrigatórios.');
    }
    if (!emailVal.includes('@')) return sendError(res, 400, 'Email inválido.');
    if (senhaVal.length < 6) return sendError(res, 400, 'Senha deve ter no mínimo 6 caracteres.');

    const convite = await pgFindConviteByToken(tok);
    if (!convite || !conviteLiderValido(convite)) {
      return sendError(res, 410, 'Link inválido ou expirado. Peça um novo link ao administrador.');
    }

    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash(senhaVal, 10);
    const existing = await pgFindUserByEmailInIgreja(convite.igrejaId, emailVal);
    const normalizeMinisterioId = (m) => {
      if (m && typeof m === 'object' && m._id != null) return String(m._id);
      return String(m || '').trim();
    };
    const ministerioIds = [...new Set([
      ...(existing?.ministerioIds || []).map(normalizeMinisterioId).filter(Boolean),
      String(convite.ministerioId),
    ])];
    const { user, created } = await pgUpsertUserWithPasswordHash({
      email: emailVal,
      nome: nomeVal,
      senhaHash: hash,
      role: 'lider',
      igrejaId: convite.igrejaId,
      ministerioIds,
      mustChangePassword: false,
      ativo: true,
    });

    await pgIncrementConviteUso(tok);
    invalidateCache();

    const userRow = await pgFindUserById(user._id);
    const { token: authToken, expiresAt } = await createAuthTokenForUser(userRow);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.status(created ? 201 : 200).json({
      message: created
        ? 'Conta criada! Você já pode usar a plataforma.'
        : 'Senha atualizada e acesso de líder restaurado para este ministério.',
      token: authToken,
      expiresAt,
      user: {
        ...user,
        mustChangePassword: false,
        igrejaId: convite.igrejaId,
        igrejaNome: convite.igrejaNome,
        igrejaSlug: convite.igrejaSlug,
      },
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao cadastrar líder.');
  }
});

// GET /api/convites-lider — links de cadastro por ministério (admin)
app.get('/api/convites-lider', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Disponível em modo PostgreSQL.');
    const list = await pgListConvitesLider(req.tenantIgrejaId);
    const slug = req.tenantIgrejaSlug || DEFAULT_IGREJA_SLUG;
    const convites = list.map((c) => ({
      ...c,
      link: c.token ? buildConviteLiderPublicUrl(req, slug, c.token) : null,
    }));
    res.json({ convites });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao listar convites.');
  }
});

// POST /api/convites-lider/generate — gera ou renova link de um ministério
app.post('/api/convites-lider/generate', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Disponível em modo PostgreSQL.');
    const ministerioId = (req.body?.ministerioId || '').toString().trim();
    const regenerar = !!req.body?.regenerar;
    if (!ministerioId) return sendError(res, 400, 'ministerioId é obrigatório.');
    const mins = await pgListMinisterios(req.tenantIgrejaId);
    const min = mins.find((x) => String(x._id) === ministerioId);
    if (!min) return sendError(res, 404, 'Ministério não encontrado.');
    const convite = await pgUpsertConviteLider(req.tenantIgrejaId, ministerioId, { regenerar });
    const slug = req.tenantIgrejaSlug || DEFAULT_IGREJA_SLUG;
    res.json({
      ministerioId,
      ministerioNome: min.nome,
      link: buildConviteLiderPublicUrl(req, slug, convite.token),
      expiresAt: convite.expiresAt,
    });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao gerar convite.');
  }
});

// POST /api/convites-lider/generate-all — gera links para todos os ministérios ativos
app.post('/api/convites-lider/generate-all', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Disponível em modo PostgreSQL.');
    const regenerar = !!req.body?.regenerar;
    const mins = await pgListMinisterios(req.tenantIgrejaId);
    const slug = req.tenantIgrejaSlug || DEFAULT_IGREJA_SLUG;
    const convites = [];
    for (const m of mins) {
      if (m.ativo === false) continue;
      const convite = await pgUpsertConviteLider(req.tenantIgrejaId, m._id, { regenerar });
      convites.push({
        ministerioId: m._id,
        ministerioNome: m.nome,
        link: buildConviteLiderPublicUrl(req, slug, convite.token),
        expiresAt: convite.expiresAt,
      });
    }
    res.json({ convites, total: convites.length });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao gerar convites.');
  }
});

// GET /api/ministros - Listar ministérios (admin)
app.get('/api/ministros', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (isPostgres()) {
      const list = await pgListMinisterios(req.tenantIgrejaId);
      const leadersByMinist = await pgLeadersByMinisterioId(req.tenantIgrejaId);
      return res.json(list.map((m) => ({
        ...m,
        lideres: leadersByMinist[String(m._id)] || [],
      })));
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    const list = await Ministerio.find({ ...tQ(req) }).sort({ nome: 1 }).lean();
    
    // Otimização: busca todos os líderes de uma vez (evita N+1)
    const ministerioIds = list.map(m => m._id);
    const allLeaders = await User.find({ ministerioIds: { $in: ministerioIds }, ativo: true, ...tQ(req) }).select('nome email role ministerioIds').lean();
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
app.post('/api/ministros', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim();
    if (!nome) return sendError(res, 400, 'Nome do ministério é obrigatório.');
    const slug = nome.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || nome;
    if (isPostgres()) {
      const existing = await pgFindMinisterioByNome(req.tenantIgrejaId, nome);
      if (existing) return sendError(res, 400, 'Ministério com esse nome já existe.');
      const doc = await pgCreateMinisterio({ igrejaId: req.tenantIgrejaId, nome, slug });
      return res.status(201).json({ ...doc, lideres: [] });
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    const existing = await Ministerio.findOne({ $or: [{ nome }, { slug }], ...tQ(req) });
    if (existing) return sendError(res, 400, 'Ministério com esse nome já existe.');
    const doc = await Ministerio.create({ nome, slug: slug || nome, ...tQ(req) });
    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao criar ministério.');
  }
});

// PUT /api/ministros/:id - Atualizar ministério ou atribuir líderes (admin). liderIds = array de userId.
app.put('/api/ministros/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const { nome, ativo, liderId, liderIds } = req.body;
    const newLiderIds = Array.isArray(liderIds) ? liderIds.filter(Boolean) : (liderId ? [liderId] : undefined);

    if (isPostgres()) {
      const minist = await pgFindMinisterioById(req.params.id, req.tenantIgrejaId);
      if (!minist) return sendError(res, 404, 'Ministério não encontrado.');
      const updated = await pgUpdateMinisterio(req.params.id, req.tenantIgrejaId, { nome, ativo });
      if (newLiderIds !== undefined) {
        await pgSetMinisterioLideres(req.params.id, req.tenantIgrejaId, newLiderIds, req.userId);
        invalidateCache();
      }
      return res.json(updated);
    }

    const minist = await Ministerio.findOne({ _id: req.params.id, ...tQ(req) });
    if (!minist) return sendError(res, 404, 'Ministério não encontrado.');
    if (nome != null) minist.nome = String(nome).trim();
    if (ativo !== undefined) minist.ativo = !!ativo;
    await minist.save();
    if (newLiderIds !== undefined) {
      const exLideres = await User.find({ ministerioIds: minist._id, ...tQ(req) }).select('_id role ministerioIds').lean();
      for (const u of exLideres) {
        const newIds = (u.ministerioIds || []).filter(id => String(id) !== String(minist._id));
        await User.findByIdAndUpdate(u._id, { ministerioIds: newIds, ...(newIds.length === 0 && u.role !== 'admin' ? { role: 'voluntario' } : {}) });
        await RoleHistory.create({ igrejaId: req.tenantIgrejaId, userId: u._id, fromRole: u.role || 'lider', toRole: newIds.length === 0 && u.role !== 'admin' ? 'voluntario' : (u.role || 'lider'), ministerioId: minist._id, changedBy: req.userId });
      }
      for (const uid of newLiderIds) {
        const u = await User.findOne({ _id: uid, ...tQ(req) }).select('ministerioIds role').lean();
        if (!u) continue;
        const ids = [...(u.ministerioIds || []).map(id => id)];
        if (ids.some(id => String(id) === String(minist._id))) continue;
        ids.push(minist._id);
        const newRole = u.role === 'admin' ? 'admin' : 'lider';
        await User.findByIdAndUpdate(uid, { ministerioIds: ids, role: newRole });
        await RoleHistory.create({ igrejaId: req.tenantIgrejaId, userId: uid, fromRole: u.role || 'voluntario', toRole: newRole, ministerioId: minist._id, changedBy: req.userId });
      }
    }
    res.json(minist);
  } catch (err) {
    console.error('ministros PUT:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao atualizar ministério.');
  }
});

// DELETE /api/ministros/:id - Excluir ministério (admin)
app.delete('/api/ministros/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (isPostgres()) {
      const minist = await pgFindMinisterioById(req.params.id, req.tenantIgrejaId);
      if (!minist) return sendError(res, 404, 'Ministério não encontrado.');
      // Remove líderes (já loga role_history) antes de apagar.
      await pgSetMinisterioLideres(req.params.id, req.tenantIgrejaId, [], req.userId);
      const ok = await pgDeleteMinisterio(req.params.id, req.tenantIgrejaId);
      if (!ok) return sendError(res, 404, 'Ministério não encontrado.');
      invalidateCache();
      return res.json({ ok: true, message: 'Ministério excluído.' });
    }
    const minist = await Ministerio.findOne({ _id: req.params.id, ...tQ(req) });
    if (!minist) return sendError(res, 404, 'Ministério não encontrado.');
    const exLideres = await User.find({ ministerioIds: minist._id, ...tQ(req) }).select('_id role ministerioIds').lean();
    for (const u of exLideres) {
      const newIds = (u.ministerioIds || []).filter(id => String(id) !== String(minist._id));
      await User.findByIdAndUpdate(u._id, { ministerioIds: newIds, ...(newIds.length === 0 && u.role !== 'admin' ? { role: 'voluntario' } : {}) });
      await RoleHistory.create({ igrejaId: req.tenantIgrejaId, userId: u._id, fromRole: u.role || 'lider', toRole: newIds.length === 0 && u.role !== 'admin' ? 'voluntario' : (u.role || 'lider'), ministerioId: minist._id, changedBy: req.userId });
    }
    await Ministerio.findOneAndDelete({ _id: minist._id, ...tQ(req) });
    res.json({ ok: true, message: 'Ministério excluído.' });
  } catch (err) {
    console.error('ministros DELETE:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao excluir ministério.');
  }
});

// GET /api/users/foto - Foto de um usuário por email (admin ou líder, para exibir no perfil)
app.get('/api/users/foto', requireAuth, resolveTenant, async (req, res) => {
  try {
    const role = String(req.userRole || '').toLowerCase();
    if (role !== 'admin' && role !== 'lider') return sendError(res, 403, 'Acesso negado.');
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) return sendError(res, 400, 'Parâmetro email é obrigatório.');
    if (isPostgres()) {
      const url = await pgFindUserFotoUrl(req.tenantIgrejaId, email);
      return res.json({ fotoUrl: url });
    }
    const user = await User.findOne({ email, ...tQ(req) }).select('fotoUrl').lean();
    res.json({ fotoUrl: user?.fotoUrl || null });
  } catch (err) {
    console.error('users/foto:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao buscar foto.');
  }
});

// GET /api/users - Listar usuários (admin only). Query: search (nome/email), ativo (true|false).
app.get('/api/users', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (isPostgres()) {
      const { search, ativo } = req.query || {};
      const users = await pgListUsers(req.tenantIgrejaId, { search, ativo });
      return res.json(users);
    }
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    const { search, ativo } = req.query || {};
    const filter = { ...tQ(req) };
    if (ativo === 'true') filter.ativo = true;
    if (ativo === 'false') filter.ativo = false;
    if (search && typeof search === 'string' && search.trim()) {
      const s = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ nome: new RegExp(s, 'i') }, { email: new RegExp(s, 'i') }];
    }
    const users = await User.find(filter, '-senha -resetToken -resetTokenExpires').populate('ministerioIds', 'nome').sort({ nome: 1 }).lean();
    res.json(users);
  } catch (err) {
    console.error('users list:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao listar usuários.');
  }
});

// GET /api/users/by-email?email=xxx - Buscar usuário por email (admin, para definir líderes)
app.get('/api/users/by-email', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return sendError(res, 400, 'Email inválido.');
    if (isPostgres()) {
      const user = await pgFindUserByEmailInIgreja(req.tenantIgrejaId, email);
      if (!user) return sendError(res, 404, 'Nenhum usuário encontrado com este email.');
      return res.json(user);
    }
    const user = await User.findOne({ email, ...tQ(req) }, '-senha -resetToken -resetTokenExpires').populate('ministerioIds', 'nome').lean();
    if (!user) return sendError(res, 404, 'Nenhum usuário encontrado com este email.');
    res.json(user);
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao buscar usuário.');
  }
});

// GET /api/users/:id/history - Histórico de alteração de role (admin)
app.get('/api/users/:id/history', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (isPostgres()) {
      const list = await pgListRoleHistoryByUser(req.params.id, req.tenantIgrejaId);
      return res.json(list);
    }
    const list = await RoleHistory.find({ userId: req.params.id, ...tQ(req) }).sort({ createdAt: -1 }).populate('changedBy', 'nome').populate('ministerioId', 'nome').lean();
    res.json(list);
  } catch (err) {
    console.error('users history:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao carregar histórico.');
  }
});

// PUT /api/users/:id - Editar usuário e role (admin); registra histórico. ministerioIds = array (líder pode ter vários; admin também pode ter).
app.put('/api/users/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const { nome, role, ativo, ministerioId, ministerioIds } = req.body;
    if (isPostgres()) {
      const rawIds = Array.isArray(ministerioIds) ? ministerioIds : (ministerioId != null ? [ministerioId] : undefined);
      const roleVal = role !== undefined ? String(role).toLowerCase() : undefined;
      if (roleVal && !['admin', 'voluntario', 'lider'].includes(roleVal)) {
        return sendError(res, 400, 'Role inválido.');
      }
      const updated = await pgUpdateUser(req.params.id, req.tenantIgrejaId, {
        nome: nome !== undefined ? String(nome).trim() : undefined,
        role: roleVal,
        ativo,
        ministerioIds: rawIds,
      });
      if (!updated) return sendError(res, 404, 'Usuário não encontrado.');
      return res.json(updated);
    }
    const user = await User.findOne({ _id: req.params.id, ...tQ(req) });
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
    const updated = await User.findOneAndUpdate({ _id: req.params.id, ...tQ(req) }, updates, { new: true }).populate('ministerioIds', 'nome');
    if (newRole === 'voluntario') {
      try {
        await ensureVoluntarioInList({
          email: updated.email, nome: updated.nome, igrejaId: updated.igrejaId || req.tenantIgrejaId,
        });
      } catch (_) {}
      invalidateCache();
    }
    if (role !== undefined && role !== fromRole) {
      await RoleHistory.create({
        igrejaId: req.tenantIgrejaId,
        userId: user._id,
        fromRole,
        toRole: role,
        ministerioId: (updates.ministerioIds && updates.ministerioIds[0]) || null,
        changedBy: req.userId,
      });
    } else if (rawIds !== undefined && (newRole === 'lider' || newRole === 'admin')) {
      await RoleHistory.create({
        igrejaId: req.tenantIgrejaId,
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
app.post('/api/fix-datacheckin', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
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
app.post('/api/migrate', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    if (!VOLUNTARIOS_CSV_PATH && !CSV_URL) return sendError(res, 400, 'VOLUNTARIOS_CSV_PATH ou CSV_URL não configurado.');
    const celeiroId = await getCeleiroIgrejaIdForLegacyImport();
    const volResult = await syncVoluntarios(celeiroId);
    const checkResult = CHECKIN_CSV_PATH ? await syncCheckins(celeiroId) : { inserted: 0, updated: 0, skipped: true };

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
app.post('/api/send-cadastro-incompleto', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return sendError(res, 500, 'RESEND_API_KEY não configurada.');
    const dryRun = String(req.query.dry || 'false') !== 'false';
    const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
    const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';

    // Emails únicos com check-in
    const checkinsAgg = await Checkin.aggregate([
      { $match: { ...tQ(req) } },
      { $group: { _id: { $toLower: '$email' }, nome: { $first: '$nome' } } },
      { $match: { _id: { $ne: null, $nin: ['', null] } } },
    ]);

    // Voluntarios com perfil (nome preenchido)
    const perfis = await Voluntario.find({
      email: { $exists: true, $ne: '' }, nome: { $exists: true, $ne: '' }, ...tQ(req),
    }).select('email').lean();
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

function candidaturaVisivelParaLider(c, req) {
  if (req.userRole !== 'lider') return true;
  const nomes = (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean);
  if (!nomes.length && req.userMinisterioNome) nomes.push(String(req.userMinisterioNome).trim());
  if (!nomes.length) return false;
  const min = (c.ministerio || '').trim().toLowerCase();
  return nomes.some((n) => {
    const nl = n.toLowerCase();
    return min === nl || min.includes(nl) || nl.includes(min);
  });
}

async function loadEscalasECandidaturasVisao(req, dataYmd) {
  const hoje = getHojeDateString();
  const ymd = dataYmd || hoje;
  if (isPostgres()) {
    const todas = await pgListEscalas(req.tenantIgrejaId, { limit: 300 });
    const escalas = todas.filter((e) => escalaDataToYMD(e.data) === ymd);
    const ids = escalas.map((e) => e._id);
    let candidaturas = await pgListCandidaturasByEscalaIds(req.tenantIgrejaId, ids);
    candidaturas = candidaturas.filter((c) => candidaturaVisivelParaLider(c, req));
    return { dataYmd: ymd, escalas, candidaturas };
  }
  if (!isMongo()) return { dataYmd: ymd, escalas: [], candidaturas: [] };
  const { start, end } = getDayRangeBrasilia(ymd);
  const escalas = await Escala.find({
    ...tQ(req),
    data: { $gte: start, $lt: end },
  }).select('nome data').lean();
  const ids = escalas.map((e) => e._id);
  let candidaturas = ids.length
    ? await Candidatura.find({ escalaId: { $in: ids }, ...tQ(req) }).lean()
    : [];
  candidaturas = candidaturas.filter((c) => candidaturaVisivelParaLider(c, req));
  return { dataYmd: ymd, escalas, candidaturas };
}

function resolveDataYmdVisaoQuery(req) {
  const hoje = getHojeDateString();
  const parsed = parseDataQuery(req.query.data, hoje);
  if (parsed) return parsed;
  if (req.query.proximoDomingo === '1' || req.query.proximoDomingo === 'true') {
    let c = hoje;
    for (let i = 0; i < 21; i += 1) {
      if (weekdayBrasilia(c) === 0) return c;
      const next = addDaysYmd(c, 1);
      if (!next) break;
      c = next;
    }
  }
  return hoje;
}

// GET /api/escalas/visao-consolidada — Manhã / Almoço / Tarde por ministério (domingo 2 cultos)
app.get('/api/escalas/visao-consolidada', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const dataYmd = resolveDataYmdVisaoQuery(req);
    const statusParam = (req.query.status || 'aprovado').toString();
    const statusIn = statusParam === 'todos'
      ? ['aprovado', 'pendente', 'desistencia', 'falta']
      : statusParam.split(',').map((s) => s.trim()).filter(Boolean);

    const { escalas, candidaturas } = await loadEscalasECandidaturasVisao(req, dataYmd);
    const visao = buildVisaoConsolidada({ escalas, candidaturas, statusIn });
    const day = pickDayFromVisao(visao, dataYmd);

    const detalhes = req.query.detalhes === '1';
    let detalhesAlmoco = null;
    if (detalhes && day) {
      const emailsManha = new Set();
      const emailsTarde = new Set();
      const byEmail = new Map();
      for (const c of candidaturas) {
        if (!statusIn.includes(c.status)) continue;
        const escala = escalas.find((e) => String(e._id) === String(c.escalaId));
        if (!escala) continue;
        const turno = detectTurnoEscala(escala.nome);
        const em = (c.email || '').toLowerCase();
        if (!em) continue;
        if (turno === 'manha') emailsManha.add(em);
        if (turno === 'tarde') emailsTarde.add(em);
        if (!byEmail.has(em)) byEmail.set(em, { email: em, nome: c.nome, ministerios: new Set() });
        byEmail.get(em).ministerios.add(c.ministerio);
      }
      detalhesAlmoco = [...emailsManha].filter((e) => emailsTarde.has(e)).map((e) => ({
        email: e,
        nome: byEmail.get(e)?.nome || '',
        ministerios: [...(byEmail.get(e)?.ministerios || [])],
      }));
    }

    const payload = {
      data: dataYmd,
      timezone: visao.timezone,
      escalasManha: day?.escalas?.manha || [],
      escalasTarde: day?.escalas?.tarde || [],
      ministerios: day
        ? [...day.ministerios.entries()].map(([key, v]) => ({
          key,
          manha: v.manha,
          almoco: v.almoco,
          tarde: v.tarde,
        }))
        : [],
      totalAlmoco: day?.totalAlmoco || 0,
      intercessao: day?.intercessao || { manha: 0, almoco: 0, tarde: 0 },
      detalhesAlmoco,
    };

    if ((req.query.formato || '').toString() === 'texto') {
      return res.json({ ...payload, texto: formatVisaoConsolidadaTexto(day) });
    }
    res.json({ ...payload, texto: formatVisaoConsolidadaTexto(day) });
  } catch (err) {
    console.error(err);
    sendError(res, 500, err.message || 'Erro ao gerar visão consolidada.');
  }
});

// GET /api/escalas — lista escalas
// - admin: histórico completo (futuras asc, depois passadas desc), limite ESCALAS_LIST_LIMIT
// - líder: apenas a próxima ocorrência futura de cada culto recorrente (mais avulsos futuros)
// - voluntário: idem líder (já filtrado também por candidaturaAberta)
// ?light=1 — retorna escalas sem aggregation (rápido); frontend pode carregar contagens depois
const ESCALAS_LIST_LIMIT = 200;
app.get('/api/escalas', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    const light = req.query.light === '1' || req.query.light === 'true';
    if (isPostgres()) {
      const escalas = await pgListEscalas(req.tenantIgrejaId, {
        ativoOnly: false,
        limit: ESCALAS_LIST_LIMIT,
        nextPerCultoOnly: !isAdmin,
      });
      if (!escalas.length) return res.json([]);
      let enriched = await enrichEscalasCandidatura(req.tenantIgrejaId, escalas);
      if (!(isAdmin || isLider)) {
        enriched = enriched.filter((e) => e.candidaturaAberta);
      }
      if (light) {
        return res.json(enriched.map((e) => ({ ...e, totalCandidaturas: 0, totalAprovados: 0 })));
      }
      const countMap = await pgCountCandidaturasByEscala(req.tenantIgrejaId, enriched.map((e) => e._id));
      return res.json(enriched.map((e) => {
        const c = countMap.get(String(e._id)) || { total: 0, aprovados: 0 };
        return { ...e, totalCandidaturas: c.total, totalAprovados: c.aprovados };
      }));
    }
    const base = { ...tQ(req) };
    const query = (isAdmin || isLider) ? { ...base } : { ...base, ativo: true };
    const hoje = getHojeDateString();
    let escalas = await Escala.find(query).sort({ data: -1, createdAt: -1 }).limit(ESCALAS_LIST_LIMIT).select('nome data descricao ativo createdAt cultoRecorrenteId').lean();
    if (!(isAdmin || isLider)) {
      escalas = escalas.filter((e) => {
        const ymd = escalaDataToYMD(e.data);
        return ymd && ymd > hoje && e.ativo !== false;
      });
    }
    // Smart sort para admin (futuras asc, depois passadas desc); líder/voluntário recebe lista futura asc.
    escalas.sort((a, b) => {
      const da = escalaDataToYMD(a.data) || '';
      const db = escalaDataToYMD(b.data) || '';
      const aFut = !!da && da >= hoje;
      const bFut = !!db && db >= hoje;
      if (aFut && !bFut) return -1;
      if (!aFut && bFut) return 1;
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      if (aFut && bFut) return da.localeCompare(db);
      return db.localeCompare(da);
    });
    // Líder/voluntário: 1 escala futura por cultoRecorrenteId
    if (!isAdmin) {
      const seen = new Set();
      escalas = escalas.filter((e) => {
        const cid = e.cultoRecorrenteId ? String(e.cultoRecorrenteId) : null;
        if (!cid) return true;
        if (seen.has(cid)) return false;
        seen.add(cid);
        return true;
      });
    }
    const ids = escalas.map(e => e._id);
    if (ids.length === 0) return res.json([]);
    if (light) {
      return res.json(escalas.map(e => ({ ...e, totalCandidaturas: 0, totalAprovados: 0 })));
    }

    let countMatch = { escalaId: { $in: ids }, igrejaId: req.tenantIgrejaId };
    if (isLider) {
      const nomes = req.userMinisterioNomes && req.userMinisterioNomes.length
        ? req.userMinisterioNomes.map(String).map(s => s.trim()).filter(Boolean)
        : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
      if (nomes.length > 0) {
        const orConditions = [
          { ministerio: { $in: nomes } },
          ...nomes.map((n) => ({ ministerio: new RegExp(escapeRegex(n), 'i') })),
        ];
        countMatch = { escalaId: { $in: ids }, igrejaId: req.tenantIgrejaId, $or: orConditions };
      } else {
        countMatch = { escalaId: { $in: ids }, igrejaId: req.tenantIgrejaId, ministerio: '__nenhum__' };
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
app.get('/api/escalas/candidaturas-all', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    if (isPostgres()) {
      const escalas = await pgListEscalas(req.tenantIgrejaId, { limit: 500 });
      const ids = escalas.map((e) => e._id);
      let candidaturas = await pgListCandidaturasForEscalas(req.tenantIgrejaId, ids);
      if (isLider) {
        const nomes = req.userMinisterioNomes?.length
          ? req.userMinisterioNomes.map((n) => String(n).trim()).filter(Boolean)
          : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
        if (!nomes.length) return res.json([]);
        candidaturas = filterCandidaturasForLider(candidaturas, nomes);
      }
      if (!candidaturas.length) return res.json([]);

      const escalaMap = new Map(escalas.map((e) => [String(e._id), e]));
      const emails = [...new Set(candidaturas.map((c) => (c.email || '').toLowerCase()).filter(Boolean))];
      const { statsMap, checkinsMap } = await pgCandidaturaStatsByEmails(req.tenantIgrejaId, emails);
      const liderMinisterios = isLider
        ? (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean)
        : [];
      const result = candidaturas.map((c) => {
        const stats = statsMap.get((c.email || '').toLowerCase()) || {};
        const ci = checkinsMap.get((c.email || '').toLowerCase()) || { total: 0, ministerios: [] };
        const jaServiuMinLider = liderMinisterios.length > 0
          && ci.ministerios.some((m) => liderMinisterios.some((lm) => (m || '').toLowerCase().includes((lm || '').toLowerCase())));
        const escala = escalaMap.get(String(c.escalaId));
        return {
          ...c,
          escalaNome: escala?.nome,
          escalaData: escala?.data != null ? escalaDataToYMD(escala.data) : null,
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
      return res.json(result);
    }
    if (!isMongo()) return sendError(res, 503, 'Candidaturas indisponíveis.');

    const escBase = { ...tQ(req) };
    const escalas = await Escala.find((isAdmin || isLider) ? { ...escBase } : { ...escBase, ativo: true }).sort({ createdAt: -1 }).lean();
    const ids = escalas.map((e) => e._id);
    let query = { escalaId: { $in: ids }, igrejaId: req.tenantIgrejaId };
    if (isLider) {
      const nomes = req.userMinisterioNomes?.length ? req.userMinisterioNomes.map((n) => String(n).trim()).filter(Boolean) : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
      if (!nomes.length) return res.json([]);
      const orConditions = [
        { ministerio: { $in: nomes } },
        ...nomes.map((n) => ({ ministerio: new RegExp(escapeRegex(n), 'i') })),
      ];
      query = { escalaId: { $in: ids }, igrejaId: req.tenantIgrejaId, $or: orConditions };
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
        { $match: { email: { $in: emails }, igrejaId: req.tenantIgrejaId } },
        { $group: { _id: '$email', totalParticipacoes: { $sum: condAprovado }, totalDesistencias: { $sum: condDesistencia }, totalFaltas: { $sum: condFalta } } },
      ]),
      Checkin.aggregate([
        { $match: { email: { $in: emails }, igrejaId: req.tenantIgrejaId } },
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
        escalaData: escala?.data != null ? escalaDataToYMD(escala.data) : null,
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
app.post('/api/candidaturas/bulk-status', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const { ids, status } = req.body || {};
    const validStatus = ['aprovado', 'desistencia', 'falta'];
    if (!status || !validStatus.includes(status)) return sendError(res, 400, `Status inválido. Use: ${validStatus.join(', ')}`);
    const idList = Array.isArray(ids) ? ids.filter((id) => id && isValidEntityId(id)).map(String) : [];
    if (!idList.length) return sendError(res, 400, 'Informe ao menos um id.');

    if (isPostgres()) {
      const nomes = isLider ? (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean) : [];
      if (isLider && nomes.length) {
        for (const id of idList) {
          const c = await pgFindCandidaturaById(id, req.tenantIgrejaId);
          if (!c) return sendError(res, 404, 'Candidatura não encontrada.');
          if (!filterCandidaturasForLider([c], nomes).length) {
            return sendError(res, 403, 'Algumas candidaturas não são do seu ministério.');
          }
        }
      }
      const modified = await pgBulkUpdateCandidaturaStatus(idList, req.tenantIgrejaId, status, { aprovadoPor: req.userId });
      invalidateCache();
      return res.json({ ok: true, modified });
    }

    const candidaturas = await Candidatura.find({ _id: { $in: idList }, ...tQ(req) }).lean();
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

    const result = await Candidatura.updateMany({ _id: { $in: idList }, ...tQ(req) }, { $set: update });
    if (status === 'aprovado' && result.modifiedCount > 0) {
      for (const c of candidaturas) {
        if (c.status !== 'aprovado' && c.email && !c.emailEnviado) {
          try {
            const escala = await Escala.findOne({ _id: c.escalaId, ...tQ(req) }).lean();
            const resend = new Resend(process.env.RESEND_API_KEY);
            if (process.env.RESEND_API_KEY && escala) {
              await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>',
                to: c.email,
                reply_to: process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com',
                subject: `Participação confirmada — ${escala.nome || 'Escala'}`,
                html: `<p>Olá! Sua participação na escala <strong>${escala.nome}</strong> foi confirmada. Obrigado por servir!</p>`,
              });
              await Candidatura.updateOne({ _id: c._id, ...tQ(req) }, { emailEnviado: true });
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
app.get('/api/escalas/export-csv', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!guardMongoData(res, EMPTY_ARRAY)) return;
    const escalas = await Escala.find({ ...tQ(req) }).sort({ createdAt: -1 }).lean();
    const ids = escalas.map((e) => e._id);
    const candidaturas = await Candidatura.find({ escalaId: { $in: ids }, ...tQ(req) }).sort({ ministerio: 1, nome: 1 }).lean();
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
// Por padrão também cria o evento de check-in correspondente e os vincula
// (Fase 1 da integração escala↔checkin). Para desligar: passe `criarEventoCheckin: false`.
app.post('/api/escalas', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const {
      nome, data, descricao, ativo,
      capacidades,
      criarEventoCheckin,
      horarioInicio,
      horarioFim,
    } = req.body || {};
    if (!nome || !String(nome).trim()) return sendError(res, 400, 'Nome é obrigatório.');
    const queroCriarEvento = criarEventoCheckin !== false; // default = true
    if (isPostgres()) {
      let escala = await pgCreateEscala({
        igrejaId: req.tenantIgrejaId,
        nome: String(nome).trim(),
        data: data || null,
        descricao: descricao || '',
        ativo: typeof ativo === 'boolean' ? ativo : true,
        criadoPor: req.userId,
        capacidades: capacidades || {},
      });
      if (queroCriarEvento && escala?.data) {
        const ymd = String(data).slice(0, 10);
        // Tenta reusar um evento já existente na mesma data; se não houver, cria um novo.
        let evento = await pgFindEventoCheckinPorData(req.tenantIgrejaId, ymd);
        if (!evento) {
          evento = await pgCreateEventoCheckin({
            igrejaId: req.tenantIgrejaId,
            dataYmd: ymd,
            label: String(nome).trim(),
            ativo: true,
            horarioInicio: horarioInicio || '',
            horarioFim: horarioFim || '',
            criadoPor: req.userId,
            autoGerado: true,
          });
        }
        if (evento?._id) {
          escala = await pgUpdateEscala(escala._id, req.tenantIgrejaId, { eventoCheckinId: evento._id });
        }
      }
      return res.status(201).json(escala);
    }
    const escala = await Escala.create({
      ...tQ(req),
      nome: String(nome).trim(),
      data: data ? parseDateOnlyToUTC(data) : null,
      descricao: (descricao || '').trim(),
      ativo: typeof ativo === 'boolean' ? ativo : true,
      criadoPor: req.userId,
    });
    res.status(201).json(escala);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// PUT /api/escalas/:id — atualiza escala (admin only)
app.put('/api/escalas/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const { nome, data, descricao, ativo, capacidades, eventoCheckinId } = req.body || {};
    if (isPostgres()) {
      const escala = await pgUpdateEscala(req.params.id, req.tenantIgrejaId, {
        nome, data, descricao, ativo, capacidades, eventoCheckinId,
      });
      if (!escala) return sendError(res, 404, 'Escala não encontrada.');
      return res.json(escala);
    }
    const update = {};
    if (nome !== undefined) update.nome = String(nome).trim();
    if (data !== undefined) update.data = data ? parseDateOnlyToUTC(data) : null;
    if (descricao !== undefined) update.descricao = String(descricao).trim();
    if (typeof ativo === 'boolean') update.ativo = ativo;
    const escala = await Escala.findOneAndUpdate({ _id: req.params.id, ...tQ(req) }, update, { new: true });
    if (!escala) return sendError(res, 404, 'Escala não encontrada.');
    res.json(escala);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// POST /api/escalas/enviar-lembrete — lembrete de inscrição (segunda→quarta, quinta→domingo)
app.post('/api/escalas/enviar-lembrete', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    if (!isPostgres()) return sendError(res, 503, 'Disponível em modo PostgreSQL.');
    const body = req.body || {};
    const force = body.force === true;
    let tipo = (body.tipo || '').toString().trim().toLowerCase();
    if (!tipo) tipo = resolveEscalaLembreteTipoForToday() || '';
    if (tipo !== 'quarta' && tipo !== 'domingo') {
      return sendError(res, 400, 'Informe tipo "quarta" ou "domingo" (ou rode em segunda/quinta).');
    }
    const cultoDataYmd = (body.cultoData || '').toString().trim().slice(0, 10)
      || getCultoDataYmdForLembrete(tipo);
    if (!cultoDataYmd) return sendError(res, 400, 'Não foi possível determinar a data do culto.');
    const r = await sendEscalaLembreteEmailsForIgreja({
      igrejaId: req.tenantIgrejaId,
      tipo,
      cultoDataYmd,
      appBase: resolveAppBaseUrl(req),
      force,
    });
    if (r.skipped && r.reason === 'no_resend') {
      return sendError(res, 503, 'RESEND_API_KEY não configurada.');
    }
    if (r.skipped && r.reason === 'already_sent' && !force) {
      return sendError(res, 409, 'Lembrete já enviado para esta data. Use force: true para reenviar.');
    }
    res.json({
      ok: true,
      tipo,
      cultoDataYmd,
      sent: r.sent || 0,
      failed: r.failed || 0,
      total: r.total || 0,
      skipped: r.skipped || false,
      reason: r.reason || null,
    });
  } catch (err) {
    console.error('escalas/enviar-lembrete:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao enviar lembretes.');
  }
});

// POST /api/escalas/bulk-delete — exclui várias escalas (admin)
app.post('/api/escalas/bulk-delete', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids)
      ? body.ids.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const redirectToEscalaId = (body.redirectToEscalaId || '').toString().trim() || null;
    const forceWithoutRedirect = body.forceWithoutRedirect === true;

    if (!ids.length) return sendError(res, 400, 'Informe ao menos uma escala (ids).');
    if (ids.length > 100) return sendError(res, 400, 'Máximo de 100 escalas por operação.');

    if (isPostgres()) {
      const r = await pgBulkDeleteEscalas(ids, req.tenantIgrejaId, {
        redirectToEscalaId,
        forceWithoutRedirect,
      });
      if (r.error && !r.needRedirect) return sendError(res, 400, r.error);
      if (r.needRedirect) {
        return res.status(409).json({
          error: `As escalas selecionadas têm ${r.candidaturas} candidatura(s) no total. Escolha uma escala futura ativa para redirecionar ou confirme exclusão sem redirecionar.`,
          needRedirect: true,
          candidaturas: r.candidaturas,
          ids: r.ids,
        });
      }
      invalidateCache();
      return res.json({
        ok: true,
        deleted: r.deleted || 0,
        moved: r.moved || 0,
        redirectedTo: r.redirectedTo || null,
      });
    }

    if (redirectToEscalaId && ids.includes(String(redirectToEscalaId))) {
      return sendError(res, 400, 'A escala de destino não pode estar na lista de exclusão.');
    }

    const found = await Escala.find({ _id: { $in: ids }, ...tQ(req) }).select('_id').lean();
    if (found.length !== ids.length) {
      return sendError(res, 404, 'Uma ou mais escalas não foram encontradas.');
    }

    const totalCand = await Candidatura.countDocuments({ escalaId: { $in: ids }, ...tQ(req) });
    if (totalCand > 0 && !redirectToEscalaId && !forceWithoutRedirect) {
      return res.status(409).json({
        error: `As escalas selecionadas têm ${totalCand} candidatura(s) no total. Escolha uma escala futura ativa para redirecionar ou confirme exclusão sem redirecionar.`,
        needRedirect: true,
        candidaturas: totalCand,
        ids,
      });
    }

    if (totalCand > 0 && redirectToEscalaId) {
      const target = await Escala.findOne({ _id: redirectToEscalaId, ...tQ(req) }).lean();
      const hoje = getHojeDateString();
      const ymd = escalaDataToYMD(target?.data);
      if (!target) return sendError(res, 400, 'Escala de destino não encontrada.');
      if (target.ativo === false) {
        return sendError(res, 400, 'A escala de destino precisa estar ativa (inscrições abertas).');
      }
      if (!ymd || ymd < hoje) {
        return sendError(res, 400, 'A escala de destino precisa ser futura (data de hoje ou posterior).');
      }
    }

    for (const escalaId of ids) {
      if (totalCand > 0 && redirectToEscalaId) {
        const sources = await Candidatura.find({ escalaId, ...tQ(req) }).select('email').lean();
        for (const c of sources) {
          const em = (c.email || '').toLowerCase().trim();
          const dup = await Candidatura.findOne({
            escalaId: redirectToEscalaId,
            email: em,
            ...tQ(req),
          }).select('_id').lean();
          if (dup) await Candidatura.deleteOne({ _id: c._id, ...tQ(req) });
          else await Candidatura.updateOne({ _id: c._id, ...tQ(req) }, { escalaId: redirectToEscalaId });
        }
      }
      await Escala.findOneAndDelete({ _id: escalaId, ...tQ(req) });
    }

    invalidateCache();
    res.json({ ok: true, deleted: ids.length, redirectedTo: redirectToEscalaId || null });
  } catch (err) {
    console.error('escalas bulk-delete:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao excluir escalas.');
  }
});

// DELETE /api/escalas/:id — exclui escala (admin). Com inscrições: redirectToEscalaId ou forceWithoutRedirect.
app.delete('/api/escalas/:id', requireAuth, resolveTenant, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const redirectToEscalaId = (body.redirectToEscalaId || req.query.redirectTo || '').toString().trim() || null;
    const forceWithoutRedirect = body.forceWithoutRedirect === true
      || req.query.force === '1'
      || req.query.force === 'true';

    if (isPostgres()) {
      const r = await pgDeleteEscala(req.params.id, req.tenantIgrejaId, {
        redirectToEscalaId,
        forceWithoutRedirect,
      });
      if (r.notFound) return sendError(res, 404, 'Escala não encontrada.');
      if (r.error) return sendError(res, 400, r.error);
      if (!r.deleted && r.needRedirect) {
        return res.status(409).json({
          error: `Esta escala tem ${r.candidaturas} candidatura(s). Escolha uma escala futura ativa para redirecionar ou confirme exclusão sem redirecionar.`,
          needRedirect: true,
          candidaturas: r.candidaturas,
        });
      }
      if (!r.deleted) return sendError(res, 404, 'Escala não encontrada.');
      invalidateCache();
      return res.json({
        ok: true,
        moved: r.moved || 0,
        redirectedTo: r.redirectedTo || null,
      });
    }

    const escalaFilter = { _id: req.params.id, ...tQ(req) };
    const escala = await Escala.findOne(escalaFilter).lean();
    if (!escala) return sendError(res, 404, 'Escala não encontrada.');

    const count = await Candidatura.countDocuments({ escalaId: req.params.id, ...tQ(req) });
    if (count > 0 && !redirectToEscalaId && !forceWithoutRedirect) {
      return res.status(409).json({
        error: `Esta escala tem ${count} candidatura(s). Escolha uma escala futura ativa para redirecionar ou confirme exclusão sem redirecionar.`,
        needRedirect: true,
        candidaturas: count,
      });
    }

    if (count > 0 && redirectToEscalaId) {
      const target = await Escala.findOne({ _id: redirectToEscalaId, ...tQ(req) }).lean();
      const hoje = getHojeDateString();
      const ymd = escalaDataToYMD(target?.data);
      if (!target) return sendError(res, 400, 'Escala de destino não encontrada.');
      if (String(target._id) === String(req.params.id)) {
        return sendError(res, 400, 'Escolha uma escala diferente da que será excluída.');
      }
      if (target.ativo === false) {
        return sendError(res, 400, 'A escala de destino precisa estar ativa (inscrições abertas).');
      }
      if (!ymd || ymd < hoje) {
        return sendError(res, 400, 'A escala de destino precisa ser futura (data de hoje ou posterior).');
      }
      const sources = await Candidatura.find({ escalaId: req.params.id, ...tQ(req) }).select('email').lean();
      for (const c of sources) {
        const em = (c.email || '').toLowerCase().trim();
        const dup = await Candidatura.findOne({
          escalaId: redirectToEscalaId,
          email: em,
          ...tQ(req),
        }).select('_id').lean();
        if (dup) {
          await Candidatura.deleteOne({ _id: c._id, ...tQ(req) });
        } else {
          await Candidatura.updateOne({ _id: c._id, ...tQ(req) }, { escalaId: redirectToEscalaId });
        }
      }
    }

    await Escala.findOneAndDelete(escalaFilter);
    invalidateCache();
    res.json({ ok: true, redirectedTo: redirectToEscalaId || null });
  } catch (err) {
    console.error('escalas DELETE:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao excluir escala.');
  }
});

// GET /api/escala-publica/:id — info pública da escala para o form de candidatura. ?ministerio=NOME = link por ministério (só esse ministério pode se inscrever).
app.get('/api/escala-publica/:id', async (req, res) => {
  try {
    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Use ?igreja=slug no link.');
    const id = (req.params.id || '').trim();
    const ministerioParam = (req.query.ministerio || '').toString().trim();
    if (!id) return sendError(res, 400, 'ID da escala inválido.');
    if (isPostgres()) {
      const escala = await pgFindEscalaById(id, igrejaDoc._id);
      if (!escala) return sendError(res, 404, 'Escala não encontrada.');
      const culto = escala.cultoRecorrenteId
        ? await pgFindCultoRecorrente(escala.cultoRecorrenteId, igrejaDoc._id)
        : null;
      if (!isEscalaAbertaParaCandidatura(escala, culto)) {
        const ymd = escalaDataToYMD(escala.data);
        const hoje = getHojeDateString();
        let mensagem = 'Inscrições encerradas para esta escala.';
        if (ymd && ymd <= hoje) mensagem = 'Inscrições encerradas: a data do culto já chegou.';
        else if (culto) mensagem = 'Inscrições abertas apenas para o próximo culto desta recorrência.';
        return res.status(200).json({
          concluida: true,
          mensagem,
          escala: { _id: escala._id, nome: escala.nome, data: escala.data, descricao: escala.descricao },
        });
      }
      const mins = await pgListMinisterios(igrejaDoc._id);
      const ministeriosList = mins.length > 0
        ? mins.filter((m) => m.ativo !== false).map((m) => m.nome).filter(Boolean)
        : MINISTERIOS_PADRAO_PUBLIC;
      let ministerioFixo = null;
      if (ministerioParam) {
        const match = ministeriosList.find((m) => (m || '').trim().toLowerCase() === ministerioParam.toLowerCase());
        if (match) ministerioFixo = match;
        else return sendError(res, 400, 'Ministério inválido para este link. Use o link correto enviado pelo seu líder.');
      }
      // Respeita fechamento por ministério, mesmo com a escala geral ativa.
      if (ministerioFixo) {
        const status = await pgGetEscalaInscricaoStatus(escala._id, ministerioFixo);
        if (!status.ativo) {
          return res.status(200).json({
            concluida: true,
            mensagem: `Inscrições fechadas para o ministério ${ministerioFixo}.`,
            escala: { _id: escala._id, nome: escala.nome, data: escala.data, descricao: escala.descricao },
          });
        }
      }
      return res.json({
        escala: { _id: escala._id, nome: escala.nome, data: escala.data, descricao: escala.descricao },
        ministerios: ministeriosList,
        ...(ministerioFixo && { ministerioFixo }),
      });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, 'ID da escala inválido.');
    }
    const escala = await Escala.findById(id).select('nome data descricao ativo igrejaId').lean();
    if (!escala) return sendError(res, 404, 'Escala não encontrada.');
    if (String(escala.igrejaId) !== String(igrejaDoc._id)) return sendError(res, 404, 'Escala não encontrada.');
    const ymdPub = escalaDataToYMD(escala.data);
    const hojePub = getHojeDateString();
    if (!escala.ativo || !ymdPub || ymdPub <= hojePub) {
      return res.status(200).json({
        concluida: true,
        mensagem: ymdPub && ymdPub <= hojePub
          ? 'Inscrições encerradas: a data do culto já chegou.'
          : 'A escala deste culto já foi concluída.',
        escala: { _id: escala._id, nome: escala.nome, data: escala.data, descricao: escala.descricao },
      });
    }
    const ministerios = await Ministerio.find({ ativo: true, igrejaId: igrejaDoc._id }).sort({ nome: 1 }).select('nome').lean();
    const ministeriosList = ministerios.length > 0 ? ministerios.map(m => m.nome).filter(Boolean) : MINISTERIOS_PADRAO_PUBLIC;
    let ministerioFixo = null;
    if (ministerioParam) {
      const match = ministeriosList.find((m) => (m || '').trim().toLowerCase() === ministerioParam.toLowerCase());
      if (match) ministerioFixo = match;
      else return sendError(res, 400, 'Ministério inválido para este link. Use o link correto enviado pelo seu líder.');
    }

    // Se o link está fixado para um ministério, respeita também o fechamento de inscrições desse ministério
    if (ministerioFixo) {
      const config = await EscalaInscricoesPorMinisterio.findOne({
        escalaId: escala._id,
        ministerio: ministerioFixo,
      }).lean();
      if (config && config.ativo === false) {
        return res.status(200).json({
          concluida: true,
          mensagem: `Inscrições fechadas para o ministério ${ministerioFixo}.`,
          escala: { _id: escala._id, nome: escala.nome, data: escala.data, descricao: escala.descricao },
        });
      }
    }
    res.json({
      escala: { _id: escala._id, nome: escala.nome, data: escala.data, descricao: escala.descricao },
      ministerios: ministeriosList,
      ...(ministerioFixo && { ministerioFixo }),
    });
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// ─── Fechamento de inscrições por ministério (líder) ─────────────────────────────
// Abre/fecha apenas a inscrição de um ministério dentro de uma escala, mesmo com a escala geral ativa.
app.get('/api/escalas/:id/inscricoes-por-ministerio', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const escalaId = (req.params.id || '').trim();
    if (!escalaId) return sendError(res, 400, 'ID da escala inválido.');

    const ministerioParam = (req.query.ministerio || '').toString().trim();
    const ministerioLeaderDefault = isLider ? (req.userMinisterioNome || '').toString().trim() : '';
    const ministerioRequested = ministerioParam || ministerioLeaderDefault;
    if (!ministerioRequested) return sendError(res, 400, 'Informe o ministério.');

    if (isPostgres()) {
      const escala = await pgFindEscalaById(escalaId, req.tenantIgrejaId);
      if (!escala) return sendError(res, 404, 'Escala não encontrada.');
      const mins = await pgListMinisterios(req.tenantIgrejaId);
      const canon = mins.find((m) => m.ativo !== false && (m.nome || '').trim().toLowerCase() === ministerioRequested.toLowerCase());
      if (!canon) return sendError(res, 400, 'Ministério inválido.');
      if (isLider) {
        const allowed = (req.userMinisterioNomes || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean);
        if (!allowed.includes(canon.nome.toLowerCase())) {
          return sendError(res, 403, 'Você só pode alterar inscrições do seu ministério.');
        }
      }
      const status = await pgGetEscalaInscricaoStatus(escalaId, canon.nome);
      return res.json({ escalaId, ministerio: canon.nome, ativo: status.ativo });
    }

    if (!mongoose.Types.ObjectId.isValid(escalaId)) return sendError(res, 400, 'ID da escala inválido.');
    const escalaOk = await Escala.findOne({ _id: escalaId, ...tQ(req) }).select('_id').lean();
    if (!escalaOk) return sendError(res, 404, 'Escala não encontrada.');

    const ministerios = await Ministerio.find({ ativo: true, ...tQ(req) }).sort({ nome: 1 }).select('nome').lean();
    const canon = ministerios.find((m) => (m?.nome || '').trim().toLowerCase() === ministerioRequested.toLowerCase());
    if (!canon) return sendError(res, 400, 'Ministério inválido.');

    if (isLider) {
      const allowed = (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean);
      const allowedCanon = allowed.map((n) => n.toLowerCase());
      if (!allowedCanon.includes(canon.nome.toLowerCase())) {
        return sendError(res, 403, 'Você só pode alterar inscrições do seu ministério.');
      }
    }

    const config = await EscalaInscricoesPorMinisterio.findOne({
      escalaId,
      ministerio: canon.nome,
    }).lean();

    res.json({
      escalaId,
      ministerio: canon.nome,
      ativo: config ? config.ativo !== false : true,
    });
  } catch (err) {
    console.error('inscricoes-por-ministerio GET:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao carregar status.');
  }
});

app.put('/api/escalas/:id/inscricoes-por-ministerio', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const escalaId = (req.params.id || '').trim();
    if (!escalaId) return sendError(res, 400, 'ID da escala inválido.');

    const body = req.body || {};
    const ministerioRequested = (body.ministerio || req.userMinisterioNome || '').toString().trim();
    const ativo = typeof body.ativo === 'boolean' ? body.ativo : undefined;
    if (!ministerioRequested) return sendError(res, 400, 'Informe o ministério.');
    if (ativo === undefined) return sendError(res, 400, 'Informe "ativo" (boolean).');

    if (isPostgres()) {
      const escala = await pgFindEscalaById(escalaId, req.tenantIgrejaId);
      if (!escala) return sendError(res, 404, 'Escala não encontrada.');
      const mins = await pgListMinisterios(req.tenantIgrejaId);
      const canon = mins.find((m) => m.ativo !== false && (m.nome || '').trim().toLowerCase() === ministerioRequested.toLowerCase());
      if (!canon) return sendError(res, 400, 'Ministério inválido.');
      if (isLider) {
        const allowed = (req.userMinisterioNomes || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean);
        if (!allowed.includes(canon.nome.toLowerCase())) {
          return sendError(res, 403, 'Você só pode alterar inscrições do seu ministério.');
        }
      }
      await pgSetEscalaInscricaoStatus(escalaId, canon.nome, ativo, req.userId);
      return res.json({ ok: true, escalaId, ministerio: canon.nome, ativo });
    }

    if (!mongoose.Types.ObjectId.isValid(escalaId)) return sendError(res, 400, 'ID da escala inválido.');
    const escalaOk = await Escala.findOne({ _id: escalaId, ...tQ(req) }).select('_id').lean();
    if (!escalaOk) return sendError(res, 404, 'Escala não encontrada.');

    const ministerios = await Ministerio.find({ ativo: true, ...tQ(req) }).sort({ nome: 1 }).select('nome').lean();
    const canon = ministerios.find((m) => (m?.nome || '').trim().toLowerCase() === ministerioRequested.toLowerCase());
    if (!canon) return sendError(res, 400, 'Ministério inválido.');

    if (isLider) {
      const allowed = (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean);
      const allowedCanon = allowed.map((n) => n.toLowerCase());
      if (!allowedCanon.includes(canon.nome.toLowerCase())) {
        return sendError(res, 403, 'Você só pode alterar inscrições do seu ministério.');
      }
    }

    await EscalaInscricoesPorMinisterio.findOneAndUpdate(
      { escalaId, ministerio: canon.nome },
      { $set: { ativo }, $setOnInsert: { criadoPor: req.userId } },
      { new: true, upsert: true }
    );

    res.json({ ok: true, escalaId, ministerio: canon.nome, ativo });
  } catch (err) {
    console.error('inscricoes-por-ministerio PUT:', err?.message || err);
    sendError(res, 500, err.message || 'Erro ao salvar status.');
  }
});

// POST /api/candidaturas — candidatura pública (sem auth). Quem se candidata é considerado voluntário. Ministério deve estar na lista permitida.
// Query ?igreja=slug ou body.igrejaSlug / tenant (default celeiro-sp).
app.post('/api/candidaturas', candidaturaPublicLimiter, async (req, res) => {
  try {
    const igrejaDoc = await publicIgrejaFromRequest(req);
    if (!igrejaDoc) return sendError(res, 404, 'Igreja não encontrada. Use o parâmetro igreja (slug) no formulário.');
    const { escalaId, nome, email, telefone, ministerio } = req.body || {};
    const em = (email || '').toString().trim().toLowerCase();
    if (!em || !em.includes('@')) return sendError(res, 400, 'Email é obrigatório e deve ser válido.');
    if (!escalaId) return sendError(res, 400, 'Escala é obrigatória.');
    if (!ministerio) return sendError(res, 400, 'Ministério é obrigatório.');
    if (isPostgres()) {
      const escala = await pgFindEscalaById(escalaId, igrejaDoc._id);
      if (!escala) return sendError(res, 404, 'Escala não encontrada.');
      const culto = escala.cultoRecorrenteId
        ? await pgFindCultoRecorrente(escala.cultoRecorrenteId, igrejaDoc._id)
        : null;
      if (!isEscalaAbertaParaCandidatura(escala, culto)) {
        return sendError(res, 403, 'Inscrições encerradas para esta escala ou não é o próximo culto da recorrência.');
      }
      const mins = await pgListMinisterios(igrejaDoc._id);
      const ministeriosList = mins.length > 0
        ? mins.filter((m) => m.ativo !== false).map((m) => m.nome).filter(Boolean)
        : MINISTERIOS_PADRAO_PUBLIC;
      const ministerioTrim = (ministerio || '').toString().trim();
      const ministerioValido = ministeriosList.find((m) => (m || '').trim().toLowerCase() === ministerioTrim.toLowerCase());
      if (!ministerioValido) return sendError(res, 400, 'Ministério inválido.');
      const minStatus = await pgGetEscalaInscricaoStatus(escalaId, ministerioValido);
      if (!minStatus.ativo) {
        return sendError(res, 403, `Inscrições fechadas para o ministério ${ministerioValido}.`);
      }
      const dup = await pgFindCandidaturaDuplicada(igrejaDoc._id, escalaId, em);
      if (dup) {
        try {
          await pgEnsureVoluntarioInList({
            email: em,
            nome: (nome || '').toString().trim(),
            ministerio: ministerioValido,
            igrejaId: igrejaDoc._id,
            fonte: 'cadastro',
            telefone: (telefone || '').toString().trim(),
          });
        } catch (_) {}
        invalidateCache();
        return res.status(200).json({ message: 'Você já se candidatou para esta escala.', candidatura: { _id: dup } });
      }
      const candidatura = await pgCreateCandidatura({
        igrejaId: igrejaDoc._id,
        escalaId,
        nome: (nome || '').toString().trim(),
        email: em,
        telefone: (telefone || '').toString().trim(),
        ministerio: ministerioValido,
      });
      try {
        await pgEnsureVoluntarioInList({
          email: em,
          nome: (nome || '').toString().trim(),
          ministerio: ministerioValido,
          igrejaId: igrejaDoc._id,
          fonte: 'cadastro',
          telefone: (telefone || '').toString().trim(),
        });
      } catch (_) {}
      invalidateCache();
      return res.status(201).json({ message: 'Candidatura enviada!', candidatura });
    }
    const escala = await Escala.findOne({ _id: escalaId, igrejaId: igrejaDoc._id }).lean();
    if (!escala) return sendError(res, 404, 'Escala não encontrada.');
    const hojeCand = getHojeDateString();
    const ymdCand = escalaDataToYMD(escala.data);
    if (!escala.ativo || !ymdCand || ymdCand <= hojeCand) {
      return sendError(res, 403, 'Inscrições encerradas para esta escala.');
    }
    const ministerios = await Ministerio.find({ ativo: true, igrejaId: igrejaDoc._id }).sort({ nome: 1 }).select('nome').lean();
    const ministeriosList = ministerios.length > 0 ? ministerios.map(m => m.nome).filter(Boolean) : MINISTERIOS_PADRAO_PUBLIC;
    const ministerioTrim = (ministerio || '').toString().trim();
    const ministerioValido = ministeriosList.find((m) => (m || '').trim().toLowerCase() === ministerioTrim.toLowerCase());
    if (!ministerioValido) return sendError(res, 400, 'Ministério inválido. Use o link enviado pelo seu líder para o seu ministério.');
    const existing = await Candidatura.findOne({ escalaId, email: em, igrejaId: igrejaDoc._id });
    if (existing) {
      try { await ensureVoluntarioInList({ email: em, nome: (nome || '').toString().trim(), ministerio: (ministerio || '').toString().trim(), igrejaId: igrejaDoc._id, telefone: (telefone || '').toString().trim() }); } catch (_) {}
      invalidateCache();
      return res.status(200).json({ message: 'Você já se candidatou para esta escala.', candidatura: existing });
    }
    const ministerioCanonico = ministerioValido;

    // Respeita fechamento específico do ministério (mesmo se a escala estiver ativa)
    const config = await EscalaInscricoesPorMinisterio.findOne({
      escalaId,
      ministerio: ministerioCanonico,
    }).lean();
    if (config && config.ativo === false) {
      return sendError(res, 403, `Inscrições fechadas para o ministério ${ministerioCanonico}.`);
    }
    const candidatura = await Candidatura.create({
      igrejaId: igrejaDoc._id,
      escalaId,
      nome: (nome || '').toString().trim(),
      email: em,
      telefone: (telefone || '').toString().trim(),
      ministerio: ministerioCanonico,
    });
    // Garante que o candidato apareça na lista de voluntários
    try { await ensureVoluntarioInList({ email: em, nome: (nome || '').toString().trim(), ministerio: ministerioCanonico, igrejaId: igrejaDoc._id, telefone: (telefone || '').toString().trim() }); } catch (_) {}
    invalidateCache();

    // Email de confirmação de recebimento
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && em) {
      try {
        const escalaNome = escala?.nome || 'Escala';
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
        <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">Recebemos o preenchimento da escala <strong>${escalaNome}</strong>. Obrigado por se candidatar!</p>
        <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">Quando o líder do ministério aprovar todos os voluntários, você vai receber um email de confirmação.</p>
        <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">Ministério informado: <strong>${ministerioCanonico || '—'}</strong></p>
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

// GET /api/escalas/:id/acompanhamento — escalados × presentes × faltaram
// Admin: vê todos. Líder: só do(s) ministério(s) dele.
// Estrutura: { escala, totals: { aprovados, presentes, faltaram, pendentes }, itens: [...] }
app.get('/api/escalas/:id/acompanhamento', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');
    const escalaId = req.params.id;
    if (!escalaId || !isValidEntityId(escalaId)) return sendError(res, 400, 'ID inválido.');

    if (!isPostgres()) {
      return sendError(res, 503, 'Acompanhamento disponível apenas em PostgreSQL.');
    }

    const escala = await pgFindEscalaById(escalaId, req.tenantIgrejaId);
    if (!escala) return sendError(res, 404, 'Escala não encontrada.');
    let itens = await pgListAcompanhamentoEscala(req.tenantIgrejaId, escalaId) || [];

    if (isLider) {
      const nomesPg = (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean);
      itens = filterCandidaturasForLider(itens, nomesPg);
    }

    // Decide se evento já encerrou (para distinguir "faltou" de "pendente").
    const evento = escala.eventoCheckinId
      ? await pgFindEventoCheckinById(escala.eventoCheckinId, req.tenantIgrejaId).catch(() => null)
      : null;
    const fim = evento?.fimCheckin ? new Date(evento.fimCheckin).getTime() : null;
    const agora = Date.now();
    const eventoEncerrado = fim ? agora > fim : false;

    let aprovados = 0; let presentes = 0; let faltaram = 0; let pendentes = 0;
    const enriched = itens.map((it) => {
      const aprovado = it.status === 'aprovado';
      let presenca = 'pendente';
      if (it.compareceu) {
        presenca = 'presente';
        if (aprovado) presentes += 1;
      } else if (aprovado && eventoEncerrado) {
        presenca = 'faltou';
        faltaram += 1;
      } else if (aprovado) {
        presenca = 'aguardando';
        pendentes += 1;
      }
      if (aprovado) aprovados += 1;
      return { ...it, presenca };
    });

    return res.json({
      escala: {
        _id: escala._id,
        nome: escala.nome,
        data: escala.data,
        eventoCheckinId: escala.eventoCheckinId || null,
        capacidades: escala.capacidades || {},
        ativo: escala.ativo,
      },
      evento: evento ? {
        _id: evento._id,
        label: evento.label,
        inicioCheckin: evento.inicioCheckin,
        fimCheckin: evento.fimCheckin,
        encerrado: eventoEncerrado,
      } : null,
      totals: { aprovados, presentes, faltaram, pendentes },
      itens: enriched,
    });
  } catch (err) { console.error(err); sendError(res, 500, err.message || 'Erro ao montar acompanhamento.'); }
});

// GET /api/escalas/:id/candidaturas — lista candidaturas de uma escala (com stats de histórico)
// Admin: vê todos. Líder: só candidaturas do(s) ministério(s) que lidera
app.get('/api/escalas/:id/candidaturas', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const escalaId = req.params.id;
    if (!escalaId || !isValidEntityId(escalaId)) {
      return sendError(res, 400, 'ID da escala inválido.');
    }

    if (isPostgres()) {
      const escala = await pgFindEscalaById(escalaId, req.tenantIgrejaId);
      if (!escala) return sendError(res, 404, 'Escala não encontrada.');
      let candidaturas = await pgListCandidaturasByEscala(req.tenantIgrejaId, escalaId);
      const liderMinisterios = isLider
        ? (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean)
        : [];
      if (isLider) candidaturas = filterCandidaturasForLider(candidaturas, liderMinisterios);
      if (!candidaturas.length) return res.json([]);
      const emails = [...new Set(candidaturas.map((c) => (c.email || '').toLowerCase()).filter(Boolean))];
      const { statsMap, checkinsMap } = await pgCandidaturaStatsByEmails(req.tenantIgrejaId, emails);
      const result = enrichCandidaturasForPanel(candidaturas, {
        escala,
        statsMap,
        checkinsMap,
        liderMinisterios,
      });
      return res.json(result);
    }

    const escala = await Escala.findOne({ _id: escalaId, ...tQ(req) }).lean();
    if (!escala) return sendError(res, 404, 'Escala não encontrada.');

    let query = { escalaId, ...tQ(req) };
    if (isLider) {
      const nomes = req.userMinisterioNomes && req.userMinisterioNomes.length
        ? req.userMinisterioNomes.map(String).map(s => s.trim()).filter(Boolean)
        : (req.userMinisterioNome ? [String(req.userMinisterioNome).trim()] : []);
      if (!nomes.length) return res.json([]);
      const partsSet = new Set();
      const orConditions = [
        { ministerio: { $in: nomes } },
        ...nomes.map((n) => ({ ministerio: new RegExp(escapeRegex(n), 'i') })),
      ];
      nomes.forEach((n) => {
        n.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean).forEach((part) => {
          if (part && !partsSet.has(part.toLowerCase())) {
            partsSet.add(part.toLowerCase());
            orConditions.push({ ministerio: new RegExp(`^${escapeRegex(part)}$`, 'i') });
          }
        });
      });
      query = { escalaId, ...tQ(req), $or: orConditions };
    }
    const candidaturas = await Candidatura.find(query).sort({ createdAt: -1 }).lean();
    if (!candidaturas.length) return res.json([]);
    const emails = [...new Set(candidaturas.map(c => c.email).filter(Boolean))];
    const liderMinisterios = isLider ? (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean) : [];

    // Stats históricos de candidaturas por email (lowercase para lookup consistente)
    const statsAgg = await Candidatura.aggregate([
      { $match: { email: { $in: emails }, igrejaId: req.tenantIgrejaId } },
      { $group: { _id: { $toLower: '$email' }, totalParticipacoes: { $sum: { $cond: [{ $eq: ['$status', 'aprovado'] }, 1, 0] } }, totalDesistencias: { $sum: { $cond: [{ $eq: ['$status', 'desistencia'] }, 1, 0] } }, totalFaltas: { $sum: { $cond: [{ $eq: ['$status', 'falta'] }, 1, 0] } } } },
    ]);
    const statsMap = new Map(statsAgg.map(s => [s._id, s]));

    // Check-ins por email (total + ministerios para jaServiuMinLider)
    const checkinsAgg = await Checkin.aggregate([
      { $match: { email: { $in: emails }, igrejaId: req.tenantIgrejaId } },
      { $group: { _id: { $toLower: '$email' }, totalCheckins: { $sum: 1 }, ministerios: { $addToSet: '$ministerio' } } },
    ]);
    const checkinsMap = new Map(checkinsAgg.map(c => [c._id, { total: Number(c.totalCheckins || 0), ministerios: (c.ministerios || []).filter(Boolean) }]));

    const result = candidaturas.map(c => {
      const emailKey = (c.email || '').toLowerCase();
      const stats = statsMap.get(emailKey) || {};
      const ci = checkinsMap.get(emailKey) || { total: 0, ministerios: [] };
      const jaServiuMinLider = liderMinisterios.length > 0 && ci.ministerios.some((m) => liderMinisterios.some((lm) => (m || '').toLowerCase().includes((lm || '').toLowerCase())));
      const totalPart = Number(stats.totalParticipacoes || 0);
      const totalCi = Number(ci.total || 0);
      const totalFaltas = Number(stats.totalFaltas || 0);
      return {
        ...c,
        escalaNome: escala?.nome,
        escalaData: escala?.data != null ? escalaDataToYMD(escala.data) : null,
        escalaId: escala?._id,
        totalCheckins: totalCi,
        totalParticipacoes: totalPart,
        totalDesistencias: Number(stats.totalDesistencias || 0),
        totalFaltas,
        jaServiuAlgum: totalCi + totalPart > 0,
        jaServiuMinLider,
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
app.put('/api/candidaturas/:id/status', requireAuth, resolveTenant, async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const { status } = req.body || {};
    const validStatus = ['pendente', 'aprovado', 'desistencia', 'falta'];
    if (!validStatus.includes(status)) return sendError(res, 400, `Status inválido. Use: ${validStatus.join(', ')}`);

    if (isPostgres()) {
      if (!isValidEntityId(req.params.id)) return sendError(res, 400, 'ID inválido.');
      const candidaturaPg = await pgFindCandidaturaById(req.params.id, req.tenantIgrejaId);
      if (!candidaturaPg) return sendError(res, 404, 'Candidatura não encontrada.');
      if (isLider) {
        const nomesPg = (req.userMinisterioNomes || []).map((n) => String(n).trim()).filter(Boolean);
        if (!filterCandidaturasForLider([candidaturaPg], nomesPg).length) {
          return sendError(res, 403, 'Acesso negado. Esta candidatura não é do seu ministério.');
        }
      }
      // Checagem de capacidade na aprovação (Fase 1 — opcional por ministério).
      if (status === 'aprovado' && candidaturaPg.status !== 'aprovado') {
        const escala = await pgFindEscalaById(candidaturaPg.escalaId, req.tenantIgrejaId);
        const limite = Number(escala?.capacidades?.[candidaturaPg.ministerio] || 0);
        if (limite > 0) {
          const contagem = await pgCountAprovadosByMinisterio(req.tenantIgrejaId, candidaturaPg.escalaId);
          const atuais = contagem[candidaturaPg.ministerio] || 0;
          if (atuais >= limite) {
            return sendError(res, 409, `Capacidade do ministério "${candidaturaPg.ministerio}" atingida (${atuais}/${limite}).`);
          }
        }
      }
      const updatedPg = await pgUpdateCandidaturaStatus(req.params.id, req.tenantIgrejaId, status, { aprovadoPor: req.userId });
      invalidateCache();
      // Email de confirmação ao aprovar (Fase 5: agora com deep-link de check-in).
      if (status === 'aprovado' && !candidaturaPg.emailEnviado && candidaturaPg.email) {
        const apiKey = (process.env.RESEND_API_KEY || '').trim();
        if (apiKey) {
          try {
            const escala = await pgFindEscalaById(candidaturaPg.escalaId, req.tenantIgrejaId);
            const slug = req.tenantIgrejaSlug || DEFAULT_IGREJA_SLUG;
            const base = (process.env.APP_URL || '').replace(/\/$/, '')
              || `${req.protocol}://${req.get('host')}`;
            const appBase = base || 'https://voluntariosceleirosp.com';
            const checkinUrl = escala?.eventoCheckinId
              ? `${appBase}?checkin=${encodeURIComponent(escala.eventoCheckinId)}&igreja=${encodeURIComponent(slug)}`
              : appBase;
            const resend = new Resend(apiKey);
            const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
            const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
            const nomeDisplay = (candidaturaPg.nome || '').trim() || 'voluntário(a)';
            const escalaNome = escala?.nome || 'Escala';
            await resend.emails.send({
              from, to: candidaturaPg.email, reply_to: replyTo,
              subject: `Participação confirmada — ${escalaNome}`,
              html: `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0"><tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <tr><td style="background:#1a1a2e;padding:32px 40px;text-align:center">
      <h1 style="margin:0;font-size:22px;color:#fff">Equipe de Voluntários</h1>
    </td></tr>
    <tr><td style="padding:40px">
      <p style="font-size:16px;color:#374151">Olá, <strong>${nomeDisplay}</strong>!</p>
      <p style="font-size:16px;color:#374151">Sua participação foi <strong>confirmada</strong> na escala <strong>${escalaNome}</strong> (ministério: ${candidaturaPg.ministerio || '—'}).</p>
      <p style="font-size:15px;color:#374151">No dia do culto, você pode confirmar presença direto pelo link:</p>
      <p style="margin:24px 0;text-align:center">
        <a href="${checkinUrl}" style="display:inline-block;background:#f59e0b;color:#1a1a2e;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700">Fazer check-in</a>
      </p>
      <p style="font-size:14px;color:#6b7280">Se preferir, abra a plataforma e vá em "Escalas" para acompanhar.</p>
    </td></tr>
  </table>
</td></tr></table></body></html>`,
            });
            await pgUpdateCandidaturaStatus(req.params.id, req.tenantIgrejaId, status, { aprovadoPor: req.userId, emailEnviado: true });
          } catch (mailErr) {
            console.warn('Falha ao enviar email de aprovação (PG):', mailErr?.message || mailErr);
          }
        }
      }
      return res.json(updatedPg);
    }

    const candidatura = await Candidatura.findOne({ _id: req.params.id, ...tQ(req) }).lean();
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

    const updated = await Candidatura.findOneAndUpdate({ _id: req.params.id, ...tQ(req) }, update, { new: true }).lean();

    // Envia email de confirmação ao aprovar
    if (status === 'aprovado' && !candidatura.emailEnviado && candidatura.email) {
      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey) {
        try {
          const escala = await Escala.findOne({ _id: candidatura.escalaId, ...tQ(req) }).lean();
          const resend = new Resend(apiKey);
          const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
          const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
          const nomeDisplay = (candidatura.nome || '').trim() || 'voluntário(a)';
          const escalaNome = escala?.nome || 'Escala';
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
          if (!error) await Candidatura.updateOne({ _id: candidatura._id, ...tQ(req) }, { emailEnviado: true });
        } catch (_) {}
      }
    }

    res.json(updated);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// GET /api/dashboard/resumo — visão executiva da plataforma (admin/líder)
// Agrega indicadores globais para a tela Resumo: pessoas, check-ins recentes,
// presença média, top ministérios do mês e contadores de formulários.
// Resposta:
// {
//   pessoas: { voluntarios, soCheckin, total },
//   checkins: { ontem, semana, mes, serie7d: [{ymd, total}] },
//   presencaMedia: { taxa, baseEscalas },
//   topMinisterios: [{ nome, total }],
//   formularios: { membros, consolidacao, batismo, apresentacao }
// }
app.get('/api/dashboard/resumo', requireAuth, resolveTenant, async (req, res) => {
  try {
    if (!isPostgres()) {
      return res.json({
        pessoas: { voluntarios: 0, soCheckin: 0, total: 0 },
        checkins: { ontem: 0, semana: 0, mes: 0, serie7d: [] },
        presencaMedia: { taxa: null, baseEscalas: 0 },
        topMinisterios: [],
        formularios: { membros: 0, consolidacao: 0, batismo: 0, apresentacao: 0 },
      });
    }
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return sendError(res, 403, 'Acesso negado.');

    const pool = getPostgresPool();
    const ig = req.tenantIgrejaId;

    // 1) Pessoas: voluntários cadastrados + emails de check-in fora do catálogo
    const [{ rows: vRows }, { rows: scRows }] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM voluntarios WHERE igreja_id = $1 AND ativo = TRUE', [ig]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM (
           SELECT DISTINCT LOWER(ch.email) AS em
           FROM checkins ch
           WHERE ch.igreja_id = $1 AND ch.email IS NOT NULL AND ch.email <> ''
             AND NOT EXISTS (
               SELECT 1 FROM voluntarios v
               WHERE v.igreja_id = ch.igreja_id AND LOWER(v.email) = LOWER(ch.email)
             )
         ) t`,
        [ig],
      ),
    ]);
    const voluntariosN = vRows[0]?.n || 0;
    const soCheckinN = scRows[0]?.n || 0;

    // 2) Check-ins: ontem, semana, mês, série dos últimos 7 dias (Brasília)
    const { rows: ckAggRows } = await pool.query(
      `WITH d AS (
         SELECT (timestamp_ms / 1000) AS ts_sec FROM checkins
         WHERE igreja_id = $1 AND timestamp_ms IS NOT NULL
       )
       SELECT
         COUNT(*) FILTER (WHERE to_timestamp(ts_sec) AT TIME ZONE 'America/Sao_Paulo' >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '1 day')
                          AND to_timestamp(ts_sec) AT TIME ZONE 'America/Sao_Paulo' <  date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')) AS ontem,
         COUNT(*) FILTER (WHERE to_timestamp(ts_sec) AT TIME ZONE 'America/Sao_Paulo' >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '7 days')) AS semana,
         COUNT(*) FILTER (WHERE to_timestamp(ts_sec) AT TIME ZONE 'America/Sao_Paulo' >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')) AS mes
       FROM d`,
      [ig],
    );
    const ckOntem = Number(ckAggRows[0]?.ontem || 0);
    const ckSemana = Number(ckAggRows[0]?.semana || 0);
    const ckMes = Number(ckAggRows[0]?.mes || 0);

    const { rows: serieRows } = await pool.query(
      `WITH dias AS (
         SELECT generate_series(
           (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '6 days')::date,
           date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')::date,
           '1 day'
         )::date AS ymd
       )
       SELECT to_char(d.ymd, 'YYYY-MM-DD') AS ymd,
              COALESCE(COUNT(c.id), 0)::int AS total
       FROM dias d
       LEFT JOIN checkins c
         ON c.igreja_id = $1
        AND c.timestamp_ms IS NOT NULL
        AND (to_timestamp(c.timestamp_ms / 1000) AT TIME ZONE 'America/Sao_Paulo')::date = d.ymd
       GROUP BY d.ymd
       ORDER BY d.ymd ASC`,
      [ig],
    );
    const serie7d = serieRows.map((r) => ({ ymd: r.ymd, total: r.total }));

    // 3) Presença média (últimas 4 escalas encerradas com evento_checkin vinculado)
    const { rows: presencaRows } = await pool.query(
      `WITH ult AS (
         SELECT e.id AS escala_id, ec.id AS evento_id, ec.fim_checkin
         FROM escalas e
         JOIN eventos_checkin ec ON ec.id = (e.dados->>'eventoCheckinId')
         WHERE e.igreja_id = $1 AND ec.fim_checkin IS NOT NULL AND ec.fim_checkin < NOW()
         ORDER BY ec.fim_checkin DESC
         LIMIT 4
       ), agg AS (
         SELECT u.escala_id, u.evento_id,
           (SELECT COUNT(*) FROM candidaturas c WHERE c.escala_id = u.escala_id AND c.igreja_id = $1 AND c.dados->>'status' = 'aprovado') AS aprov,
           (SELECT COUNT(*) FROM candidaturas c
             JOIN checkins ck ON ck.igreja_id = c.igreja_id
              AND ck.evento_id = u.evento_id
              AND LOWER(ck.email) = LOWER(c.dados->>'email')
            WHERE c.escala_id = u.escala_id AND c.igreja_id = $1 AND c.dados->>'status' = 'aprovado') AS pres
         FROM ult u
       )
       SELECT
         COALESCE(SUM(aprov), 0)::int AS aprov,
         COALESCE(SUM(pres), 0)::int AS pres,
         COUNT(*)::int AS base
       FROM agg`,
      [ig],
    );
    const presAprov = Number(presencaRows[0]?.aprov || 0);
    const presPres = Number(presencaRows[0]?.pres || 0);
    const presBase = Number(presencaRows[0]?.base || 0);
    const taxa = presAprov > 0 ? Math.round((presPres / presAprov) * 100) : null;

    // 4) Top ministérios do mês (por check-ins)
    const { rows: topRows } = await pool.query(
      `SELECT COALESCE(NULLIF(ministerio, ''), '—') AS nome, COUNT(*)::int AS total
       FROM checkins
       WHERE igreja_id = $1
         AND timestamp_ms IS NOT NULL
         AND (to_timestamp(timestamp_ms / 1000) AT TIME ZONE 'America/Sao_Paulo') >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
       GROUP BY nome
       ORDER BY total DESC
       LIMIT 5`,
      [ig],
    );
    const topMinisterios = topRows.map((r) => ({ nome: r.nome, total: r.total }));

    // 5) Formulários: contagem do mês
    const monthFilter = `AND created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`;
    const [m1, m2, m3, m4] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM formulario_membro WHERE igreja_id = $1 ${monthFilter}`, [ig]),
      pool.query(`SELECT COUNT(*)::int AS n FROM formulario_consolidacao WHERE igreja_id = $1 ${monthFilter}`, [ig]),
      pool.query(`SELECT COUNT(*)::int AS n FROM formulario_batismo WHERE igreja_id = $1 ${monthFilter}`, [ig]),
      pool.query(`SELECT COUNT(*)::int AS n FROM formulario_apresentacao WHERE igreja_id = $1 ${monthFilter}`, [ig]),
    ]);

    return res.json({
      pessoas: {
        voluntarios: voluntariosN,
        soCheckin: soCheckinN,
        total: voluntariosN + soCheckinN,
      },
      checkins: {
        ontem: ckOntem,
        semana: ckSemana,
        mes: ckMes,
        serie7d,
      },
      presencaMedia: { taxa, baseEscalas: presBase },
      topMinisterios,
      formularios: {
        membros: m1.rows[0]?.n || 0,
        consolidacao: m2.rows[0]?.n || 0,
        batismo: m3.rows[0]?.n || 0,
        apresentacao: m4.rows[0]?.n || 0,
      },
    });
  } catch (err) { console.error(err); sendError(res, 500, err.message || 'Erro ao montar resumo.'); }
});

// GET /api/dashboard/escala-em-destaque — widget do resumo (Fase 5)
// Devolve a "escala em destaque" para admin/líder:
//   - se houver escala futura com check-in aberto agora → mostra ela
//   - senão, próxima escala futura
//   - senão, última escala encerrada
// Em todos os casos: { escala, totals, situacao: 'em-aberto'|'futura'|'passada' }
app.get('/api/dashboard/escala-em-destaque', requireAuth, resolveTenant, async (req, res) => {
  try {
    if (!isPostgres()) return res.json({ escala: null, totals: null, situacao: null });
    const isAdmin = req.userRole === 'admin';
    const isLider = req.userRole === 'lider';
    if (!isAdmin && !isLider) return res.json({ escala: null, totals: null, situacao: null });

    const escalas = await pgListEscalas(req.tenantIgrejaId, {
      ativoOnly: false,
      futureOnly: false,
      nextPerCultoOnly: false,
      limit: 50,
    });
    if (!escalas.length) return res.json({ escala: null, totals: null, situacao: null });

    const agora = Date.now();
    const evtIds = [...new Set(escalas.map((e) => e.eventoCheckinId).filter(Boolean))];
    const evtById = await pgFindEventosCheckinByIds(req.tenantIgrejaId, evtIds);

    // Ordena: 1º com check-in aberto agora (data hoje + janela), 2º próximas futuras, 3º últimas passadas
    const comJanela = escalas
      .map((e) => {
        const evt = e.eventoCheckinId ? evtById.get(e.eventoCheckinId) : null;
        const inicio = evt?.inicioCheckin ? new Date(evt.inicioCheckin).getTime() : null;
        const fim = evt?.fimCheckin ? new Date(evt.fimCheckin).getTime() : null;
        const aberto = !!(evt && evt.ativo && (!inicio || agora >= inicio) && (!fim || agora <= fim));
        const futura = e.data && new Date(e.data).getTime() >= agora - 12 * 3600 * 1000;
        return { escala: e, evt, aberto, futura, ts: e.data ? new Date(e.data).getTime() : 0 };
      });
    let alvo = comJanela.find((x) => x.aberto)
      || comJanela.filter((x) => x.futura).sort((a, b) => a.ts - b.ts)[0]
      || comJanela.filter((x) => !x.futura).sort((a, b) => b.ts - a.ts)[0]
      || null;
    if (!alvo) return res.json({ escala: null, totals: null, situacao: null });

    const itens = await pgListAcompanhamentoEscala(req.tenantIgrejaId, alvo.escala._id) || [];
    let aprovados = 0; let presentes = 0; let faltaram = 0; let pendentes = 0;
    const fim = alvo.evt?.fimCheckin ? new Date(alvo.evt.fimCheckin).getTime() : null;
    const encerrado = fim ? agora > fim : false;
    for (const it of itens) {
      if (it.status === 'aprovado') {
        aprovados += 1;
        if (it.compareceu) presentes += 1;
        else if (encerrado) faltaram += 1;
        else pendentes += 1;
      }
    }
    const situacao = alvo.aberto ? 'em-aberto' : (alvo.futura ? 'futura' : 'passada');
    return res.json({
      escala: {
        _id: alvo.escala._id,
        nome: alvo.escala.nome,
        data: alvo.escala.data,
        eventoCheckinId: alvo.escala.eventoCheckinId,
      },
      evento: alvo.evt ? {
        _id: alvo.evt._id,
        inicioCheckin: alvo.evt.inicioCheckin,
        fimCheckin: alvo.evt.fimCheckin,
      } : null,
      totals: { aprovados, presentes, faltaram, pendentes },
      situacao,
    });
  } catch (err) { console.error(err); sendError(res, 500, err.message || 'Erro no widget.'); }
});

// GET /api/me/cultos — visão unificada do voluntário (Fase 3 da integração)
// Retorna a próxima escala de cada culto recorrente + standalone com status:
//  - aberta-nao-inscrita (sem candidatura)
//  - pendente            (candidatura status=pendente)
//  - aprovada            (aprovada, evento ainda não abriu)
//  - checkin-aberto      (aprovada + evento dentro da janela de check-in)
//  - presente            (já fez check-in)
//  - faltou              (aprovada, evento encerrado, sem check-in)
//  - recusada            (status=desistencia ou falta)
app.get('/api/me/cultos', requireAuth, resolveTenant, async (req, res) => {
  try {
    const email = String(req.userEmail || '').trim().toLowerCase();
    if (!isPostgres()) {
      // Fallback simples para Mongo: usa /minhas-candidaturas como base e devolve
      // estrutura semelhante; UI nova foca em Postgres.
      if (!isMongo() || !email) return res.json({ itens: [] });
      const cands = await Candidatura.find({ email, ...tQ(req) }).sort({ createdAt: -1 }).lean();
      const escalaIds = [...new Set(cands.map((c) => String(c.escalaId)))];
      const escalas = await Escala.find({ _id: { $in: escalaIds }, ...tQ(req) }).lean();
      const escalaMap = new Map(escalas.map((e) => [String(e._id), e]));
      const itens = cands.map((c) => ({
        escalaId: String(c.escalaId),
        escalaNome: escalaMap.get(String(c.escalaId))?.nome || '',
        escalaData: escalaMap.get(String(c.escalaId))?.data || null,
        ministerio: c.ministerio || '',
        candidaturaId: String(c._id),
        candidaturaStatus: c.status || 'pendente',
        eventoCheckinId: null,
        eventoCheckinAberto: false,
        eventoCheckinEncerrado: false,
        compareceu: false,
        situacao: c.status === 'aprovado' ? 'aprovada' : (c.status === 'pendente' ? 'pendente' : 'recusada'),
      }));
      return res.json({ itens });
    }

    // PostgreSQL: lista próximas escalas (1 por culto recorrente), e cruza com:
    //  - candidatura do usuário (se houver)
    //  - evento_checkin vinculado
    //  - check-in já feito no evento
    const escalasAll = await pgListEscalas(req.tenantIgrejaId, {
      ativoOnly: true,
      futureOnly: true,
      nextPerCultoOnly: true,
      limit: 200,
    });
    const escalaIds = escalasAll.map((e) => String(e._id));
    if (!escalaIds.length) return res.json({ itens: [] });

    const candByEscalaId = await pgListMinhasCandidaturasParaEscalas(req.tenantIgrejaId, email, escalaIds);

    const evtIds = [...new Set(escalasAll.map((e) => e.eventoCheckinId).filter(Boolean))];
    const evtById = await pgFindEventosCheckinByIds(req.tenantIgrejaId, evtIds);
    const checkinByEvtId = await pgListMeusCheckins(req.tenantIgrejaId, email, evtIds);

    const agora = Date.now();
    const itens = escalasAll.map((escala) => {
      const cand = candByEscalaId.get(String(escala._id)) || null;
      const evt = escala.eventoCheckinId ? evtById.get(escala.eventoCheckinId) || null : null;
      const checkin = evt ? (checkinByEvtId.get(String(evt._id)) || null) : null;

      const inicio = evt?.inicioCheckin ? new Date(evt.inicioCheckin).getTime() : null;
      const fim = evt?.fimCheckin ? new Date(evt.fimCheckin).getTime() : null;
      const aberto = !!(evt && evt.ativo && (!inicio || agora >= inicio) && (!fim || agora <= fim));
      const encerrado = !!(fim && agora > fim);

      let situacao;
      if (!cand) {
        situacao = 'aberta-nao-inscrita';
      } else if (checkin) {
        situacao = 'presente';
      } else if (cand.status === 'desistencia' || cand.status === 'falta') {
        situacao = 'recusada';
      } else if (cand.status === 'pendente') {
        situacao = 'pendente';
      } else if (cand.status === 'aprovado' && encerrado) {
        situacao = 'faltou';
      } else if (cand.status === 'aprovado' && aberto) {
        situacao = 'checkin-aberto';
      } else {
        situacao = 'aprovada';
      }

      return {
        escalaId: String(escala._id),
        escalaNome: escala.nome || '',
        escalaData: escala.data,
        capacidades: escala.capacidades || {},
        candidaturaId: cand?._id || null,
        candidaturaStatus: cand?.status || null,
        ministerio: cand?.ministerio || null,
        eventoCheckinId: evt?._id || null,
        eventoLabel: evt?.label || null,
        eventoInicio: evt?.inicioCheckin || null,
        eventoFim: evt?.fimCheckin || null,
        eventoCheckinAberto: aberto,
        eventoCheckinEncerrado: encerrado,
        compareceu: !!checkin,
        checkinId: checkin?.id || null,
        situacao,
      };
    });

    res.json({ itens });
  } catch (err) { console.error(err); sendError(res, 500, err.message || 'Erro ao montar cultos do voluntário.'); }
});

// GET /api/minhas-candidaturas — candidaturas do usuário logado
app.get('/api/minhas-candidaturas', requireAuth, resolveTenant, async (req, res) => {
  try {
    const email = (req.userEmail || '').toLowerCase().trim();
    if (!email) return res.json([]);
    if (isPostgres()) {
      const candidaturas = await pgListCandidaturasByEmail(req.tenantIgrejaId, email);
      const escalaIds = [...new Set(candidaturas.map((c) => String(c.escalaId)))];
      const escalas = await pgFindEscalasByIds(req.tenantIgrejaId, escalaIds);
      const escalaMap = new Map(escalas.map((e) => [String(e._id), e]));
      const result = candidaturas.map((c) => ({
        ...c,
        escalaNome: escalaMap.get(String(c.escalaId))?.nome || '',
        escalaData: escalaMap.get(String(c.escalaId))?.data || null,
      }));
      return res.json(result);
    }
    if (!isMongo()) return res.json([]);
    const candidaturas = await Candidatura.find({ email, ...tQ(req) }).sort({ createdAt: -1 }).lean();
    // Enriquece com nome da escala
    const escalaIds = [...new Set(candidaturas.map(c => String(c.escalaId)))];
    const escalas = await Escala.find({ _id: { $in: escalaIds }, ...tQ(req) }).select('nome data').lean();
    const escalaMap = new Map(escalas.map(e => [String(e._id), e]));
    const result = candidaturas.map(c => ({
      ...c,
      escalaNome: escalaMap.get(String(c.escalaId))?.nome || '',
      escalaData: escalaMap.get(String(c.escalaId))?.data || null,
    }));
    res.json(result);
  } catch (err) { console.error(err); sendError(res, 500, err.message); }
});

// HTML inicial: injeta URL absoluta em og:url / og:image (APP_URL ou Host + X-Forwarded-Proto)
const INDEX_HTML_PATH = join(__dirname, '..', 'index.html');
let indexHtmlTemplate = null;
function getIndexHtmlTemplate() {
  if (indexHtmlTemplate == null) {
    indexHtmlTemplate = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  }
  return indexHtmlTemplate;
}
function absolutePublicOrigin(req) {
  const fromEnv = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const host = (req.get('host') || '').trim();
  if (!host) return '';
  const xf = req.get('x-forwarded-proto');
  const proto = (xf && String(xf).split(',')[0].trim()) || (req.secure ? 'https' : (req.protocol || 'http'));
  return `${proto}://${host}`;
}
app.get('/', (req, res, next) => {
  const accept = req.headers.accept || '';
  if (!accept.includes('text/html')) return next();
  try {
    const base = absolutePublicOrigin(req);
    let html = getIndexHtmlTemplate();
    if (base) {
      html = html.replace(/__OG_BASE_URL__/g, base);
    } else {
      html = html.replace(/\n?  <!--OG_META_START-->[\s\S]*?  <!--OG_META_END-->\n?/, '\n');
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('html').send(html);
  } catch (err) {
    console.error('GET / index.html:', err);
    next();
  }
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
  try {
    await initDatabase();
  } catch (err) {
    console.error('❌ Falha ao conectar banco:', err.message || err);
    process.exit(1);
  }

  if (isMongo()) {
    try {
      const indexFix = await ensureUsersTenantEmailIndex();
      if (indexFix.changed) {
        console.log('✅ Índices users ajustados para multi-igreja (email + igrejaId).');
      }
      await fixDataCheckinOnce();
      setImmediate(() => syncLegadoVoluntarios());
    } catch (err) {
      console.error('Pós-conexão MongoDB:', err.message || err);
    }
  } else if (isPostgres()) {
    console.log('ℹ️ Modo PostgreSQL: ministérios, escalas, check-in e cultos recorrentes ativos.');
    startRecurringCultosScheduler();
    // Migração idempotente: vincula escalas existentes ao evento_checkin
    // correspondente na mesma data (Fase 1 da integração escala↔checkin).
    setImmediate(async () => {
      try {
        const n = await pgAutoLinkEscalasOrfas();
        if (n > 0) console.log(`✅ Auto-link escala↔evento_checkin: ${n} escala(s) vinculada(s).`);
        const m = await pgBackfillCheckinCandidaturas();
        if (m > 0) console.log(`✅ Backfill check-in↔candidatura: ${m} check-in(s) vinculado(s).`);
        const f = await pgAutoMarcarFaltas();
        if (f > 0) console.log(`✅ Auto-marca falta: ${f} candidatura(s) marcadas após fim_checkin.`);
        const v = await pgBackfillVoluntariosFromCheckins();
        if (v > 0) console.log(`✅ Backfill voluntarios←checkins: ${v} pessoa(s) adicionada(s) ao catálogo.`);
      } catch (err) {
        console.error('Migração escala↔checkin↔candidatura falhou:', err.message || err);
      }
    });
    // Roda auto-marca-faltas a cada 30 min (evento encerrado sem check-in = falta).
    const AUTO_FALTA_MS = Number(process.env.AUTO_FALTA_INTERVAL_MS) || 30 * 60 * 1000;
    setInterval(async () => {
      try {
        const f = await pgAutoMarcarFaltas();
        if (f > 0) console.log(`⏱️  pgAutoMarcarFaltas: ${f} candidatura(s) marcadas como falta.`);
      } catch (err) {
        console.error('pgAutoMarcarFaltas falhou:', err.message || err);
      }
    }, AUTO_FALTA_MS).unref?.();

    const CHECKIN_ABERTURA_MS = Number(process.env.CHECKIN_ABERTURA_INTERVAL_MS) || 60 * 1000;
    setTimeout(() => {
      runCheckinAberturaEmailJob().catch((err) => {
        console.error('checkin abertura email (boot):', err?.message || err);
      });
    }, 15_000);
    setInterval(async () => {
      try {
        const r = await runCheckinAberturaEmailJob();
        if ((r.sent || 0) > 0) {
          console.log(`⏱️  checkin abertura email: ${r.sent} enviado(s) em ${r.processed} evento(s).`);
        }
      } catch (err) {
        console.error('runCheckinAberturaEmailJob falhou:', err.message || err);
      }
    }, CHECKIN_ABERTURA_MS).unref?.();

    const ESCALA_LEMBRETE_MS = Number(process.env.ESCALA_LEMBRETE_INTERVAL_MS) || 30 * 60 * 1000;
    setTimeout(() => {
      runEscalaLembreteEmailJob().catch((err) => {
        console.error('escala lembrete email (boot):', err?.message || err);
      });
    }, 45_000);
    setInterval(async () => {
      try {
        const r = await runEscalaLembreteEmailJob();
        if ((r.sent || 0) > 0) {
          console.log(`⏱️  escala lembrete ${r.tipo}: ${r.sent} enviado(s) — culto ${r.cultoDataYmd}.`);
        }
      } catch (err) {
        console.error('runEscalaLembreteEmailJob falhou:', err.message || err);
      }
    }, ESCALA_LEMBRETE_MS).unref?.();
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Plataforma Voluntários Celeiro SP — API na porta ${PORT}`);
    console.log('POST /api/login - autenticação admin');
    console.log('GET /api/voluntarios - lista voluntários da planilha');
    console.log('GET /api/checkins - lista check-ins e resumo');
    console.log('POST /api/send-email - envia email via Resend (body: { to: string[], subject, html? })');
    const grokKey = (process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim();
    console.log(grokKey ? '✅ Grok API: configurada (versículo do dia + revisão de email)' : '⚠️ Grok API: não configurada (defina GROK_API_KEY no .env ou nas variáveis da cloud)');
  });
}
start();
