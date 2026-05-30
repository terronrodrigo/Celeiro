/**
 * Dados operacionais em PostgreSQL: voluntários, check-ins, candidaturas (gestão).
 */
import { randomUUID } from 'crypto';
import { getPostgresPool } from './init.js';
import { escalaDataToYMD, getDayRangeBrasilia } from '../../lib/brasilia.js';
import { pgFindUserById, pgFindUsersByEmail, normBatizadoPerfil } from './repos.js';
import { splitVoluntarioMinisterios } from '../../lib/ministerio-match.js';

// Re-export para que outros módulos (server.js) usem o pool sem importar init.js direto.
export { getPostgresPool };

/** Normaliza campos multivalorados para string CSV.
 * Aceita array (perfil novo) ou string (legado/CSV) e devolve sempre string,
 * para o resto do código poder fazer .split(',') sem quebrar. */
function toCsvString(v) {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  if (v == null) return '';
  return String(v);
}

function mapVoluntarioFromRow(row) {
  const d = row.dados || {};
  const ministerios = splitVoluntarioMinisterios({ ministerios: d.ministerios, ministerio: d.ministerio });
  const ministerio = ministerios.length ? ministerios.join(', ') : '';
  return {
    _id: row.id,
    email: row.email,
    nome: d.nome || row.nome || '',
    areas: toCsvString(d.areas),
    disponibilidade: toCsvString(d.disponibilidade),
    estado: d.estado || '',
    cidade: d.cidade || '',
    ministerio,
    ministerios,
    telefone: d.telefone || d.whatsapp || '',
    batizado: normBatizadoPerfil(d.batizado),
    ativo: row.ativo !== false,
    fonte: row.fonte || 'postgres',
  };
}

/** Anexa contagens de candidaturas (escala) e check-ins por email (1 query cada). */
export async function pgAttachParticipacaoStats(igrejaId, voluntarios) {
  if (!voluntarios?.length) return voluntarios || [];
  const emails = [...new Set(voluntarios.map((v) => String(v.email || '').toLowerCase().trim()).filter(Boolean))];
  if (!emails.length) return voluntarios;
  const pool = getPostgresPool();
  const [{ rows: candRows }, { rows: ckRows }] = await Promise.all([
    pool.query(
      `SELECT LOWER(dados->>'email') AS em,
         COUNT(*)::int AS vezes_escala_inscricao,
         COUNT(*) FILTER (WHERE dados->>'status' = 'aprovado')::int AS vezes_escala_aprovado
       FROM candidaturas
       WHERE igreja_id = $1 AND LOWER(dados->>'email') = ANY($2::text[])
       GROUP BY 1`,
      [igrejaId, emails],
    ),
    pool.query(
      `SELECT LOWER(email) AS em, COUNT(*)::int AS vezes_checkin
       FROM checkins
       WHERE igreja_id = $1 AND LOWER(email) = ANY($2::text[])
       GROUP BY 1`,
      [igrejaId, emails],
    ),
  ]);
  const candMap = new Map(candRows.map((r) => [r.em, r]));
  const ckMap = new Map(ckRows.map((r) => [r.em, r.vezes_checkin]));
  return voluntarios.map((v) => {
    const em = String(v.email || '').toLowerCase().trim();
    const c = candMap.get(em);
    return {
      ...v,
      vezesEscalaAprovado: c?.vezes_escala_aprovado ?? 0,
      vezesEscalaInscricao: c?.vezes_escala_inscricao ?? 0,
      vezesCheckin: ckMap.get(em) ?? 0,
    };
  });
}

/** Indica se falta complemento pós-check-in (uma vez) e quais campos. */
export function computePerfilCheckinGap(dados) {
  const d = dados || {};
  if (d.perfilCheckinCompletoAt || d.perfilCheckinSkip === true) {
    return { needsComplement: false, missing: [] };
  }
  const missing = [];
  const tel = `${d.telefone || ''} ${d.whatsapp || ''}`.trim();
  if (!tel) missing.push('telefone');
  if (!(d.cidade || '').toString().trim()) missing.push('cidade');
  if (!(d.estado || '').toString().trim()) missing.push('estado');
  return { needsComplement: missing.length > 0, missing };
}

