/**
 * Dados operacionais em PostgreSQL: voluntários, check-ins, candidaturas (gestão).
 */
import { randomUUID } from 'crypto';
import { getPostgresPool } from './init.js';
import { escalaDataToYMD, getDayRangeBrasilia } from '../../lib/brasilia.js';
import { pgFindUserById, pgFindUsersByEmail } from './repos.js';

function mapVoluntarioFromRow(row) {
  const d = row.dados || {};
  return {
    _id: row.id,
    email: row.email,
    nome: d.nome || row.nome || '',
    areas: d.areas || '',
    disponibilidade: d.disponibilidade || '',
    estado: d.estado || '',
    cidade: d.cidade || '',
    ministerio: d.ministerio || '',
    telefone: d.telefone || d.whatsapp || '',
    ativo: row.ativo !== false,
    fonte: row.fonte || 'postgres',
  };
}

export async function pgListVoluntarios(igrejaId) {
  const pool = getPostgresPool();
  const { rows: volRows } = await pool.query(
    `SELECT id, email, nome, dados, ativo, fonte FROM voluntarios
     WHERE igreja_id = $1 AND ativo = TRUE ORDER BY LOWER(email)`,
    [igrejaId],
  );
  const byEmail = new Map();
  volRows.forEach((r) => {
    const em = (r.email || '').toLowerCase().trim();
    if (em) byEmail.set(em, mapVoluntarioFromRow(r));
  });

  const { rows: userRows } = await pool.query(
    `SELECT id, email, nome, ministerio_ids FROM users
     WHERE igreja_id = $1 AND role = 'voluntario' AND ativo = TRUE`,
    [igrejaId],
  );
  for (const u of userRows) {
    const em = (u.email || '').toLowerCase().trim();
    if (!em || byEmail.has(em)) continue;
    byEmail.set(em, {
      _id: u.id,
      email: em,
      nome: u.nome || '',
      areas: '',
      disponibilidade: '',
      estado: '',
      cidade: '',
      ministerio: '',
      ativo: true,
      fonte: 'user',
    });
  }

  return [...byEmail.values()];
}

export async function pgListVoluntarioEmails(igrejaId) {
  const list = await pgListVoluntarios(igrejaId);
  return list.map((v) => (v.email || '').toLowerCase().trim()).filter(Boolean);
}

/** Garante email na lista de voluntários (cadastro, check-in, registro de conta). */
export async function pgEnsureVoluntarioInList({ email, nome, ministerio, igrejaId }) {
  const em = (email || '').toString().trim().toLowerCase();
  if (!em || !em.includes('@') || !igrejaId) return null;
  const pool = getPostgresPool();
  const { rows } = await pool.query(
    'SELECT id, nome, dados FROM voluntarios WHERE igreja_id = $1 AND LOWER(email) = $2 LIMIT 1',
    [igrejaId, em],
  );
  const nomeStr = (nome || '').toString().trim();
  const minStr = (ministerio || '').toString().trim();
  if (rows[0]) {
    const dados = { ...(rows[0].dados || {}) };
    if (nomeStr) dados.nome = nomeStr;
    if (minStr) dados.ministerio = minStr;
    await pool.query(
      `UPDATE voluntarios SET dados = $3::jsonb, nome = COALESCE(NULLIF($4, ''), nome)
       WHERE id = $1 AND igreja_id = $2`,
      [rows[0].id, igrejaId, JSON.stringify(dados), nomeStr],
    );
    return rows[0].id;
  }
  const id = randomUUID();
  const dados = { nome: nomeStr || em, ministerio: minStr || '' };
  await pool.query(
    `INSERT INTO voluntarios (id, igreja_id, email, nome, dados, ativo, fonte)
     VALUES ($1, $2, $3, $4, $5::jsonb, TRUE, 'cadastro')`,
    [id, igrejaId, em, nomeStr || em, JSON.stringify(dados)],
  );
  return id;
}

function mapCheckinRow(row) {
  const ms = row.timestamp_ms != null ? Number(row.timestamp_ms) : null;
  return {
    _id: row.id,
    email: row.email,
    nome: row.nome || '',
    ministerio: row.ministerio || '',
    eventoId: row.evento_id,
    dataCheckin: row.data_checkin,
    timestampMs: ms,
    batizado: row.batizado,
  };
}

