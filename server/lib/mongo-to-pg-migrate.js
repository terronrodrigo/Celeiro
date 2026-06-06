/**
 * Migração MongoDB → PostgreSQL por igreja (slug).
 * Idempotente: upsert por id Mongo (_id.toString()) quando possível.
 */
import { randomUUID } from 'crypto';
import Igreja from '../models/Igreja.js';
import Ministerio from '../models/Ministerio.js';
import User from '../models/User.js';
import Voluntario from '../models/Voluntario.js';
import EventoCheckin from '../models/EventoCheckin.js';
import Checkin from '../models/Checkin.js';
import Escala from '../models/Escala.js';
import Candidatura from '../models/Candidatura.js';
import EscalaInscricoesPorMinisterio from '../models/EscalaInscricoesPorMinisterio.js';
import EventoFormulario from '../models/EventoFormulario.js';
import FormularioMembro from '../models/FormularioMembro.js';
import FormularioConsolidacao from '../models/FormularioConsolidacao.js';
import FormularioBatismo from '../models/FormularioBatismo.js';
import FormularioApresentacao from '../models/FormularioApresentacao.js';
import FormularioNovoMembro from '../models/FormularioNovoMembro.js';
import RoleHistory from '../models/RoleHistory.js';
import { ensureMongoConnection, pingMongo, isPostgres } from '../db/connection.js';
import { getPostgresPool } from '../db/postgres/init.js';
import { pgFindIgrejaBySlug, pgUpsertUserWithPasswordHash } from '../db/postgres/repos.js';
import { escalaDataToYMD } from './brasilia.js';

let migrationRunning = false;

/** @type {null | {
 *   running: boolean, done: boolean, dryRun: boolean,
 *   percent: number, step: number, totalSteps: number, stage: string,
 *   error: string | null, result: object | null,
 * }} */
let migrationProgress = null;

const STEPS_PER_IGREJA = 14;

function resetMigrationProgress(totalSteps, dryRun) {
  migrationProgress = {
    running: true,
    done: false,
    dryRun: !!dryRun,
    percent: 0,
    step: 0,
    totalSteps,
    stage: 'Iniciando…',
    error: null,
    result: null,
  };
}

function tickMigrationProgress(stage) {
  if (!migrationProgress) return;
  migrationProgress.step += 1;
  migrationProgress.stage = stage;
  const ratio = migrationProgress.totalSteps > 0
    ? migrationProgress.step / migrationProgress.totalSteps
    : 0;
  migrationProgress.percent = Math.min(99, Math.round(ratio * 100));
}

function finishMigrationProgress(result) {
  if (!migrationProgress) return;
  migrationProgress.running = false;
  migrationProgress.done = true;
  migrationProgress.percent = 100;
  migrationProgress.stage = result?.message || 'Concluído';
  migrationProgress.result = result;
}

function failMigrationProgress(err) {
  if (!migrationProgress) return;
  migrationProgress.running = false;
  migrationProgress.done = true;
  migrationProgress.error = err?.message || String(err);
  migrationProgress.stage = 'Erro na migração';
}

export function getMigrationProgress() {
  if (!migrationProgress) {
    return {
      running: false,
      done: false,
      percent: 0,
      step: 0,
      totalSteps: 0,
      stage: '',
      error: null,
      result: null,
    };
  }
  return { ...migrationProgress };
}

function oid(v) {
  if (v == null || v === '') return null;
  return String(v._id || v);
}

function dateYmd(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return escalaDataToYMD(d) || d.toISOString().slice(0, 10);
}

function emptyCounts() {
  return { created: 0, updated: 0, skipped: 0 };
}

function inc(counts, kind) {
  counts[kind] = (counts[kind] || 0) + 1;
}

async function buildMinisterioMap(mongoIgrejaId, pgIgrejaId) {
  const mongoMins = await Ministerio.find({ igrejaId: mongoIgrejaId }).lean();
  const { rows: pgMins } = await getPostgresPool().query(
    'SELECT id, nome FROM ministerios WHERE igreja_id = $1',
    [pgIgrejaId],
  );
  const pgByNome = new Map(pgMins.map((m) => [String(m.nome || '').trim().toLowerCase(), m.id]));
  const mongoToPg = new Map();
  for (const mm of mongoMins) {
    const hit = pgByNome.get(String(mm.nome || '').trim().toLowerCase());
    if (hit) mongoToPg.set(String(mm._id), hit);
  }
  return mongoToPg;
}