/** Atualiza JSON `dados` do voluntário com complemento único ou skip. */
export async function pgApplyCheckinComplemento(igrejaId, emailLower, { telefone, whatsapp, cidade, estado, skip } = {}) {
  const pool = getPostgresPool();
  const em = String(emailLower || '').toLowerCase().trim();
  const { rows } = await pool.query(
    'SELECT id, dados FROM voluntarios WHERE igreja_id = $1 AND LOWER(email) = $2 LIMIT 1',
    [igrejaId, em],
  );
  if (!rows[0]) return { ok: false, error: 'not_found' };
  const dados = { ...(rows[0].dados || {}) };
  if (skip) {
    dados.perfilCheckinSkip = true;
    dados.perfilCheckinSkipAt = new Date().toISOString();
  } else {
    if (telefone != null && String(telefone).trim()) dados.telefone = String(telefone).trim();
    if (whatsapp != null && String(whatsapp).trim()) dados.whatsapp = String(whatsapp).trim();
    if (cidade != null && String(cidade).trim()) dados.cidade = String(cidade).trim();
    if (estado != null && String(estado).trim()) {
      dados.estado = String(estado).trim().toUpperCase().slice(0, 2);
    }
    dados.perfilCheckinCompletoAt = new Date().toISOString();
    delete dados.perfilCheckinSkip;
    delete dados.perfilCheckinSkipAt;
  }
  await pool.query(
    'UPDATE voluntarios SET dados = $3::jsonb, updated_at = NOW() WHERE id = $1 AND igreja_id = $2',
    [rows[0].id, igrejaId, JSON.stringify(dados)],
  );
  return { ok: true };
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
      batizado: null,
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
/**
 * Garante que o email esteja em `voluntarios` para a igreja.
 * fonte: 'cadastro' (default), 'checkin', 'planilha', etc. — registra como veio.
 * Se já existe, atualiza nome/ministerio (não sobrescreve fonte para preservar histórico).
 */
export async function pgEnsureVoluntarioInList({ email, nome, ministerio, igrejaId, fonte = 'cadastro', telefone, batizado } = {}) {
  const em = (email || '').toString().trim().toLowerCase();
  if (!em || !em.includes('@') || !igrejaId) return null;
  const pool = getPostgresPool();
  const { rows } = await pool.query(
    'SELECT id, nome, dados FROM voluntarios WHERE igreja_id = $1 AND LOWER(email) = $2 LIMIT 1',
    [igrejaId, em],
  );
  const nomeStr = (nome || '').toString().trim();
  const minStr = (ministerio || '').toString().trim();
  const telStr = (telefone || '').toString().trim();
  const batMerge = batizado === true || batizado === false ? batizado : null;
  if (rows[0]) {
    const dados = { ...(rows[0].dados || {}) };
    if (nomeStr) dados.nome = nomeStr;
    if (minStr) {
      const set = new Set(splitVoluntarioMinisterios({ ministerios: dados.ministerios, ministerio: dados.ministerio }));
      set.add(minStr);
      const arr = [...set];
      dados.ministerios = arr;
      dados.ministerio = arr.join(', ');
    }
    if (telStr && !String(dados.telefone || dados.whatsapp || '').trim()) {
      dados.telefone = telStr;
    }
    if (batMerge !== null) {
      const prev = normBatizadoPerfil(dados.batizado);
      if (prev !== true && prev !== false) {
        dados.batizado = batMerge;
      }
    }
    await pool.query(
      `UPDATE voluntarios SET dados = $3::jsonb, nome = COALESCE(NULLIF($4, ''), nome)
       WHERE id = $1 AND igreja_id = $2`,
      [rows[0].id, igrejaId, JSON.stringify(dados), nomeStr],
    );
    return rows[0].id;
  }
  const id = randomUUID();
  const mins0 = minStr ? [minStr] : [];
  const dados = { nome: nomeStr || em, ministerios: mins0, ministerio: mins0.join(', ') };
  if (telStr) dados.telefone = telStr;
  if (batMerge !== null) dados.batizado = batMerge;
  await pool.query(
    `INSERT INTO voluntarios (id, igreja_id, email, nome, dados, ativo, fonte)
     VALUES ($1, $2, $3, $4, $5::jsonb, TRUE, $6)`,
    [id, igrejaId, em, nomeStr || em, JSON.stringify(dados), fonte],
  );
  return id;
}

/**
 * Backfill: cria entrada em `voluntarios` para todos os emails de `checkins`
 * que ainda não estão na lista. Idempotente; retorna nº de novas linhas.
 * Marca a fonte como 'checkin' pra distinguir na UI.
 */
export async function pgBackfillVoluntariosFromCheckins(igrejaId = null) {
  const params = [];
  let where = '';
  if (igrejaId) {
    params.push(igrejaId);
    where = ` AND ch.igreja_id = $${params.length}`;
  }
  // Pega último nome/ministério não-vazio por email distinto.
  const { rows } = await getPostgresPool().query(
    `SELECT DISTINCT ON (LOWER(ch.email))
       ch.igreja_id, LOWER(ch.email) AS email,
       COALESCE(NULLIF(ch.nome, ''), '') AS nome,
       COALESCE(NULLIF(ch.ministerio, ''), '') AS ministerio
     FROM checkins ch
     LEFT JOIN voluntarios v
       ON v.igreja_id = ch.igreja_id AND LOWER(v.email) = LOWER(ch.email)
     WHERE v.id IS NULL
       AND ch.email IS NOT NULL
       AND ch.email <> ''${where}
     ORDER BY LOWER(ch.email), ch.timestamp_ms DESC NULLS LAST`,
    params,
  );
  let criados = 0;
  for (const r of rows) {
    const id = await pgEnsureVoluntarioInList({
      email: r.email, nome: r.nome, ministerio: r.ministerio, igrejaId: r.igreja_id, fonte: 'checkin',
    });
    if (id) criados += 1;
  }
  return criados;
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

export async function pgUpdateCandidaturaStatus(id, igrejaId, status, { aprovadoPor = null, emailEnviado } = {}) {
  const cur = await pgFindCandidaturaById(id, igrejaId);
  if (!cur) return null;
  const dados = {
    nome: cur.nome,
    email: cur.email,
    telefone: cur.telefone,
    ministerio: cur.ministerio,
    status,
    emailEnviado: emailEnviado !== undefined ? !!emailEnviado : cur.emailEnviado,
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

/** Aceita string CSV ou array; devolve array de strings trimadas e não vazias. */
function splitMultiValue(v) {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (v == null) return [];
  return String(v).split(',').map((x) => x.trim()).filter(Boolean);
}

export function buildVoluntariosResumo(list) {
  const ministeriosCount = {};
  const dispCount = {};
  (list || []).forEach((v) => {
    const mins = splitVoluntarioMinisterios(v);
    if (mins.length) {
      mins.forEach((m) => {
        ministeriosCount[m] = (ministeriosCount[m] || 0) + 1;
      });
    }
    splitMultiValue(v.disponibilidade).forEach((d) => {
      dispCount[d] = (dispCount[d] || 0) + 1;
    });
  });
  return {
    total: (list || []).length,
    ministerios: Object.entries(ministeriosCount).sort((a, b) => b[1] - a[1]),
    disponibilidade: Object.entries(dispCount).sort((a, b) => b[1] - a[1]),
    estados: [],
    cidades: [],
  };
}

/**
 * Histórico de ministérios servidos por email (check-ins + candidaturas aprovadas).
 * @returns {Map<string, Array<{ ministerio: string, servedAt: Date, escalaId: string|null }>>}
 */
export async function pgMapUltimosMinisteriosServidos(igrejaId, { perEmail = 3 } = {}) {
  const pool = getPostgresPool();
  const { rows } = await pool.query(
    `WITH history AS (
       SELECT
         LOWER(ch.email) AS em,
         TRIM(ch.ministerio) AS ministerio,
         COALESCE(
           ch.data_checkin,
           CASE WHEN ch.timestamp_ms IS NOT NULL THEN to_timestamp(ch.timestamp_ms / 1000.0) END,
           ch.created_at
         ) AS served_at,
         cand.escala_id AS escala_id
       FROM checkins ch
       LEFT JOIN candidaturas cand ON cand.id = ch.candidatura_id
       WHERE ch.igreja_id = $1
         AND TRIM(COALESCE(ch.ministerio, '')) <> ''
       UNION ALL
       SELECT
         LOWER(c.dados->>'email') AS em,
         TRIM(c.dados->>'ministerio') AS ministerio,
         COALESCE(
           CASE
             WHEN NULLIF(TRIM(e.dados->>'data'), '') ~ '^\\d{4}-\\d{2}-\\d{2}'
               THEN (SUBSTRING(TRIM(e.dados->>'data') FROM 1 FOR 10))::date
             ELSE NULL
           END,
           c.created_at
         ) AS served_at,
         c.escala_id AS escala_id
       FROM candidaturas c
       INNER JOIN escalas e ON e.id = c.escala_id
       WHERE c.igreja_id = $1
         AND COALESCE(c.dados->>'status', '') = 'aprovado'
         AND TRIM(COALESCE(c.dados->>'ministerio', '')) <> ''
     ),
     best AS (
       SELECT em, ministerio,
         MAX(served_at) AS served_at,
         (array_agg(escala_id ORDER BY served_at DESC NULLS LAST))[1] AS escala_id
       FROM history
       WHERE em IS NOT NULL AND em <> '' AND ministerio IS NOT NULL AND ministerio <> ''
       GROUP BY em, ministerio
     )
     SELECT em, ministerio, served_at, escala_id
     FROM best
     ORDER BY em, served_at DESC`,
    [igrejaId],
  );
  const limit = Math.max(1, Math.min(10, Number(perEmail) || 3));
  const out = new Map();
  for (const r of rows) {
    const em = (r.em || '').toLowerCase().trim();
    if (!em) continue;
    if (!out.has(em)) out.set(em, []);
    const list = out.get(em);
    if (list.length >= limit) continue;
    list.push({
      ministerio: r.ministerio,
      servedAt: r.served_at,
      escalaId: r.escala_id ? String(r.escala_id) : null,
    });
  }
  return out;
}