export async function pgListCheckins(igrejaId, { dataYmd = null, eventoId = null, ministerio = null, email = null, limit = 5000 } = {}) {
  let sql = `SELECT id, email, nome, ministerio, evento_id, data_checkin, timestamp_ms, batizado
    FROM checkins WHERE igreja_id = $1`;
  const params = [igrejaId];
  if (eventoId) {
    params.push(eventoId);
    sql += ` AND evento_id = $${params.length}`;
  }
  if (ministerio) {
    params.push(`%${ministerio}%`);
    sql += ` AND ministerio ILIKE $${params.length}`;
  }
  if (email) {
    params.push(email.toLowerCase());
    sql += ` AND LOWER(email) = $${params.length}`;
  }
  if (dataYmd) {
    const { start, end } = getDayRangeBrasilia(dataYmd);
    if (start && end) {
      params.push(start, end);
      sql += ` AND data_checkin >= $${params.length - 1} AND data_checkin < $${params.length}`;
    }
  }
  params.push(limit);
  sql += ` ORDER BY timestamp_ms DESC NULLS LAST LIMIT $${params.length}`;
  const { rows } = await getPostgresPool().query(sql, params);
  return rows.map(mapCheckinRow);
}

function mapCandidaturaFull(row) {
  const d = row.dados || {};
  return {
    _id: row.id,
    escalaId: row.escala_id,
    igrejaId: row.igreja_id,
    email: d.email || '',
    nome: d.nome || '',
    telefone: d.telefone || '',
    ministerio: d.ministerio || '',
    status: d.status || 'pendente',
    emailEnviado: !!d.emailEnviado,
    createdAt: d.createdAt || row.created_at,
    aprovadoPor: d.aprovadoPor || null,
    aprovadoEm: d.aprovadoEm || null,
  };
}

export async function pgListCandidaturasByEmail(igrejaId, emailLower) {
  const { rows } = await getPostgresPool().query(
    `SELECT id, igreja_id, escala_id, dados, created_at FROM candidaturas
     WHERE igreja_id = $1 AND LOWER(dados->>'email') = $2 ORDER BY created_at DESC`,
    [igrejaId, emailLower],
  );
  return rows.map(mapCandidaturaFull);
}

export async function pgListCandidaturasForEscalas(igrejaId, escalaIds) {
  if (!escalaIds?.length) return [];
  const { rows } = await getPostgresPool().query(
    `SELECT id, igreja_id, escala_id, dados, created_at FROM candidaturas
     WHERE igreja_id = $1 AND escala_id = ANY($2::text[]) ORDER BY created_at DESC`,
    [igrejaId, escalaIds],
  );
  return rows.map(mapCandidaturaFull);
}

export async function pgListCandidaturasByEscala(igrejaId, escalaId) {
  const { rows } = await getPostgresPool().query(
    `SELECT id, igreja_id, escala_id, dados, created_at FROM candidaturas
     WHERE igreja_id = $1 AND escala_id = $2 ORDER BY created_at DESC`,
    [igrejaId, escalaId],
  );
  return rows.map(mapCandidaturaFull);
}