async function ensurePgIgreja(mongoIgreja, dryRun) {
  let pg = await pgFindIgrejaBySlug(mongoIgreja.slug);
  if (pg) return pg;
  if (dryRun) return { _id: '(novo)', slug: mongoIgreja.slug, nome: mongoIgreja.nome };
  const id = randomUUID();
  await getPostgresPool().query(
    'INSERT INTO igrejas (id, nome, slug, ativo) VALUES ($1, $2, $3, TRUE)',
    [id, mongoIgreja.nome, mongoIgreja.slug],
  );
  return pgFindIgrejaBySlug(mongoIgreja.slug);
}

async function migrateUsers(mongoIgrejaId, pgIgrejaId, minMap, dryRun) {
  const counts = emptyCounts();
  const users = await User.find({ igrejaId: mongoIgrejaId }).select(
    '+senha email nome role ativo ministerioIds mustChangePassword whatsapp fotoUrl',
  );
  for (const u of users) {
    const email = String(u.email || '').trim().toLowerCase();
    if (!email) { inc(counts, 'skipped'); continue; }
    const ministerioIds = (u.ministerioIds || []).map((id) => minMap.get(String(id))).filter(Boolean);
    if (dryRun) {
      inc(counts, 'created');
      continue;
    }
    if (!u.senha) { inc(counts, 'skipped'); continue; }
    const { created } = await pgUpsertUserWithPasswordHash({
      email,
      nome: u.nome,
      senhaHash: u.senha,
      role: u.role || 'voluntario',
      igrejaId: pgIgrejaId,
      ministerioIds,
      mustChangePassword: !!u.mustChangePassword,
      ativo: u.ativo !== false,
    });
    if (u.whatsapp || u.fotoUrl) {
      await getPostgresPool().query(
        'UPDATE users SET whatsapp = COALESCE($3, whatsapp), foto_url = COALESCE($4, foto_url) WHERE igreja_id = $1 AND LOWER(email) = $2',
        [pgIgrejaId, email, u.whatsapp || null, u.fotoUrl || null],
      ).catch(() => {});
    }
    inc(counts, created ? 'created' : 'updated');
  }
  return counts;
}

async function migrateGlobalAdmins(dryRun) {
  const counts = emptyCounts();
  const users = await User.find({
    role: 'admin',
    $or: [{ igrejaId: null }, { igrejaId: { $exists: false } }],
  }).select('+senha email nome ativo mustChangePassword whatsapp fotoUrl');
  for (const u of users) {
    const email = String(u.email || '').trim().toLowerCase();
    if (!email) { inc(counts, 'skipped'); continue; }
    if (dryRun) { inc(counts, 'created'); continue; }
    if (!u.senha) { inc(counts, 'skipped'); continue; }
    const { rows } = await getPostgresPool().query(
      "SELECT id FROM users WHERE LOWER(email) = $1 AND igreja_id IS NULL LIMIT 1",
      [email],
    );
    if (rows.length) {
      await getPostgresPool().query(
        'UPDATE users SET nome = $2, senha = $3, ativo = $4, must_change_password = $5 WHERE id = $1',
        [rows[0].id, u.nome, u.senha, u.ativo !== false, !!u.mustChangePassword],
      );
      inc(counts, 'updated');
    } else {
      await getPostgresPool().query(
        `INSERT INTO users (id, email, nome, senha, role, igreja_id, ministerio_ids, ativo, must_change_password)
         VALUES ($1, $2, $3, $4, 'admin', NULL, '[]', $5, $6)`,
        [randomUUID(), email, u.nome, u.senha, u.ativo !== false, !!u.mustChangePassword],
      );
      inc(counts, 'created');
    }
  }
  return counts;
}

async function migrateVoluntarios(mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const list = await Voluntario.find({ igrejaId: mongoIgrejaId }).lean();
  for (const v of list) {
    const email = String(v.email || '').trim().toLowerCase();
    if (!email) { inc(counts, 'skipped'); continue; }
    const ministerios = Array.isArray(v.ministerios) && v.ministerios.length
      ? v.ministerios
      : String(v.ministerio || '').split(',').map((s) => s.trim()).filter(Boolean);
    const dados = {
      nome: v.nome || '',
      nascimento: v.nascimento || null,
      whatsapp: v.whatsapp || v.telefone || '',
      pais: v.pais || '',
      estado: v.estado || '',
      cidade: v.cidade || '',
      evangelico: v.evangelico || '',
      igreja: v.igreja || '',
      tempoIgreja: v.tempoIgreja || '',
      voluntarioIgreja: v.voluntarioIgreja || '',
      ministerios,
      ministerio: ministerios.join(', '),
      disponibilidade: v.disponibilidade || '',
      horasSemana: v.horasSemana || '',
      areas: v.areas || [],
      testemunho: v.testemunho || '',
      batizado: v.batizado,
      perfilCheckinCompletoAt: v.perfilCheckinCompletoAt || null,
      perfilCheckinSkip: !!v.perfilCheckinSkip,
      perfilCheckinSkipAt: v.perfilCheckinSkipAt || null,
    };
    if (dryRun) { inc(counts, 'created'); continue; }
    const id = oid(v._id);
    const { rows: existing } = await getPostgresPool().query(
      'SELECT id FROM voluntarios WHERE igreja_id = $1 AND LOWER(email) = $2 LIMIT 1',
      [pgIgrejaId, email],
    );
    if (existing.length) {
      await getPostgresPool().query(
        `UPDATE voluntarios SET nome = $3, dados = $4::jsonb, ativo = $5, fonte = $6, updated_at = NOW()
         WHERE id = $1 AND igreja_id = $2`,
        [existing[0].id, pgIgrejaId, dados.nome || email, JSON.stringify(dados), v.ativo !== false, v.fonte || 'planilha'],
      );
      inc(counts, 'updated');
    } else {
      await getPostgresPool().query(
        `INSERT INTO voluntarios (id, igreja_id, email, nome, dados, ativo, fonte, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, COALESCE($8, NOW()), NOW())`,
        [id, pgIgrejaId, email, dados.nome || email, JSON.stringify(dados), v.ativo !== false, v.fonte || 'planilha', v.createdAt || null],
      );
      inc(counts, 'created');
    }
  }
  return counts;
}

async function migrateEventosCheckin(mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const list = await EventoCheckin.find({ igrejaId: mongoIgrejaId }).lean();
  for (const e of list) {
    const ymd = dateYmd(e.data);
    if (!ymd) { inc(counts, 'skipped'); continue; }
    if (dryRun) { inc(counts, 'created'); continue; }
    const id = oid(e._id);
    const { rowCount } = await getPostgresPool().query(
      `INSERT INTO eventos_checkin (
         id, igreja_id, data, label, ativo, horario_inicio, horario_fim, criado_por, created_at
       ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, COALESCE($9, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data, label = EXCLUDED.label, ativo = EXCLUDED.ativo,
         horario_inicio = EXCLUDED.horario_inicio, horario_fim = EXCLUDED.horario_fim,
         criado_por = EXCLUDED.criado_por`,
      [
        id, pgIgrejaId, ymd, e.label || '', e.ativo !== false,
        e.horarioInicio || '', e.horarioFim || '', oid(e.criadoPor), e.createdAt || null,
      ],
    );
    inc(counts, rowCount === 1 ? 'created' : 'updated');
  }
  return counts;
}

async function migrateEscalas(mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const list = await Escala.find({ igrejaId: mongoIgrejaId }).lean();
  for (const e of list) {
    if (dryRun) { inc(counts, 'created'); continue; }
    const id = oid(e._id);
    const dataIso = e.data ? new Date(e.data).toISOString() : null;
    const dados = {
      nome: e.nome || '',
      data: dataIso,
      descricao: e.descricao || '',
      ativo: e.ativo !== false,
      criadoPor: oid(e.criadoPor),
      cultoRecorrenteId: null,
      autoGerada: false,
      eventoCheckinId: null,
      capacidades: {},
      updatedAt: (e.updatedAt || e.createdAt || new Date()).toISOString(),
    };
    const { rowCount } = await getPostgresPool().query(
      `INSERT INTO escalas (id, igreja_id, dados, created_at)
       VALUES ($1, $2, $3::jsonb, COALESCE($4, NOW()))
       ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados`,
      [id, pgIgrejaId, JSON.stringify(dados), e.createdAt || null],
    );
    inc(counts, rowCount === 1 ? 'created' : 'updated');
  }
  return counts;
}

async function migrateEscalaInscricoes(mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const escalaIds = (await Escala.find({ igrejaId: mongoIgrejaId }).select('_id').lean()).map((e) => e._id);
  if (!escalaIds.length) return counts;
  const list = await EscalaInscricoesPorMinisterio.find({ escalaId: { $in: escalaIds } }).lean();
  for (const row of list) {
    const escalaId = oid(row.escalaId);
    const ministerio = String(row.ministerio || '').trim();
    if (!escalaId || !ministerio) { inc(counts, 'skipped'); continue; }
    if (dryRun) { inc(counts, 'created'); continue; }
    await getPostgresPool().query(
      `INSERT INTO escala_inscricoes_por_ministerio (escala_id, ministerio, ativo, criado_por, created_at, updated_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), NOW())
       ON CONFLICT (escala_id, ministerio) DO UPDATE SET ativo = EXCLUDED.ativo, updated_at = NOW()`,
      [escalaId, ministerio, row.ativo !== false, oid(row.criadoPor), row.createdAt || null],
    );
    inc(counts, 'updated');
  }
  return counts;
}