export async function pgFindCandidaturaById(id, igrejaId) {
  const { rows } = await getPostgresPool().query(
    'SELECT id, igreja_id, escala_id, dados, created_at FROM candidaturas WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  return mapCandidaturaFull(rows[0]);
}

export async function pgUpdateCandidaturaStatus(id, igrejaId, status, { aprovadoPor = null } = {}) {
  const cur = await pgFindCandidaturaById(id, igrejaId);
  if (!cur) return null;
  const dados = {
    nome: cur.nome,
    email: cur.email,
    telefone: cur.telefone,
    ministerio: cur.ministerio,
    status,
    emailEnviado: cur.emailEnviado,
    createdAt: cur.createdAt,
    aprovadoPor: status === 'aprovado' ? aprovadoPor : cur.aprovadoPor,
    aprovadoEm: status === 'aprovado' ? new Date().toISOString() : cur.aprovadoEm,
  };
  await getPostgresPool().query(
    'UPDATE candidaturas SET dados = $3::jsonb WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId, JSON.stringify(dados)],
  );
  return pgFindCandidaturaById(id, igrejaId);
}

export async function pgBulkUpdateCandidaturaStatus(ids, igrejaId, status, { aprovadoPor = null } = {}) {
  if (!ids?.length) return 0;
  const aprovadoEm = status === 'aprovado' ? new Date().toISOString() : null;
  // Atualiza em 1 query: mantém campos existentes e altera apenas status/aprovadoPor/aprovadoEm.
  const { rowCount } = await getPostgresPool().query(
    `UPDATE candidaturas
     SET dados = jsonb_set(
       jsonb_set(
         jsonb_set(dados, '{status}', to_jsonb($3::text), true),
         '{aprovadoPor}',
         CASE WHEN $3::text = 'aprovado' THEN to_jsonb($4::text) ELSE COALESCE(dados->'aprovadoPor','null'::jsonb) END,
         true
       ),
       '{aprovadoEm}',
       CASE WHEN $3::text = 'aprovado' THEN to_jsonb($5::text) ELSE COALESCE(dados->'aprovadoEm','null'::jsonb) END,
       true
     )
     WHERE id = ANY($1::text[]) AND igreja_id = $2`,
    [ids, igrejaId, status, aprovadoPor, aprovadoEm],
  );
  return rowCount;
}

/** Stats por email para painel de candidaturas. */
export async function pgCandidaturaStatsByEmails(igrejaId, emails) {
  const emList = [...new Set((emails || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean))];
  const statsMap = new Map();
  const checkinsMap = new Map();
  if (!emList.length) return { statsMap, checkinsMap };

  const { rows: candRows } = await getPostgresPool().query(
    `SELECT LOWER(dados->>'email') AS em, dados->>'status' AS status
     FROM candidaturas WHERE igreja_id = $1 AND LOWER(dados->>'email') = ANY($2::text[])`,
    [igrejaId, emList],
  );
  for (const em of emList) {
    statsMap.set(em, { totalParticipacoes: 0, totalDesistencias: 0, totalFaltas: 0 });
  }
  for (const r of candRows) {
    const em = r.em;
    if (!em || !statsMap.has(em)) continue;
    const s = statsMap.get(em);
    if (r.status === 'aprovado') s.totalParticipacoes += 1;
    if (r.status === 'desistencia') s.totalDesistencias += 1;
    if (r.status === 'falta') s.totalFaltas += 1;
  }

  const { rows: chkRows } = await getPostgresPool().query(
    `SELECT LOWER(email) AS em, ministerio FROM checkins
     WHERE igreja_id = $1 AND LOWER(email) = ANY($2::text[])`,
    [igrejaId, emList],
  );
  for (const em of emList) checkinsMap.set(em, { total: 0, ministerios: [] });
  for (const r of chkRows) {
    const em = r.em;
    if (!em || !checkinsMap.has(em)) continue;
    const ci = checkinsMap.get(em);
    ci.total += 1;
    if (r.ministerio && !ci.ministerios.includes(r.ministerio)) ci.ministerios.push(r.ministerio);
  }

  return { statsMap, checkinsMap };
}

export async function pgFotoUrlByEmails(igrejaId, emails) {
  const map = {};
  const emList = [...new Set((emails || []).map((e) => String(e || '').toLowerCase().trim()).filter(Boolean))];
  if (!emList.length) return map;
  // 1 única query: foto da igreja preferida; se não houver, foto global (igreja_id NULL).
  const { rows } = await getPostgresPool().query(
    `SELECT LOWER(email) AS em, foto_url, igreja_id
     FROM users
     WHERE LOWER(email) = ANY($1::text[]) AND (igreja_id = $2 OR igreja_id IS NULL)`,
    [emList, igrejaId],
  );
  // Prioriza linha com igreja_id = igrejaId (vs igreja_id IS NULL).
  for (const r of rows) {
    if (!r.foto_url) continue;
    const cur = map[r.em];
    if (!cur || (!cur.scoped && String(r.igreja_id || '') === String(igrejaId))) {
      map[r.em] = { url: r.foto_url, scoped: String(r.igreja_id || '') === String(igrejaId) };
    }
  }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.url]));
}

/** Lista emails distintos que fizeram check-in. Substitui `Checkin.distinct('email', ...)` do Mongo. */
export async function pgListCheckinEmails(igrejaId) {
  const { rows } = await getPostgresPool().query(
    `SELECT DISTINCT LOWER(email) AS em FROM checkins WHERE igreja_id = $1 AND email IS NOT NULL AND email <> ''`,
    [igrejaId],
  );
  return rows.map((r) => r.em).filter(Boolean);
}

export function buildVoluntariosResumo(list) {
  const areasCount = {};
  const dispCount = {};
  (list || []).forEach((v) => {
    (v.areas || '').split(',').map((a) => a.trim()).filter(Boolean).forEach((a) => {
      areasCount[a] = (areasCount[a] || 0) + 1;
    });
    (v.disponibilidade || '').split(',').map((d) => d.trim()).filter(Boolean).forEach((d) => {
      dispCount[d] = (dispCount[d] || 0) + 1;
    });
  });
  return {
    total: (list || []).length,
    areas: Object.entries(areasCount).sort((a, b) => b[1] - a[1]),
    disponibilidade: Object.entries(dispCount).sort((a, b) => b[1] - a[1]),
    estados: [],
    cidades: [],
  };
}