async function migrateCandidaturas(mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const list = await Candidatura.find({ igrejaId: mongoIgrejaId }).lean();
  for (const c of list) {
    const escalaId = oid(c.escalaId);
    if (!escalaId) { inc(counts, 'skipped'); continue; }
    if (dryRun) { inc(counts, 'created'); continue; }
    const id = oid(c._id);
    const dados = {
      nome: c.nome || '',
      email: String(c.email || '').trim().toLowerCase(),
      telefone: c.telefone || '',
      ministerio: c.ministerio || '',
      status: c.status || 'pendente',
      aprovadoPor: oid(c.aprovadoPor),
      aprovadoEm: c.aprovadoEm ? new Date(c.aprovadoEm).toISOString() : null,
      emailEnviado: !!c.emailEnviado,
    };
    await getPostgresPool().query(
      `INSERT INTO candidaturas (id, igreja_id, escala_id, dados, created_at)
       VALUES ($1, $2, $3, $4::jsonb, COALESCE($5, NOW()))
       ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, escala_id = EXCLUDED.escala_id`,
      [id, pgIgrejaId, escalaId, JSON.stringify(dados), c.createdAt || null],
    );
    inc(counts, 'updated');
  }
  return counts;
}

async function migrateCheckins(mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const list = await Checkin.find({ igrejaId: mongoIgrejaId }).lean();
  for (const c of list) {
    const email = String(c.email || '').trim().toLowerCase();
    if (!email) { inc(counts, 'skipped'); continue; }
    if (dryRun) { inc(counts, 'created'); continue; }
    const id = oid(c._id);
    const batizado = c.batizado === true ? 'sim' : c.batizado === false ? 'nao' : null;
    await getPostgresPool().query(
      `INSERT INTO checkins (
         id, igreja_id, evento_id, email, nome, ministerio, batizado,
         data_checkin, timestamp_ms, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         evento_id = EXCLUDED.evento_id, nome = EXCLUDED.nome, ministerio = EXCLUDED.ministerio,
         batizado = EXCLUDED.batizado, data_checkin = EXCLUDED.data_checkin, timestamp_ms = EXCLUDED.timestamp_ms`,
      [
        id, pgIgrejaId, oid(c.eventoId), email, c.nome || '', c.ministerio || '', batizado,
        c.dataCheckin || c.timestamp || null, c.timestampMs || null, c.createdAt || null,
      ],
    );
    inc(counts, 'updated');
  }
  return counts;
}

async function migrateEventosFormulario(mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const list = await EventoFormulario.find({ igrejaId: mongoIgrejaId }).lean();
  for (const e of list) {
    const ymd = dateYmd(e.data);
    if (!ymd || !e.tipo) { inc(counts, 'skipped'); continue; }
    if (dryRun) { inc(counts, 'created'); continue; }
    const id = oid(e._id);
    await getPostgresPool().query(
      `INSERT INTO eventos_formulario (id, igreja_id, tipo, data, label, ativo, horario_inicio, horario_fim, criado_por, created_at)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, COALESCE($10, NOW()))
       ON CONFLICT (id) DO UPDATE SET
         tipo = EXCLUDED.tipo, data = EXCLUDED.data, label = EXCLUDED.label, ativo = EXCLUDED.ativo,
         horario_inicio = EXCLUDED.horario_inicio, horario_fim = EXCLUDED.horario_fim`,
      [
        id, pgIgrejaId, e.tipo, ymd, e.label || '', e.ativo !== false,
        e.horarioInicio || '', e.horarioFim || '', oid(e.criadoPor), e.createdAt || null,
      ],
    );
    inc(counts, 'updated');
  }
  return counts;
}

async function migrateFormularioMembro(mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const list = await FormularioMembro.find({ igrejaId: mongoIgrejaId }).lean();
  for (const f of list) {
    if (dryRun) { inc(counts, 'created'); continue; }
    const dados = {
      nomeCompleto: f.nomeCompleto || '',
      dataNascimento: f.dataNascimento || null,
      email: String(f.email || '').trim().toLowerCase(),
      enderecoCompleto: f.enderecoCompleto || '',
      telefoneWhatsapp: f.telefoneWhatsapp || '',
      batizado: f.batizado || '',
      voluntario: f.voluntario || '',
      grupoOracao: f.grupoOracao || '',
      querMembroCeleiro: f.querMembroCeleiro || '',
      compromissoRespeitar: f.compromissoRespeitar || '',
      testemunho: f.testemunho || '',
    };
    await getPostgresPool().query(
      `INSERT INTO formulario_membro (id, igreja_id, dados, created_at)
       VALUES ($1, $2, $3::jsonb, COALESCE($4, NOW()))
       ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados`,
      [oid(f._id), pgIgrejaId, JSON.stringify(dados), f.createdAt || null],
    );
    inc(counts, 'updated');
  }
  return counts;
}

async function migrateFormularioConsolidacao(mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const list = await FormularioConsolidacao.find({ igrejaId: mongoIgrejaId }).lean();
  for (const f of list) {
    if (dryRun) { inc(counts, 'created'); continue; }
    const { _id, igrejaId, createdAt, updatedAt, __v, ...rest } = f;
    await getPostgresPool().query(
      `INSERT INTO formulario_consolidacao (id, igreja_id, dados, created_at)
       VALUES ($1, $2, $3::jsonb, COALESCE($4, NOW()))
       ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados`,
      [oid(_id), pgIgrejaId, JSON.stringify(rest), createdAt || null],
    );
    inc(counts, 'updated');
  }
  return counts;
}

async function migrateFormularioPorEvento(Model, table, mongoIgrejaId, pgIgrejaId, dryRun) {
  const counts = emptyCounts();
  const list = await Model.find({ igrejaId: mongoIgrejaId }).lean();
  for (const f of list) {
    const eventoId = oid(f.eventoId);
    if (!eventoId) { inc(counts, 'skipped'); continue; }
    if (dryRun) { inc(counts, 'created'); continue; }
    const { _id, igrejaId, eventoId: _e, createdAt, updatedAt, __v, ...rest } = f;
    await getPostgresPool().query(
      `INSERT INTO ${table} (id, igreja_id, evento_id, dados, created_at)
       VALUES ($1, $2, $3, $4::jsonb, COALESCE($5, NOW()))
       ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, evento_id = EXCLUDED.evento_id`,
      [oid(_id), pgIgrejaId, eventoId, JSON.stringify(rest), createdAt || null],
    );
    inc(counts, 'updated');
  }
  return counts;
}

async function migrateRoleHistory(mongoIgrejaId, pgIgrejaId, minMap, dryRun) {
  const counts = emptyCounts();
  const list = await RoleHistory.find({ igrejaId: mongoIgrejaId }).lean();
  for (const h of list) {
    if (dryRun) { inc(counts, 'created'); continue; }
    const dados = {
      fromRole: h.fromRole || '',
      toRole: h.toRole || '',
      ministerioId: minMap.get(String(h.ministerioId)) || oid(h.ministerioId),
      changedBy: oid(h.changedBy),
    };
    await getPostgresPool().query(
      `INSERT INTO role_history (id, igreja_id, user_id, dados, created_at)
       VALUES ($1, $2, $3, $4::jsonb, COALESCE($5, NOW()))
       ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados`,
      [oid(h._id), pgIgrejaId, oid(h.userId), JSON.stringify(dados), h.createdAt || null],
    );
    inc(counts, 'updated');
  }
  return counts;
}

async function migrateOneIgreja(slug, dryRun, tick) {
  const mongoIgreja = await Igreja.findOne({ slug: slug.toLowerCase() }).lean();
  if (!mongoIgreja) {
    return { slug, error: `Igreja não encontrada no MongoDB: ${slug}` };
  }
  const pgIgreja = await ensurePgIgreja(mongoIgreja, dryRun);
  const pgIgrejaId = pgIgreja._id;
  const minMap = await buildMinisterioMap(mongoIgreja._id, pgIgrejaId);
  const mid = mongoIgreja._id;

  const steps = [
    ['users', 'usuários', () => migrateUsers(mid, pgIgrejaId, minMap, dryRun)],
    ['voluntarios', 'voluntários', () => migrateVoluntarios(mid, pgIgrejaId, dryRun)],
    ['eventosCheckin', 'eventos de check-in', () => migrateEventosCheckin(mid, pgIgrejaId, dryRun)],
    ['escalas', 'escalas', () => migrateEscalas(mid, pgIgrejaId, dryRun)],
    ['escalaInscricoes', 'inscrições por ministério', () => migrateEscalaInscricoes(mid, pgIgrejaId, dryRun)],
    ['candidaturas', 'candidaturas', () => migrateCandidaturas(mid, pgIgrejaId, dryRun)],
    ['checkins', 'check-ins', () => migrateCheckins(mid, pgIgrejaId, dryRun)],
    ['eventosFormulario', 'eventos de formulário', () => migrateEventosFormulario(mid, pgIgrejaId, dryRun)],
    ['formularioMembro', 'formulários membro', () => migrateFormularioMembro(mid, pgIgrejaId, dryRun)],
    ['formularioConsolidacao', 'formulários consolidação', () => migrateFormularioConsolidacao(mid, pgIgrejaId, dryRun)],
    ['formularioBatismo', 'formulários batismo', () => migrateFormularioPorEvento(FormularioBatismo, 'formulario_batismo', mid, pgIgrejaId, dryRun)],
    ['formularioApresentacao', 'formulários apresentação', () => migrateFormularioPorEvento(FormularioApresentacao, 'formulario_apresentacao', mid, pgIgrejaId, dryRun)],
    ['formularioNovoMembro', 'formulários novo membro', () => migrateFormularioPorEvento(FormularioNovoMembro, 'formulario_novo_membro', mid, pgIgrejaId, dryRun)],
    ['roleHistory', 'histórico de perfis', () => migrateRoleHistory(mid, pgIgrejaId, minMap, dryRun)],
  ];

  const result = { slug, pgIgrejaId, dryRun };
  for (const [key, label, fn] of steps) {
    if (tick) tick(`${slug}: ${label}`);
    result[key] = await fn();
  }
  return result;
}

export function isMigrationRunning() {
  return migrationRunning;
}

const PREFLIGHT_TTL_MS = 30 * 60 * 1000;

/** @type {null | { token: string, allIgrejas: boolean, igrejaSlug: string, expiresAt: number }} */
let lastPreflight = null;

function resolveMigrationSlugs(opts) {
  if (opts.allIgrejas) {
    return Igreja.find({ ativo: { $ne: false } }).select('slug nome').lean().then((list) =>
      list.map((g) => ({ slug: String(g.slug || '').toLowerCase(), nome: g.nome || g.slug })).filter((g) => g.slug),
    );
  }
  const slug = String(opts.igrejaSlug || 'celeiro-sp').trim().toLowerCase();
  return Igreja.findOne({ slug }).select('slug nome').lean().then((g) => {
    if (!g) return [{ slug, nome: slug, missingInMongo: true }];
    return [{ slug: g.slug, nome: g.nome || g.slug, mongoDoc: g }];
  });
}

async function countEscalaInscricoes(mongoIgrejaId) {
  const escalaIds = (await Escala.find({ igrejaId: mongoIgrejaId }).select('_id').lean()).map((e) => e._id);
  if (!escalaIds.length) return 0;
  return EscalaInscricoesPorMinisterio.countDocuments({ escalaId: { $in: escalaIds } });
}

async function preflightOneIgreja(mongoIgreja) {
  const mid = mongoIgreja._id;
  const pgIgreja = await pgFindIgrejaBySlug(mongoIgreja.slug);
  const warnings = [];

  if (!pgIgreja) {
    warnings.push(`Igreja "${mongoIgreja.slug}" existe no Mongo mas ainda não no PostgreSQL (será criada na migração).`);
  }

  const counts = {
    users: await User.countDocuments({ igrejaId: mid }),
    voluntarios: await Voluntario.countDocuments({ igrejaId: mid }),
    eventosCheckin: await EventoCheckin.countDocuments({ igrejaId: mid }),
    checkins: await Checkin.countDocuments({ igrejaId: mid }),
    escalas: await Escala.countDocuments({ igrejaId: mid }),
    candidaturas: await Candidatura.countDocuments({ igrejaId: mid }),
    escalaInscricoes: await countEscalaInscricoes(mid),
    eventosFormulario: await EventoFormulario.countDocuments({ igrejaId: mid }),
    formularioMembro: await FormularioMembro.countDocuments({ igrejaId: mid }),
    formularioConsolidacao: await FormularioConsolidacao.countDocuments({ igrejaId: mid }),
    formularioBatismo: await FormularioBatismo.countDocuments({ igrejaId: mid }),
    formularioApresentacao: await FormularioApresentacao.countDocuments({ igrejaId: mid }),
    formularioNovoMembro: await FormularioNovoMembro.countDocuments({ igrejaId: mid }),
    roleHistory: await RoleHistory.countDocuments({ igrejaId: mid }),
    ministerios: await Ministerio.countDocuments({ igrejaId: mid }),
  };

  const totalRecords = Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
  if (totalRecords === 0) {
    warnings.push('Nenhum registro encontrado para esta igreja no MongoDB.');
  }

  const sampleUser = await User.findOne({ igrejaId: mid }).select('email nome role').lean();
  const sampleVoluntario = await Voluntario.findOne({ igrejaId: mid }).select('email nome').lean();
  const sampleCheckin = await Checkin.findOne({ igrejaId: mid }).select('email ministerio dataCheckin').lean();

  let readOk = true;
  let readError = null;
  try {
    await User.findOne({ igrejaId: mid }).select('_id').lean();
    await Voluntario.findOne({ igrejaId: mid }).select('_id').lean();
    await Checkin.findOne({ igrejaId: mid }).select('_id').lean();
  } catch (err) {
    readOk = false;
    readError = err.message || String(err);
  }

  return {
    slug: mongoIgreja.slug,
    nome: mongoIgreja.nome,
    postgresReady: !!pgIgreja,
    pgIgrejaId: pgIgreja?._id || null,
    counts,
    totalRecords,
    readOk,
    readError,
    samples: {
      user: sampleUser ? { email: sampleUser.email, nome: sampleUser.nome, role: sampleUser.role } : null,
      voluntario: sampleVoluntario ? { email: sampleVoluntario.email, nome: sampleVoluntario.nome } : null,
      checkin: sampleCheckin
        ? { email: sampleCheckin.email, ministerio: sampleCheckin.ministerio, data: sampleCheckin.dataCheckin }
        : null,
    },
    warnings,
  };
}

export function validateMigrationPreflight(token, opts) {
  if (!token || !lastPreflight) {
    return 'Execute o teste de acesso aos dados antes de continuar a migração.';
  }
  if (lastPreflight.token !== token) {
    return 'Token de teste inválido. Execute o teste novamente.';
  }
  if (Date.now() > lastPreflight.expiresAt) {
    return 'Teste expirado (30 min). Execute o teste novamente.';
  }
  const slug = String(opts.igrejaSlug || 'celeiro-sp').trim().toLowerCase();
  if (!!lastPreflight.allIgrejas !== !!opts.allIgrejas) {
    return 'A opção de igrejas mudou. Execute o teste novamente.';
  }
  if (!opts.allIgrejas && lastPreflight.igrejaSlug !== slug) {
    return 'A igreja selecionada mudou. Execute o teste novamente.';
  }
  return null;
}

export function clearMigrationPreflight() {
  lastPreflight = null;
}

/**
 * Teste de leitura Mongo + Postgres antes da migração (sem gravar nada).
 * @param {{ igrejaSlug?: string, allIgrejas?: boolean }} opts
 */
export async function runMongoMigrationPreflight(opts = {}) {
  if (!isPostgres()) {
    throw new Error('PostgreSQL não está disponível.');
  }
  if (migrationRunning) {
    throw new Error('Aguarde a migração em andamento terminar antes de testar.');
  }

  const startedAt = Date.now();
  await pingMongo();
  const mongoPingMs = Date.now() - startedAt;

  const pool = getPostgresPool();
  if (!pool) {
    throw new Error('PostgreSQL não está disponível (pool nulo).');
  }
  let postgresPingMs = null;
  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    postgresPingMs = Date.now() - t0;
  } catch (err) {
    throw new Error(`PostgreSQL indisponível: ${err.message || err}`);
  }

  const { rows: pgIgrejaRows } = await pool.query('SELECT COUNT(*)::int AS c FROM igrejas WHERE ativo = TRUE');
  const slugEntries = await resolveMigrationSlugs(opts);
  if (!slugEntries.length) {
    throw new Error('Nenhuma igreja encontrada no MongoDB para testar.');
  }

  const igrejas = [];
  const errors = [];

  for (const entry of slugEntries) {
    if (entry.missingInMongo) {
      errors.push(`Igreja "${entry.slug}" não encontrada no MongoDB.`);
      igrejas.push({ slug: entry.slug, error: 'Igreja não encontrada no MongoDB', ok: false });
      continue;
    }
    const mongoIgreja = entry.mongoDoc || await Igreja.findOne({ slug: entry.slug }).lean();
    if (!mongoIgreja) {
      errors.push(`Igreja "${entry.slug}" não encontrada no MongoDB.`);
      igrejas.push({ slug: entry.slug, error: 'Igreja não encontrada no MongoDB', ok: false });
      continue;
    }
    try {
      const report = await preflightOneIgreja(mongoIgreja);
      igrejas.push({ ...report, ok: report.readOk !== false });
    } catch (err) {
      errors.push(`${entry.slug}: ${err.message || err}`);
      igrejas.push({ slug: entry.slug, ok: false, error: err.message || String(err) });
    }
  }

  const globalAdmins = await User.countDocuments({
    role: 'admin',
    $or: [{ igrejaId: null }, { igrejaId: { $exists: false } }],
  });

  const grandTotal = igrejas.reduce((sum, g) => sum + (g.totalRecords || 0), 0) + globalAdmins;
  const allOk = errors.length === 0 && igrejas.every((g) => g.ok !== false);

  const allIgrejas = !!opts.allIgrejas;
  const igrejaSlug = allIgrejas
    ? '*'
    : String(opts.igrejaSlug || 'celeiro-sp').trim().toLowerCase();

  let preflightToken = null;
  if (allOk && grandTotal > 0) {
    preflightToken = randomUUID();
    lastPreflight = {
      token: preflightToken,
      allIgrejas,
      igrejaSlug: allIgrejas ? '*' : igrejaSlug,
      expiresAt: Date.now() + PREFLIGHT_TTL_MS,
    };
  } else {
    lastPreflight = null;
  }

  return {
    ok: allOk,
    ready: allOk && grandTotal > 0,
    preflightToken,
    preflightExpiresInSec: preflightToken ? Math.floor(PREFLIGHT_TTL_MS / 1000) : 0,
    allIgrejas,
    igrejaSlug: allIgrejas ? null : igrejaSlug,
    mongoPingMs,
    postgresPingMs,
    postgresIgrejasAtivas: pgIgrejaRows[0]?.c ?? 0,
    igrejas,
    globalAdmins,
    grandTotal,
    errors,
    elapsedMs: Date.now() - startedAt,
    message: !allOk
      ? 'Teste falhou. Corrija os erros antes de migrar.'
      : grandTotal === 0
        ? 'Conexão OK, mas nenhum dado encontrado no MongoDB.'
        : 'Acesso aos dados verificado. Você pode continuar a migração.',
  };
}

export async function getMongoMigrationStatus() {
  const hasUri = !!(process.env.MONGODB_URI || '').trim();
  const pgReady = isPostgres();
  let mongoOk = false;
  let mongoError = null;
  if (hasUri) {
    try {
      await pingMongo();
      mongoOk = true;
    } catch (err) {
      mongoError = err.message || String(err);
    }
  }
  return {
    mongodbUriConfigured: hasUri,
    postgresReady: pgReady,
    mongoConnected: mongoOk,
    mongoError,
    migrationRunning,
    progress: getMigrationProgress(),
  };
}

/**
 * @param {{ igrejaSlug?: string, allIgrejas?: boolean, dryRun?: boolean }} opts
 */
export async function runMongoToPgMigration(opts = {}) {
  if (!isPostgres()) {
    throw new Error('PostgreSQL não está disponível.');
  }
  if (migrationRunning) {
    throw new Error('Já existe uma migração em andamento.');
  }
  const preflightErr = validateMigrationPreflight(opts.preflightToken, opts);
  if (preflightErr) {
    throw new Error(preflightErr);
  }
  migrationRunning = true;
  const dryRun = !!opts.dryRun;
  try {
    await pingMongo();

    let slugs = [];
    if (opts.allIgrejas) {
      const igrejas = await Igreja.find({ ativo: { $ne: false } }).select('slug').lean();
      slugs = igrejas.map((g) => String(g.slug || '').toLowerCase()).filter(Boolean);
    } else {
      slugs = [String(opts.igrejaSlug || 'celeiro-sp').trim().toLowerCase()];
    }
    if (!slugs.length) throw new Error('Nenhuma igreja para migrar.');

    resetMigrationProgress(2 + slugs.length * STEPS_PER_IGREJA + 1, dryRun);
    tickMigrationProgress('Conectando ao MongoDB…');

    tickMigrationProgress('Preparando schema PostgreSQL…');
    await getPostgresPool().query(`
      ALTER TABLE eventos_checkin ADD COLUMN IF NOT EXISTS horario_inicio TEXT DEFAULT '';
      ALTER TABLE eventos_checkin ADD COLUMN IF NOT EXISTS horario_fim TEXT DEFAULT '';
      ALTER TABLE eventos_checkin ADD COLUMN IF NOT EXISTS criado_por TEXT;
      ALTER TABLE eventos_formulario ADD COLUMN IF NOT EXISTS horario_inicio TEXT;
      ALTER TABLE eventos_formulario ADD COLUMN IF NOT EXISTS horario_fim TEXT;
      ALTER TABLE eventos_formulario ADD COLUMN IF NOT EXISTS criado_por TEXT;
    `).catch(() => {});

    const igrejas = [];
    for (const slug of slugs) {
      igrejas.push(await migrateOneIgreja(slug, dryRun, tickMigrationProgress));
    }
    tickMigrationProgress('Admins globais');
    const globalAdmins = await migrateGlobalAdmins(dryRun);

    const result = {
      ok: true,
      dryRun,
      igrejas,
      globalAdmins,
      message: dryRun
        ? 'Simulação concluída (nenhum dado gravado).'
        : 'Migração MongoDB → PostgreSQL concluída.',
    };
    finishMigrationProgress(result);
    clearMigrationPreflight();
    return result;
  } catch (err) {
    failMigrationProgress(err);
    throw err;
  } finally {
    migrationRunning = false;
  }
}
