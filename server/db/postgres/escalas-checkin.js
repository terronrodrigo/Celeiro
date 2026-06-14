import { randomUUID } from 'crypto';
import { getPostgresPool } from './init.js';
import {
  parseDateAsBrasilia,
  parseDateOnlyToUTC,
  escalaDataToYMD,
  parseHHMM,
  getHojeDateString,
  getDayRangeBrasilia,
} from '../../lib/brasilia.js';
import { isCheckinEventAberto } from '../../lib/escala-checkin-rules.js';
import { pgSyncBatizadoPerfilFromCheckin } from './operational-data.js';

const EVENTOS_CHECKIN_MIGRATION_SQL = `
ALTER TABLE eventos_checkin ADD COLUMN IF NOT EXISTS email_abertura_enviado_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS escala_lembrete_emails (
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('quarta', 'domingo')),
  culto_data DATE NOT NULL,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  emails_enviados INT NOT NULL DEFAULT 0,
  PRIMARY KEY (igreja_id, tipo, culto_data)
);

CREATE TABLE IF NOT EXISTS checkin_agradecimento_emails (
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  checkin_ymd DATE NOT NULL,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (igreja_id, email, checkin_ymd)
);

CREATE TABLE IF NOT EXISTS checkin_abertura_emails (
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  evento_id TEXT NOT NULL,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (igreja_id, email, evento_id)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'checkin_abertura_emails' AND column_name = 'evento_ymd'
  ) THEN
    DROP TABLE checkin_abertura_emails;
    CREATE TABLE checkin_abertura_emails (
      igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      evento_id TEXT NOT NULL,
      enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (igreja_id, email, evento_id)
    );
  END IF;
END $$;
`;

export async function migrateEventosCheckinSchema() {
  await getPostgresPool().query(EVENTOS_CHECKIN_MIGRATION_SQL);
}

function mapEscalaRow(row) {
  const d = row.dados || {};
  const dataIso = d.data || (row.data_ymd ? `${row.data_ymd}T03:00:00.000Z` : null);
  return {
    _id: row.id,
    igrejaId: row.igreja_id,
    nome: d.nome || '',
    data: dataIso ? new Date(dataIso) : null,
    descricao: d.descricao || '',
    ativo: d.ativo !== false,
    criadoPor: d.criadoPor || null,
    cultoRecorrenteId: d.cultoRecorrenteId || null,
    autoGerada: !!d.autoGerada,
    // Ligação com o evento de check-in correspondente (Fase 1 do redesign).
    eventoCheckinId: d.eventoCheckinId || null,
    // { "Welcome": 8, "Streaming": 4 }; valores ausentes ou 0 = sem limite.
    capacidades: d.capacidades && typeof d.capacidades === 'object' ? d.capacidades : {},
    createdAt: row.created_at,
    updatedAt: d.updatedAt || row.created_at,
  };
}

function mapEventoRow(row) {
  if (!row) return null;
  let ymd = '';
  if (row.data instanceof Date) {
    // Caso o parser global não tenha sido aplicado (conexão antiga): use componentes UTC
    // diretamente, já que pg interpreta DATE como meia-noite no TZ local do processo.
    ymd = row.data.toISOString().slice(0, 10);
  } else if (row.data != null) {
    ymd = String(row.data).slice(0, 10);
  }
  return {
    _id: row.id,
    igrejaId: row.igreja_id,
    data: ymd ? parseDateAsBrasilia(ymd) : null,
    label: row.label || '',
    ativo: row.ativo !== false,
    horarioInicio: row.horario_inicio || '',
    horarioFim: row.horario_fim || '',
    cultoRecorrenteId: row.culto_recorrente_id || null,
    autoGerado: !!row.auto_gerado,
    criadoPor: row.criado_por || null,
    createdAt: row.created_at,
    emailAberturaEnviadoEm: row.email_abertura_enviado_em || null,
  };
}

/**
 * Lista escalas com ordenação "smart" (futuras crescente, depois passadas decrescente).
 * - ativoOnly: filtra dados.ativo != false
 * - nextPerCultoOnly: para cada cultoRecorrenteId, retorna apenas a próxima futura;
 *   escalas sem cultoRecorrenteId são mantidas individualmente.
 * - futureOnly: ignora datas anteriores a hoje (Brasília).
 */
export async function pgListEscalas(igrejaId, {
  ativoOnly = false, limit = 200, nextPerCultoOnly = false, futureOnly = false,
} = {}) {
  let sql = `SELECT id, igreja_id, dados, created_at FROM escalas WHERE igreja_id = $1`;
  const params = [igrejaId];
  if (ativoOnly) {
    sql += " AND (dados->>'ativo')::boolean IS DISTINCT FROM FALSE";
  }
  if (futureOnly) {
    sql += ` AND (dados->>'data')::date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`;
  }
  // Smart sort: futuras (asc), depois passadas (desc).
  sql += `
    ORDER BY
      CASE WHEN (dados->>'data')::date >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')::date THEN 0 ELSE 1 END,
      CASE WHEN (dados->>'data')::date >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')::date
           THEN (dados->>'data')::timestamptz END ASC NULLS LAST,
      CASE WHEN (dados->>'data')::date <  (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')::date
           THEN (dados->>'data')::timestamptz END DESC NULLS LAST,
      created_at DESC`;
  params.push(limit);
  sql += ` LIMIT $${params.length}`;
  const { rows } = await getPostgresPool().query(sql, params);
  let escalas = rows.map(mapEscalaRow);
  if (nextPerCultoOnly) {
    escalas = filterNextPerCulto(escalas);
  }
  return escalas;
}

/** Escalas ativas (ou todas) em uma data YMD (Brasília). */
export async function pgListEscalasByDataYmd(igrejaId, ymd, { ativoOnly = true } = {}) {
  if (!ymd) return [];
  let sql = `SELECT id, igreja_id, dados, created_at FROM escalas
    WHERE igreja_id = $1 AND (dados->>'data')::date = $2::date`;
  if (ativoOnly) {
    sql += " AND (dados->>'ativo')::boolean IS DISTINCT FROM FALSE";
  }
  sql += " ORDER BY (dados->>'nome') ASC NULLS LAST, created_at ASC";
  const { rows } = await getPostgresPool().query(sql, [igrejaId, ymd]);
  return rows.map(mapEscalaRow);
}

export async function pgClearEscalaLembreteEnviado(igrejaId, tipo, cultoDataYmd) {
  await getPostgresPool().query(
    `DELETE FROM escala_lembrete_emails
     WHERE igreja_id = $1 AND tipo = $2 AND culto_data = $3::date`,
    [igrejaId, tipo, cultoDataYmd],
  );
}

export async function pgWasEscalaLembreteEnviado(igrejaId, tipo, cultoDataYmd) {
  const { rows } = await getPostgresPool().query(
    `SELECT 1 FROM escala_lembrete_emails
     WHERE igreja_id = $1 AND tipo = $2 AND culto_data = $3::date LIMIT 1`,
    [igrejaId, tipo, cultoDataYmd],
  );
  return rows.length > 0;
}

export async function pgMarkEscalaLembreteEnviado(igrejaId, tipo, cultoDataYmd, emailsEnviados = 0) {
  await getPostgresPool().query(
    `INSERT INTO escala_lembrete_emails (igreja_id, tipo, culto_data, emails_enviados)
     VALUES ($1, $2, $3::date, $4)
     ON CONFLICT (igreja_id, tipo, culto_data) DO UPDATE SET
       enviado_em = NOW(),
       emails_enviados = EXCLUDED.emails_enviados`,
    [igrejaId, tipo, cultoDataYmd, emailsEnviados],
  );
}

/** Voluntários com check-in em checkinYmd que ainda não receberam email de agradecimento. */
export async function pgListCheckinAgradecimentoPendentes(checkinYmd) {
  const ymd = String(checkinYmd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return [];
  const { start, end } = getDayRangeBrasilia(ymd);
  if (!start || !end) return [];
  const { rows } = await getPostgresPool().query(
    `WITH checkins_dia AS (
       SELECT c.igreja_id,
              LOWER(TRIM(c.email)) AS email,
              MAX(c.nome) AS nome,
              MAX(c.ministerio) AS ministerio,
              COUNT(*)::int AS checkins_no_dia
       FROM checkins c
       WHERE LOWER(TRIM(COALESCE(c.email, ''))) LIKE '%@%'
         AND (
           (c.data_checkin >= $1 AND c.data_checkin < $2)
           OR (
             c.timestamp_ms IS NOT NULL
             AND (to_timestamp(c.timestamp_ms / 1000.0) AT TIME ZONE 'America/Sao_Paulo')::date = $3::date
           )
         )
       GROUP BY c.igreja_id, LOWER(TRIM(c.email))
     )
     SELECT cd.igreja_id, cd.email, cd.nome, cd.ministerio, cd.checkins_no_dia
     FROM checkins_dia cd
     WHERE NOT EXISTS (
       SELECT 1 FROM checkin_agradecimento_emails a
       WHERE a.igreja_id = cd.igreja_id
         AND LOWER(a.email) = cd.email
         AND a.checkin_ymd = $3::date
     )
     ORDER BY cd.igreja_id, cd.email`,
    [start, end, ymd],
  );
  return rows.map((r) => ({
    igrejaId: r.igreja_id,
    email: r.email,
    nome: r.nome || '',
    ministerio: r.ministerio || '',
    checkinsNoDia: r.checkins_no_dia || 1,
    checkinYmd: ymd,
  }));
}

export async function pgMarkCheckinAgradecimentoEnviado(igrejaId, email, checkinYmd) {
  const em = String(email || '').toLowerCase().trim();
  const ymd = String(checkinYmd || '').trim().slice(0, 10);
  if (!em || !ymd) return;
  await getPostgresPool().query(
    `INSERT INTO checkin_agradecimento_emails (igreja_id, email, checkin_ymd)
     VALUES ($1, $2, $3::date)
     ON CONFLICT (igreja_id, email, checkin_ymd) DO UPDATE SET enviado_em = NOW()`,
    [igrejaId, em, ymd],
  );
}

/**
 * Mantém apenas a próxima ocorrência futura por cultoRecorrenteId.
 * Itens sem cultoRecorrenteId são preservados (são escalas/eventos avulsos).
 * Pressupõe que a lista já está ordenada (futuras asc primeiro).
 * Exportada para testes; opcionalmente recebe `todayYmd` para determinismo.
 */
export function filterNextPerCulto(items, todayYmdArg = null) {
  const todayYmd = todayYmdArg
    || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const seenCultos = new Set();
  const out = [];
  for (const it of items) {
    const raw = it?.data;
    const ymd = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)
      ? raw.slice(0, 10)
      : escalaDataToYMD(raw);
    const cultoId = it?.cultoRecorrenteId ? String(it.cultoRecorrenteId) : null;
    const isFuture = ymd && ymd >= todayYmd;
    if (!cultoId) {
      if (isFuture) out.push(it);
      continue;
    }
    if (!isFuture) continue;
    if (seenCultos.has(cultoId)) continue;
    seenCultos.add(cultoId);
    out.push(it);
  }
  return out;
}

export async function pgFindEscalasByIds(igrejaId, ids) {
  if (!ids?.length) return [];
  const { rows } = await getPostgresPool().query(
    'SELECT id, igreja_id, dados, created_at FROM escalas WHERE igreja_id = $1 AND id = ANY($2::text[])',
    [igrejaId, ids],
  );
  return rows.map(mapEscalaRow);
}

export async function pgFindEscalaById(id, igrejaId) {
  const { rows } = await getPostgresPool().query(
    'SELECT id, igreja_id, dados, created_at FROM escalas WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  return mapEscalaRow(rows[0]);
}

function sanitizeCapacidades(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const key = String(k).trim();
    const n = Number(v);
    if (key && Number.isFinite(n) && n > 0 && n < 10000) {
      out[key] = Math.floor(n);
    }
  }
  return out;
}

export async function pgCreateEscala({
  igrejaId, nome, data, descricao = '', ativo = true, criadoPor = null,
  cultoRecorrenteId = null, autoGerada = false,
  eventoCheckinId = null, capacidades = null,
}) {
  const id = randomUUID();
  const dataIso = data ? (data instanceof Date ? data.toISOString() : parseDateOnlyToUTC(data)?.toISOString()) : null;
  const dados = {
    nome: String(nome).trim(),
    data: dataIso,
    descricao: String(descricao || '').trim(),
    ativo: !!ativo,
    criadoPor,
    cultoRecorrenteId,
    autoGerada,
    eventoCheckinId: eventoCheckinId || null,
    capacidades: sanitizeCapacidades(capacidades),
    updatedAt: new Date().toISOString(),
  };
  await getPostgresPool().query(
    'INSERT INTO escalas (id, igreja_id, dados) VALUES ($1, $2, $3::jsonb)',
    [id, igrejaId, JSON.stringify(dados)],
  );
  return pgFindEscalaById(id, igrejaId);
}

export async function pgUpdateEscala(id, igrejaId, patch) {
  const current = await pgFindEscalaById(id, igrejaId);
  if (!current) return null;
  const dados = {
    nome: patch.nome !== undefined ? String(patch.nome).trim() : current.nome,
    data: patch.data !== undefined
      ? (patch.data ? parseDateOnlyToUTC(patch.data)?.toISOString() : null)
      : (current.data ? current.data.toISOString() : null),
    descricao: patch.descricao !== undefined ? String(patch.descricao).trim() : current.descricao,
    ativo: patch.ativo !== undefined ? !!patch.ativo : current.ativo,
    criadoPor: current.criadoPor,
    cultoRecorrenteId: current.cultoRecorrenteId,
    autoGerada: current.autoGerada,
    eventoCheckinId: patch.eventoCheckinId !== undefined
      ? (patch.eventoCheckinId || null)
      : (current.eventoCheckinId || null),
    capacidades: patch.capacidades !== undefined
      ? sanitizeCapacidades(patch.capacidades)
      : (current.capacidades || {}),
    updatedAt: new Date().toISOString(),
  };
  await getPostgresPool().query(
    'UPDATE escalas SET dados = $3::jsonb WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId, JSON.stringify(dados)],
  );
  return pgFindEscalaById(id, igrejaId);
}

/** Conta candidaturas por ministério (status aprovado) para checagem de capacidade. */
export async function pgCountAprovadosByMinisterio(igrejaId, escalaId) {
  const { rows } = await getPostgresPool().query(
    `SELECT (dados->>'ministerio') AS ministerio, COUNT(*)::int AS n
     FROM candidaturas
     WHERE igreja_id = $1 AND escala_id = $2 AND (dados->>'status') = 'aprovado'
     GROUP BY (dados->>'ministerio')`,
    [igrejaId, escalaId],
  );
  const out = {};
  for (const r of rows) {
    const k = (r.ministerio || '').trim();
    if (k) out[k] = r.n;
  }
  return out;
}

/** Evento check-in órfão = nenhuma escala ativa aponta para ele via eventoCheckinId. */
export async function pgListEventosCheckinSemEscalaAtiva(igrejaId = null) {
  const { rows } = await getPostgresPool().query(
    `SELECT ec.id, ec.igreja_id, ec.label, ec.data, ec.ativo,
            (SELECT COUNT(*)::int FROM checkins ch WHERE ch.evento_id = ec.id) AS checkins_count
     FROM eventos_checkin ec
     WHERE ($1::text IS NULL OR ec.igreja_id = $1::text)
       AND NOT EXISTS (
         SELECT 1 FROM escalas e
         WHERE e.igreja_id = ec.igreja_id
           AND NULLIF(trim(e.dados->>'eventoCheckinId'), '') = ec.id
           AND (e.dados->>'ativo')::boolean IS DISTINCT FROM FALSE
       )
     ORDER BY ec.igreja_id, ec.data DESC, ec.created_at DESC`,
    [igrejaId],
  );
  return rows.map((r) => ({
    _id: r.id,
    igrejaId: r.igreja_id,
    label: r.label || '',
    data: r.data,
    ativo: r.ativo !== false,
    checkinsCount: r.checkins_count || 0,
  }));
}

export async function pgCollectEventoCheckinIdsFromEscalas(executor, igrejaId, escalaIds) {
  if (!escalaIds?.length) return [];
  const { rows } = await executor.query(
    `SELECT DISTINCT NULLIF(trim(dados->>'eventoCheckinId'), '') AS evt_id
     FROM escalas WHERE igreja_id = $1 AND id = ANY($2::text[])`,
    [igrejaId, escalaIds],
  );
  return rows.map((r) => r.evt_id).filter(Boolean);
}

export async function pgDeleteEventosCheckinComRegistros(executor, igrejaId, eventoIds) {
  if (!eventoIds?.length) return { eventos: 0, checkins: 0 };
  const { rowCount: checkinsDeleted } = await executor.query(
    'DELETE FROM checkins WHERE igreja_id = $1 AND evento_id = ANY($2::text[])',
    [igrejaId, eventoIds],
  );
  const { rowCount: eventosDeleted } = await executor.query(
    'DELETE FROM eventos_checkin WHERE igreja_id = $1 AND id = ANY($2::text[])',
    [igrejaId, eventoIds],
  );
  return { eventos: eventosDeleted || 0, checkins: checkinsDeleted || 0 };
}

/** Entre candidatos, remove eventos que ficaram sem escala ativa (+ registros em checkins). */
export async function pgPurgeOrphanEventosCheckinCandidates(executor, igrejaId, candidateIds) {
  if (!candidateIds?.length) return { eventos: 0, checkins: 0 };
  const unique = [...new Set(candidateIds.map(String))];
  const { rows } = await executor.query(
    `SELECT t.id FROM unnest($2::text[]) AS t(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM escalas e
       WHERE e.igreja_id = $1
         AND NULLIF(trim(e.dados->>'eventoCheckinId'), '') = t.id
         AND (e.dados->>'ativo')::boolean IS DISTINCT FROM FALSE
     )`,
    [igrejaId, unique],
  );
  return pgDeleteEventosCheckinComRegistros(executor, igrejaId, rows.map((r) => r.id));
}

/** Limpa todos os eventos_checkin sem escala ativa (e check-ins vinculados). */
export async function pgPurgeEventosCheckinSemEscalaAtiva(igrejaId = null, { dryRun = false } = {}) {
  const orphans = await pgListEventosCheckinSemEscalaAtiva(igrejaId);
  if (dryRun) {
    return {
      dryRun: true,
      orphans,
      deleted: { eventos: 0, checkins: 0 },
      totalCheckins: orphans.reduce((s, o) => s + (o.checkinsCount || 0), 0),
    };
  }
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let eventos = 0;
    let checkins = 0;
    const byIgreja = new Map();
    for (const o of orphans) {
      if (!byIgreja.has(o.igrejaId)) byIgreja.set(o.igrejaId, []);
      byIgreja.get(o.igrejaId).push(o._id);
    }
    for (const [igId, ids] of byIgreja) {
      const r = await pgDeleteEventosCheckinComRegistros(client, igId, ids);
      eventos += r.eventos;
      checkins += r.checkins;
    }
    await client.query('COMMIT');
    return { orphans, deleted: { eventos, checkins } };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Remove a escala (candidaturas e linhas de escala_inscricoes somem por ON DELETE CASCADE).
 * Uso interno ao excluir culto recorrente e em scripts — não usar na rota admin sem confirmação.
 */
export async function pgHardDeleteEscala(id, igrejaId) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evtIds = await pgCollectEventoCheckinIdsFromEscalas(client, igrejaId, [id]);
    const { rowCount } = await client.query(
      'DELETE FROM escalas WHERE id = $1 AND igreja_id = $2',
      [id, igrejaId],
    );
    const eventosCheckinRemoved = rowCount
      ? await pgPurgeOrphanEventosCheckinCandidates(client, igrejaId, evtIds)
      : { eventos: 0, checkins: 0 };
    await client.query('COMMIT');
    return {
      deleted: (rowCount || 0) > 0,
      eventosCheckinRemoved,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function pgDeleteEscala(id, igrejaId, opts = {}) {
  const redirectToEscalaId = (opts.redirectToEscalaId || '').trim() || null;
  const forceWithoutRedirect = opts.forceWithoutRedirect === true;
  const pool = getPostgresPool();

  const { rows: srcRows } = await pool.query(
    'SELECT id FROM escalas WHERE id = $1 AND igreja_id = $2 LIMIT 1',
    [id, igrejaId],
  );
  if (!srcRows[0]) return { deleted: false, candidaturas: 0, notFound: true };

  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM candidaturas WHERE escala_id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  const count = rows[0]?.c || 0;

  if (count > 0 && !redirectToEscalaId && !forceWithoutRedirect) {
    return { deleted: false, candidaturas: count, needRedirect: true };
  }

  if (count > 0 && redirectToEscalaId) {
    const targetCheck = pgValidateEscalaRedirectTarget(
      await pgFindEscalaById(redirectToEscalaId, igrejaId),
      id,
    );
    if (!targetCheck.ok) return { deleted: false, candidaturas: count, error: targetCheck.error };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evtIds = await pgCollectEventoCheckinIdsFromEscalas(client, igrejaId, [id]);
    let moved = 0;
    if (count > 0 && redirectToEscalaId) {
      moved = await pgMoveCandidaturasBetweenEscalas(client, id, redirectToEscalaId, igrejaId);
    }
    const { rowCount } = await client.query(
      'DELETE FROM escalas WHERE id = $1 AND igreja_id = $2',
      [id, igrejaId],
    );
    const eventosCheckinRemoved = rowCount
      ? await pgPurgeOrphanEventosCheckinCandidates(client, igrejaId, evtIds)
      : { eventos: 0, checkins: 0 };
    await client.query('COMMIT');
    return {
      deleted: (rowCount || 0) > 0,
      candidaturas: count,
      moved,
      redirectedTo: redirectToEscalaId || null,
      eventosCheckinRemoved,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Escala de destino: ativa, data ≥ hoje (Brasília), diferente da origem. */
export function pgValidateEscalaRedirectTarget(target, sourceId) {
  if (!target) return { ok: false, error: 'Escala de destino não encontrada.' };
  if (String(target._id) === String(sourceId)) {
    return { ok: false, error: 'Escolha uma escala diferente da que será excluída.' };
  }
  if (target.ativo === false) {
    return { ok: false, error: 'A escala de destino precisa estar ativa (inscrições abertas).' };
  }
  const ymd = escalaDataToYMD(target.data);
  const hoje = getHojeDateString();
  if (!ymd || ymd < hoje) {
    return { ok: false, error: 'A escala de destino precisa ser futura (data de hoje ou posterior).' };
  }
  return { ok: true };
}

async function pgMoveCandidaturasBetweenEscalas(client, sourceId, targetId, igrejaId) {
  await client.query(
    `DELETE FROM candidaturas c_src
     WHERE c_src.escala_id = $1 AND c_src.igreja_id = $3
       AND EXISTS (
         SELECT 1 FROM candidaturas c_tgt
         WHERE c_tgt.escala_id = $2 AND c_tgt.igreja_id = $3
           AND LOWER(c_tgt.dados->>'email') = LOWER(c_src.dados->>'email')
       )`,
    [sourceId, targetId, igrejaId],
  );
  const { rowCount } = await client.query(
    `UPDATE candidaturas SET escala_id = $2
     WHERE escala_id = $1 AND igreja_id = $3`,
    [sourceId, targetId, igrejaId],
  );
  return rowCount || 0;
}

const BULK_DELETE_ESCALAS_MAX = 100;

/**
 * Exclui várias escalas de uma vez (mesmas regras de redirect/force que pgDeleteEscala).
 */
export async function pgBulkDeleteEscalas(rawIds, igrejaId, opts = {}) {
  const ids = [...new Set((rawIds || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, BULK_DELETE_ESCALAS_MAX);
  if (!ids.length) return { deleted: 0, error: 'Nenhuma escala informada.' };

  const redirectToEscalaId = (opts.redirectToEscalaId || '').trim() || null;
  const forceWithoutRedirect = opts.forceWithoutRedirect === true;

  if (redirectToEscalaId && ids.includes(String(redirectToEscalaId))) {
    return { deleted: 0, error: 'A escala de destino não pode estar na lista de exclusão.' };
  }

  const pool = getPostgresPool();
  const { rows: found } = await pool.query(
    'SELECT id FROM escalas WHERE igreja_id = $1 AND id = ANY($2::text[])',
    [igrejaId, ids],
  );
  if (found.length !== ids.length) {
    return { deleted: 0, error: 'Uma ou mais escalas não foram encontradas.' };
  }

  const { rows: candRows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM candidaturas
     WHERE igreja_id = $1 AND escala_id = ANY($2::text[])`,
    [igrejaId, ids],
  );
  const totalCandidaturas = candRows[0]?.c || 0;

  if (totalCandidaturas > 0 && !redirectToEscalaId && !forceWithoutRedirect) {
    return { deleted: 0, candidaturas: totalCandidaturas, needRedirect: true, ids };
  }

  if (totalCandidaturas > 0 && redirectToEscalaId) {
    const target = await pgFindEscalaById(redirectToEscalaId, igrejaId);
    for (const id of ids) {
      const check = pgValidateEscalaRedirectTarget(target, id);
      if (!check.ok) return { deleted: 0, error: check.error, candidaturas: totalCandidaturas };
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const evtIds = await pgCollectEventoCheckinIdsFromEscalas(client, igrejaId, ids);
    let totalMoved = 0;
    let deleted = 0;
    for (const id of ids) {
      const { rows: cRow } = await client.query(
        'SELECT COUNT(*)::int AS c FROM candidaturas WHERE escala_id = $1 AND igreja_id = $2',
        [id, igrejaId],
      );
      const count = cRow[0]?.c || 0;
      if (count > 0 && redirectToEscalaId) {
        totalMoved += await pgMoveCandidaturasBetweenEscalas(client, id, redirectToEscalaId, igrejaId);
      }
      const { rowCount } = await client.query(
        'DELETE FROM escalas WHERE id = $1 AND igreja_id = $2',
        [id, igrejaId],
      );
      if (rowCount) deleted += 1;
    }
    const eventosCheckinRemoved = deleted
      ? await pgPurgeOrphanEventosCheckinCandidates(client, igrejaId, evtIds)
      : { eventos: 0, checkins: 0 };
    await client.query('COMMIT');
    return {
      deleted,
      moved: totalMoved,
      redirectedTo: redirectToEscalaId,
      candidaturas: totalCandidaturas,
      eventosCheckinRemoved,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function pgGetEscalaInscricaoStatus(escalaId, ministerio) {
  const { rows } = await getPostgresPool().query(
    'SELECT ativo FROM escala_inscricoes_por_ministerio WHERE escala_id = $1 AND ministerio = $2 LIMIT 1',
    [escalaId, ministerio],
  );
  if (!rows.length) return { ativo: true };
  return { ativo: rows[0].ativo !== false };
}

export async function pgSetEscalaInscricaoStatus(escalaId, ministerio, ativo, criadoPor = null) {
  await getPostgresPool().query(
    `INSERT INTO escala_inscricoes_por_ministerio (escala_id, ministerio, ativo, criado_por)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (escala_id, ministerio)
     DO UPDATE SET ativo = EXCLUDED.ativo, updated_at = NOW()`,
    [escalaId, ministerio, !!ativo, criadoPor],
  );
  return { ativo: !!ativo };
}

export async function pgCountCandidaturasByEscala(igrejaId, escalaIds) {
  if (!escalaIds.length) return new Map();
  const { rows } = await getPostgresPool().query(
    `SELECT escala_id, COUNT(*)::int AS total,
      SUM(CASE WHEN (dados->>'status') = 'aprovado' THEN 1 ELSE 0 END)::int AS aprovados
     FROM candidaturas WHERE igreja_id = $1 AND escala_id = ANY($2::text[])
     GROUP BY escala_id`,
    [igrejaId, escalaIds],
  );
  return new Map(rows.map((r) => [String(r.escala_id), { total: r.total, aprovados: r.aprovados }]));
}

/**
 * Lista eventos de check-in com smart sort (futuros asc, depois passados desc).
 * - nextPerCultoOnly: 1 evento futuro por culto recorrente.
 * - futureOnly: ignora datas passadas.
 * - limit: corte de segurança (default 500).
 */
export async function pgListEventosCheckin(igrejaId, {
  ativoOnly = false, dataYmd = null, nextPerCultoOnly = false, futureOnly = false, limit = 500,
} = {}) {
  let sql = `SELECT id, igreja_id, data, label, ativo, horario_inicio, horario_fim,
    culto_recorrente_id, auto_gerado, criado_por, created_at, email_abertura_enviado_em
    FROM eventos_checkin WHERE igreja_id = $1`;
  const params = [igrejaId];
  if (ativoOnly) sql += ' AND ativo = TRUE';
  if (dataYmd) {
    params.push(dataYmd);
    sql += ` AND data = $${params.length}::date`;
  } else if (futureOnly) {
    sql += " AND data >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')::date";
  }
  sql += `
    ORDER BY
      CASE WHEN data >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')::date THEN 0 ELSE 1 END,
      CASE WHEN data >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')::date THEN data END ASC NULLS LAST,
      CASE WHEN data <  (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')::date THEN data END DESC NULLS LAST,
      created_at DESC`;
  params.push(limit);
  sql += ` LIMIT $${params.length}`;
  const { rows } = await getPostgresPool().query(sql, params);
  let eventos = rows.map(mapEventoRow);
  if (nextPerCultoOnly) {
    eventos = filterNextPerCulto(eventos);
  }
  return eventos;
}

export async function pgListEventosCheckinHoje(igrejaId) {
  return pgListEventosCheckin(igrejaId, { ativoOnly: true, dataYmd: getHojeDateString() });
}

/** Evento de check-in ativo no mesmo dia civil (Brasília) da escala. */
export async function pgFindEventoCheckinPorData(igrejaId, dataYmd) {
  const list = await pgListEventosCheckin(igrejaId, { ativoOnly: true, dataYmd });
  return list[0] || null;
}

/**
 * Escolhe o evento de check-in mais adequado para uma escala dentre os ativos na mesma data.
 * Exportada para testes; a versão async busca eventos e delega aqui.
 */
export function pickEventoCheckinForEscala(escala, eventosOnDate) {
  const list = eventosOnDate || [];
  if (!escala || !list.length) return null;

  const cultoId = escala.cultoRecorrenteId ? String(escala.cultoRecorrenteId) : null;
  if (cultoId) {
    const matches = list.filter(
      (e) => e.cultoRecorrenteId && String(e.cultoRecorrenteId) === cultoId,
    );
    if (matches.length === 1) return matches[0];
  }

  if (list.length === 1) return list[0];
  return null;
}

/**
 * Resolve o evento de check-in para uma escala:
 * 1. escala.eventoCheckinId (se definido)
 * 2. culto_recorrente_id + mesma data
 * 3. único evento na data (retrocompat)
 */
export async function pgResolveEventoCheckinForEscala(igrejaId, escala) {
  if (!escala) return null;

  if (escala.eventoCheckinId) {
    const linked = await pgFindEventoCheckinById(escala.eventoCheckinId, igrejaId);
    if (linked) return linked;
  }

  const ymd = escalaDataToYMD(escala.data);
  if (!ymd) return null;

  const eventosOnDate = await pgListEventosCheckin(igrejaId, { ativoOnly: true, dataYmd: ymd });
  return pickEventoCheckinForEscala(escala, eventosOnDate);
}

export async function pgFindEventoCheckinById(id, igrejaId = null) {
  const params = [id];
  let sql = `SELECT id, igreja_id, data, label, ativo, horario_inicio, horario_fim,
    culto_recorrente_id, auto_gerado, criado_por, created_at, email_abertura_enviado_em
    FROM eventos_checkin WHERE id = $1`;
  if (igrejaId) {
    params.push(igrejaId);
    sql += ' AND igreja_id = $2';
  }
  const { rows } = await getPostgresPool().query(sql, params);
  return mapEventoRow(rows[0]);
}

export async function pgCreateEventoCheckin({
  igrejaId, dataYmd, label, ativo = true, horarioInicio = '', horarioFim = '',
  criadoPor = null, cultoRecorrenteId = null, autoGerado = false,
}) {
  const id = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO eventos_checkin (
      id, igreja_id, data, label, ativo, horario_inicio, horario_fim,
      culto_recorrente_id, auto_gerado, criado_por
    ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id, igrejaId, dataYmd, label, !!ativo,
      horarioInicio || '', horarioFim || '',
      cultoRecorrenteId, !!autoGerado, criadoPor,
    ],
  );
  return pgFindEventoCheckinById(id, igrejaId);
}

export async function pgUpdateEventoCheckin(id, igrejaId, patch) {
  const current = await pgFindEventoCheckinById(id, igrejaId);
  if (!current) return null;
  let dataYmd = null;
  if (patch.data !== undefined) {
    if (patch.data == null || patch.data === '') return null;
    dataYmd = typeof patch.data === 'string'
      ? patch.data.trim().slice(0, 10)
      : escalaDataToYMD(patch.data);
    if (!dataYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dataYmd)) return null;
  }
  await getPostgresPool().query(
    `UPDATE eventos_checkin SET
      label = COALESCE($3, label),
      ativo = COALESCE($4, ativo),
      horario_inicio = COALESCE($5, horario_inicio),
      horario_fim = COALESCE($6, horario_fim),
      data = COALESCE($7::date, data)
     WHERE id = $1 AND igreja_id = $2`,
    [
      id,
      igrejaId,
      patch.label !== undefined ? patch.label : null,
      patch.ativo !== undefined ? patch.ativo : null,
      patch.horarioInicio !== undefined ? patch.horarioInicio : null,
      patch.horarioFim !== undefined ? patch.horarioFim : null,
      dataYmd,
    ],
  );
  return pgFindEventoCheckinById(id, igrejaId);
}

export async function pgDeleteEventoCheckin(id, igrejaId) {
  const r = await pgBulkDeleteEventosCheckin([id], igrejaId);
  return (r.deleted || 0) > 0;
}

const BULK_DELETE_EVENTOS_CHECKIN_MAX = 100;

async function pgUnlinkEscalasFromEventosCheckin(executor, igrejaId, eventoIds) {
  if (!eventoIds?.length) return 0;
  const { rowCount } = await executor.query(
    `UPDATE escalas SET dados = (dados - 'eventoCheckinId')
      || jsonb_build_object('updatedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     WHERE igreja_id = $1 AND (dados->>'eventoCheckinId') = ANY($2::text[])`,
    [igrejaId, eventoIds],
  );
  return rowCount || 0;
}

/** Exclui vários eventos de check-in; desvincula escalas e culto_ocorrencias (CASCADE/SET NULL). */
export async function pgBulkDeleteEventosCheckin(rawIds, igrejaId) {
  const ids = [...new Set((rawIds || []).map((x) => String(x).trim()).filter(Boolean))]
    .slice(0, BULK_DELETE_EVENTOS_CHECKIN_MAX);
  if (!ids.length) return { deleted: 0, error: 'Nenhum evento informado.' };

  const pool = getPostgresPool();
  const { rows: found } = await pool.query(
    'SELECT id FROM eventos_checkin WHERE igreja_id = $1 AND id = ANY($2::text[])',
    [igrejaId, ids],
  );
  if (found.length !== ids.length) {
    return { deleted: 0, error: 'Um ou mais eventos não foram encontrados.' };
  }

  const { rows: ckRows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM checkins WHERE igreja_id = $1 AND evento_id = ANY($2::text[])`,
    [igrejaId, ids],
  );
  const checkinsCount = ckRows[0]?.c || 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const escalasUnlinked = await pgUnlinkEscalasFromEventosCheckin(client, igrejaId, ids);
    const removed = await pgDeleteEventosCheckinComRegistros(client, igrejaId, ids);
    await client.query('COMMIT');
    return {
      deleted: removed.eventos,
      checkinsDeleted: removed.checkins,
      checkinsCount: removed.checkins,
      escalasUnlinked,
      ids,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Eventos de hoje, ativos, janela de check-in aberta, email de abertura ainda não enviado. */
export async function pgListEventosCheckinAberturaEmailPendentes() {
  const hoje = getHojeDateString();
  const { rows } = await getPostgresPool().query(
    `SELECT id, igreja_id, data, label, ativo, horario_inicio, horario_fim,
            culto_recorrente_id, auto_gerado, criado_por, created_at, email_abertura_enviado_em
     FROM eventos_checkin
     WHERE ativo = TRUE AND data = $1::date AND email_abertura_enviado_em IS NULL`,
    [hoje],
  );
  return rows.map(mapEventoRow).filter((e) => isCheckinEventAberto(e));
}

export async function pgMarkEventoAberturaEmailEnviado(id, igrejaId) {
  await getPostgresPool().query(
    `UPDATE eventos_checkin SET email_abertura_enviado_em = NOW()
     WHERE id = $1 AND igreja_id = $2`,
    [id, igrejaId],
  );
}

/** Reserva o envio (evita duplicata entre jobs/instâncias). Retorna null se já enviado. */
export async function pgTryClaimEventoAberturaEmail(id, igrejaId) {
  const { rows } = await getPostgresPool().query(
    `UPDATE eventos_checkin SET email_abertura_enviado_em = NOW()
     WHERE id = $1 AND igreja_id = $2 AND email_abertura_enviado_em IS NULL
     RETURNING id, igreja_id, data, label, ativo, horario_inicio, horario_fim,
               culto_recorrente_id, auto_gerado, criado_por, created_at, email_abertura_enviado_em`,
    [id, igrejaId],
  );
  return rows[0] ? mapEventoRow(rows[0]) : null;
}

export async function pgClearEventoAberturaEmailEnviado(id, igrejaId) {
  await getPostgresPool().query(
    `UPDATE eventos_checkin SET email_abertura_enviado_em = NULL
     WHERE id = $1 AND igreja_id = $2`,
    [id, igrejaId],
  );
}

/** Reserva envio por destinatário (máx. 1 email de abertura por pessoa/evento). */
export async function pgTryClaimCheckinAberturaEmail(igrejaId, email, eventoId) {
  const em = String(email || '').toLowerCase().trim();
  const evId = String(eventoId || '').trim();
  if (!em || !evId || !igrejaId) return false;
  const { rows } = await getPostgresPool().query(
    `INSERT INTO checkin_abertura_emails (igreja_id, email, evento_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (igreja_id, email, evento_id) DO NOTHING
     RETURNING email`,
    [igrejaId, em, evId],
  );
  return rows.length > 0;
}

/** Libera reserva se o envio falhar (permite nova tentativa). */
export async function pgReleaseCheckinAberturaEmail(igrejaId, email, eventoId) {
  const em = String(email || '').toLowerCase().trim();
  const evId = String(eventoId || '').trim();
  if (!em || !evId || !igrejaId) return;
  await getPostgresPool().query(
    `DELETE FROM checkin_abertura_emails
     WHERE igreja_id = $1 AND email = $2 AND evento_id = $3`,
    [igrejaId, em, evId],
  );
}

/** Limpa registros do evento (reenvio manual com force). */
export async function pgClearCheckinAberturaEmailsForEvento(igrejaId, eventoId) {
  const evId = String(eventoId || '').trim();
  if (!evId || !igrejaId) return 0;
  const { rowCount } = await getPostgresPool().query(
    `DELETE FROM checkin_abertura_emails
     WHERE igreja_id = $1 AND evento_id = $2`,
    [igrejaId, evId],
  );
  return rowCount || 0;
}

/**
 * Vincula uma escala ao evento de check-in correspondente.
 * Se `eventoCheckinId` for null, busca um evento na mesma data da escala.
 */
export async function pgLinkEscalaToEvento(escalaId, igrejaId, eventoCheckinId = null) {
  const escala = await pgFindEscalaById(escalaId, igrejaId);
  if (!escala) return null;
  let evtId = eventoCheckinId;
  if (!evtId) {
    const evt = await pgResolveEventoCheckinForEscala(igrejaId, escala);
    evtId = evt?._id || null;
  }
  if (!evtId) return escala;
  return pgUpdateEscala(escalaId, igrejaId, { eventoCheckinId: evtId });
}

/**
 * Migração: para cada escala sem `eventoCheckinId`, se existir UM único
 * evento_checkin ativo na mesma data, vincula automaticamente.
 * Idempotente e seguro de rodar em todo boot.
 */
export async function pgAutoLinkEscalasOrfas(igrejaId = null) {
  const params = [];
  let where = "(dados->>'eventoCheckinId') IS NULL";
  if (igrejaId) {
    params.push(igrejaId);
    where += ` AND igreja_id = $${params.length}`;
  }
  const { rows } = await getPostgresPool().query(
    `SELECT id, igreja_id, dados FROM escalas WHERE ${where}`,
    params,
  );
  let vinculadas = 0;
  for (const row of rows) {
    const escala = mapEscalaRow(row);
    const evt = await pgResolveEventoCheckinForEscala(row.igreja_id, escala);
    if (evt?._id) {
      await pgUpdateEscala(row.id, row.igreja_id, { eventoCheckinId: evt._id });
      vinculadas += 1;
    }
  }
  return vinculadas;
}

/**
 * Corrige escalas cujo eventoCheckinId diverge de culto_ocorrencias
 * (ex.: dois cultos no mesmo dia que apontavam para o mesmo check-in).
 */
export async function pgRepairEscalaEventoLinksFromOcorrencias(igrejaId = null) {
  const params = [];
  let sql = `
    SELECT co.igreja_id, co.escala_id, co.evento_checkin_id
    FROM culto_ocorrencias co
    WHERE co.escala_id IS NOT NULL AND co.evento_checkin_id IS NOT NULL`;
  if (igrejaId) {
    params.push(igrejaId);
    sql += ` AND co.igreja_id = $${params.length}`;
  }
  const { rows } = await getPostgresPool().query(sql, params);
  let corrigidas = 0;
  for (const row of rows) {
    const escala = await pgFindEscalaById(row.escala_id, row.igreja_id);
    if (!escala) continue;
    if (String(escala.eventoCheckinId || '') === String(row.evento_checkin_id)) continue;
    await pgUpdateEscala(row.escala_id, row.igreja_id, { eventoCheckinId: row.evento_checkin_id });
    corrigidas += 1;
  }
  return corrigidas;
}

/** Busca a escala vinculada a um evento de check-in (se houver). */
export async function pgFindEscalaByEventoCheckin(igrejaId, eventoCheckinId) {
  const list = await pgListEscalasByEventoCheckin(igrejaId, eventoCheckinId);
  return list[0] || null;
}

/** Todas as escalas vinculadas a um evento de check-in. */
export async function pgListEscalasByEventoCheckin(igrejaId, eventoCheckinId) {
  if (!eventoCheckinId) return [];
  const { rows } = await getPostgresPool().query(
    `SELECT id, igreja_id, dados, created_at FROM escalas
     WHERE igreja_id = $1 AND NULLIF(trim(dados->>'eventoCheckinId'), '') = $2
     ORDER BY (dados->>'data')::timestamptz ASC NULLS LAST, (dados->>'nome') ASC NULLS LAST`,
    [igrejaId, eventoCheckinId],
  );
  return rows.map(mapEscalaRow);
}

/** Anexa escalasVinculadas[] a cada evento (admin). */
export async function pgAttachEscalasVinculadasToEventos(igrejaId, eventos) {
  if (!eventos?.length) return eventos || [];
  const ids = eventos.map((e) => String(e._id));
  const { rows } = await getPostgresPool().query(
    `SELECT id,
            dados->>'nome' AS nome,
            dados->>'data' AS data_raw,
            (dados->>'ativo')::boolean AS ativo,
            NULLIF(trim(dados->>'eventoCheckinId'), '') AS evt_id
     FROM escalas
     WHERE igreja_id = $1 AND NULLIF(trim(dados->>'eventoCheckinId'), '') = ANY($2::text[])`,
    [igrejaId, ids],
  );
  const byEvt = new Map();
  for (const r of rows) {
    const k = String(r.evt_id);
    if (!byEvt.has(k)) byEvt.set(k, []);
    byEvt.get(k).push({
      _id: r.id,
      nome: r.nome || '',
      data: r.data_raw,
      ativo: r.ativo !== false,
    });
  }
  return eventos.map((e) => ({
    ...e,
    escalasVinculadas: byEvt.get(String(e._id)) || [],
  }));
}

/** Opções para UI: escalas ativas + vínculos atuais do evento. */
export async function pgGetEventoCheckinVinculoEscalas(igrejaId, eventoId) {
  const evento = await pgFindEventoCheckinById(eventoId, igrejaId);
  if (!evento) return null;
  const vinculadas = await pgListEscalasByEventoCheckin(igrejaId, eventoId);
  const eventoYmd = escalaDataToYMD(evento.data);
  const { rows } = await getPostgresPool().query(
    `SELECT id, igreja_id, dados, created_at FROM escalas
     WHERE igreja_id = $1 AND (dados->>'ativo')::boolean IS DISTINCT FROM FALSE
     ORDER BY (dados->>'data')::timestamptz DESC NULLS LAST, created_at DESC`,
    [igrejaId],
  );
  const candidatas = rows.map(mapEscalaRow).map((e) => {
    const ymd = escalaDataToYMD(e.data);
    const evtLink = e.eventoCheckinId ? String(e.eventoCheckinId) : '';
    return {
      _id: e._id,
      nome: e.nome,
      data: e.data,
      dataYmd: ymd,
      eventoCheckinId: evtLink || null,
      vinculadaAEste: evtLink === String(eventoId),
      mesmaData: !!(eventoYmd && ymd && ymd === eventoYmd),
      temOutroEvento: !!(evtLink && evtLink !== String(eventoId)),
    };
  });
  candidatas.sort((a, b) => {
    if (a.vinculadaAEste !== b.vinculadaAEste) return a.vinculadaAEste ? 1 : -1;
    if (a.mesmaData !== b.mesmaData) return a.mesmaData ? -1 : 1;
    if (a.temOutroEvento !== b.temOutroEvento) return a.temOutroEvento ? 1 : -1;
    return (b.dataYmd || '').localeCompare(a.dataYmd || '');
  });
  return { evento, vinculadas, candidatas };
}

/** Vincula evento de check-in avulso a uma escala ativa (atualiza eventoCheckinId na escala). */
export async function pgAssociarEventoCheckinAEscala({
  eventoId, escalaId, igrejaId, forceReplace = false,
}) {
  const evento = await pgFindEventoCheckinById(eventoId, igrejaId);
  if (!evento) return { ok: false, error: 'Evento não encontrado.' };
  const escala = await pgFindEscalaById(escalaId, igrejaId);
  if (!escala) return { ok: false, error: 'Escala não encontrada.' };
  if (escala.ativo === false) return { ok: false, error: 'A escala precisa estar ativa.' };

  const atual = escala.eventoCheckinId ? String(escala.eventoCheckinId) : '';
  const alvo = String(eventoId);
  if (atual === alvo) {
    return { ok: true, escala, evento, alreadyLinked: true };
  }
  if (atual && atual !== alvo && !forceReplace) {
    return {
      ok: false,
      needConfirm: true,
      error: 'Esta escala já está vinculada a outro evento de check-in.',
      escalaEventoAtualId: atual,
    };
  }

  const updated = await pgUpdateEscala(escalaId, igrejaId, { eventoCheckinId: alvo });
  return {
    ok: true,
    escala: updated,
    evento,
    replaced: !!(atual && atual !== alvo),
  };
}

export async function pgAutoCloseEscalasVencidas(igrejaId) {
  const hoje = getHojeDateString();
  const { rows } = await getPostgresPool().query(
    "SELECT id, dados FROM escalas WHERE igreja_id = $1 AND (dados->>'ativo')::boolean IS DISTINCT FROM FALSE",
    [igrejaId],
  );
  let fechadas = 0;
  for (const row of rows) {
    const ymd = escalaDataToYMD(row.dados?.data);
    if (ymd && ymd < hoje) {
      await pgUpdateEscala(row.id, igrejaId, { ativo: false });
      fechadas += 1;
    }
  }
  return fechadas;
}

/** Reabre escalas do dia que foram fechadas antes da hora (corrige auto-close legado). */
export async function pgReabrirEscalasDoDia(igrejaId = null) {
  const hoje = getHojeDateString();
  const params = [hoje];
  let sql = `
    UPDATE escalas
    SET dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{ativo}', 'true'::jsonb, true)
    WHERE (dados->>'data')::date = $1::date
      AND (dados->>'ativo')::boolean IS FALSE`;
  if (igrejaId) {
    params.push(igrejaId);
    sql += ` AND igreja_id = $${params.length}`;
  }
  sql += ' RETURNING id';
  const { rows } = await getPostgresPool().query(sql, params);
  return rows.length;
}

export async function pgCreateCheckin({
  igrejaId, eventoId, email, nome, ministerio, batizado, userId = null,
}) {
  const evento = await pgFindEventoCheckinById(eventoId, igrejaId);
  if (!evento) return { error: 'not_found' };
  if (!isCheckinEventAberto(evento)) return { error: 'not_found' };
  const eventDateStr = escalaDataToYMD(evento.data);
  const { start: dataCheckin } = getDayRangeBrasilia(eventDateStr);
  const em = email.toLowerCase();
  const { rows: existing } = await getPostgresPool().query(
    `SELECT id FROM checkins WHERE igreja_id = $1 AND evento_id = $2 AND LOWER(email) = $3
     AND data_checkin >= $4 AND data_checkin < $5 LIMIT 1`,
    [igrejaId, eventoId, em, dataCheckin, new Date(dataCheckin.getTime() + 86400000)],
  );
  if (existing.length) {
    if (batizado === true || batizado === false) {
      try {
        await pgSyncBatizadoPerfilFromCheckin(igrejaId, em, nome || '', ministerio || '', batizado);
      } catch (_) {}
    }
    return { duplicate: true, id: existing[0].id };
  }

  // Tenta vincular automaticamente a uma candidatura aprovada do mesmo email
  // para uma escala que aponta para este evento_checkin (Fase 2 da integração).
  let candidaturaId = null;
  try {
    const { rows: cands } = await getPostgresPool().query(
      `SELECT c.id
       FROM candidaturas c
       JOIN escalas e ON e.id = c.escala_id
       WHERE c.igreja_id = $1
         AND e.dados->>'eventoCheckinId' = $2
         AND LOWER(c.dados->>'email') = $3
         AND (c.dados->>'status') = 'aprovado'
       ORDER BY c.created_at DESC
       LIMIT 1`,
      [igrejaId, eventoId, em],
    );
    candidaturaId = cands[0]?.id || null;
  } catch (err) {
    // Coluna candidatura_id pode não existir antes da migração rodar; segue sem vínculo.
    candidaturaId = null;
  }

  const id = randomUUID();
  const now = Date.now();
  await getPostgresPool().query(
    `INSERT INTO checkins (id, igreja_id, evento_id, email, nome, ministerio, batizado, data_checkin, timestamp_ms, candidatura_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id, igrejaId, eventoId, em, nome || '', ministerio || '',
      batizado == null ? null : (batizado ? 'sim' : 'nao'),
      dataCheckin, now, candidaturaId,
    ],
  );
  try {
    await pgSyncBatizadoPerfilFromCheckin(igrejaId, em, nome || '', ministerio || '', batizado);
  } catch (_) {}
  return { id, created: true, candidaturaId };
}

/**
 * Totais de acompanhamento de escala.
 * Presente = inscrito na escala (não desistiu/falta) com check-in no culto, mesmo sem aprovação.
 */
export function computeAcompanhamentoTotals(itens, eventoEncerrado) {
  let aprovados = 0;
  let inscritos = 0;
  let presentes = 0;
  let faltaram = 0;
  let pendentes = 0;
  for (const it of itens || []) {
    const st = it.status || 'pendente';
    const cancelado = st === 'desistencia' || st === 'falta';
    const aprovado = st === 'aprovado';
    if (!cancelado) inscritos += 1;
    if (aprovado) aprovados += 1;
    if (it.compareceu && !cancelado) {
      presentes += 1;
    } else if (aprovado && eventoEncerrado) {
      faltaram += 1;
    } else if (aprovado) {
      pendentes += 1;
    }
  }
  const taxaBase = inscritos > 0 ? inscritos : aprovados;
  const taxa = taxaBase > 0 ? Math.round((presentes / taxaBase) * 100) : 0;
  return { aprovados, inscritos, presentes, faltaram, pendentes, taxa };
}

/**
 * Retorna lista de candidaturas aprovadas de uma escala com status de presença:
 *  { _id, nome, email, ministerio, status, compareceu (bool), checkinId, checkinTimestamp }
 * "compareceu" é true se houver check-in com candidatura_id correspondente,
 * OU (fallback) se o evento_checkin vinculado à escala tiver check-in do mesmo email.
 */
export async function pgListAcompanhamentoEscala(igrejaId, escalaId) {
  const escala = await pgFindEscalaById(escalaId, igrejaId);
  if (!escala) return null;
  const evtId = escala.eventoCheckinId || null;
  const { rows: cands } = await getPostgresPool().query(
    `SELECT id, dados, created_at FROM candidaturas
     WHERE igreja_id = $1 AND escala_id = $2
     ORDER BY created_at ASC`,
    [igrejaId, escalaId],
  );
  // Map check-ins por candidatura_id e por email (fallback)
  const byCandId = new Map();
  const byEmail = new Map();
  if (evtId) {
    const { rows: checks } = await getPostgresPool().query(
      `SELECT id, email, candidatura_id, timestamp_ms, data_checkin
       FROM checkins WHERE igreja_id = $1 AND evento_id = $2`,
      [igrejaId, evtId],
    );
    for (const c of checks) {
      if (c.candidatura_id) byCandId.set(c.candidatura_id, c);
      if (c.email) byEmail.set(String(c.email).toLowerCase(), c);
    }
  }
  return cands.map((row) => {
    const d = row.dados || {};
    const email = String(d.email || '').toLowerCase();
    const hit = byCandId.get(row.id) || byEmail.get(email) || null;
    return {
      _id: row.id,
      nome: d.nome || '',
      email: d.email || '',
      ministerio: d.ministerio || '',
      status: d.status || 'pendente',
      inscritoEm: row.created_at,
      compareceu: !!hit,
      checkinId: hit?.id || null,
      checkinTimestamp: hit?.timestamp_ms || (hit?.data_checkin ? new Date(hit.data_checkin).getTime() : null),
    };
  });
}

/**
 * Lista candidaturas do email para um conjunto de escalas.
 * Retorna Map<escalaId, { _id, status, ministerio, createdAt }>.
 */
export async function pgListMinhasCandidaturasParaEscalas(igrejaId, email, escalaIds) {
  if (!email || !escalaIds?.length) return new Map();
  const { rows } = await getPostgresPool().query(
    `SELECT id, escala_id, dados, created_at FROM candidaturas
     WHERE igreja_id = $1 AND escala_id = ANY($2::text[])
       AND LOWER(dados->>'email') = $3`,
    [igrejaId, escalaIds, String(email).toLowerCase()],
  );
  return new Map(rows.map((r) => [String(r.escala_id), {
    _id: r.id,
    status: r.dados?.status || 'pendente',
    ministerio: r.dados?.ministerio || '',
    createdAt: r.created_at,
  }]));
}

/** Carrega eventos_checkin pelos ids em lote. */
export async function pgFindEventosCheckinByIds(igrejaId, ids) {
  if (!ids?.length) return new Map();
  const { rows } = await getPostgresPool().query(
    `SELECT id, data, label, ativo, inicio_checkin, fim_checkin
     FROM eventos_checkin WHERE igreja_id = $1 AND id = ANY($2::text[])`,
    [igrejaId, ids],
  );
  return new Map(rows.map((r) => [String(r.id), {
    _id: r.id,
    data: r.data,
    label: r.label,
    ativo: r.ativo,
    inicioCheckin: r.inicio_checkin,
    fimCheckin: r.fim_checkin,
  }]));
}

/** Check-ins do email para conjunto de eventos. */
export async function pgListMeusCheckins(igrejaId, email, eventoIds) {
  if (!email || !eventoIds?.length) return new Map();
  const { rows } = await getPostgresPool().query(
    `SELECT id, evento_id, timestamp_ms FROM checkins
     WHERE igreja_id = $1 AND evento_id = ANY($2::text[]) AND LOWER(email) = $3`,
    [igrejaId, eventoIds, String(email).toLowerCase()],
  );
  return new Map(rows.map((r) => [String(r.evento_id), { id: r.id, timestampMs: r.timestamp_ms }]));
}

/** Escalas em que o voluntário tem candidatura (inclui inativas — ex.: culto de hoje). */
export async function pgListEscalasByCandidaturaEmail(igrejaId, email, { fromYmd = null } = {}) {
  const em = String(email || '').trim().toLowerCase();
  if (!em || !igrejaId) return [];
  const params = [igrejaId, em];
  let dateFilter = '';
  if (fromYmd) {
    params.push(String(fromYmd).slice(0, 10));
    dateFilter = ` AND (e.dados->>'data')::date >= $${params.length}::date`;
  }
  const { rows } = await getPostgresPool().query(
    `SELECT DISTINCT ON (e.id) e.id, e.igreja_id, e.dados, e.created_at
     FROM escalas e
     INNER JOIN candidaturas c ON c.escala_id = e.id AND c.igreja_id = e.igreja_id
     WHERE e.igreja_id = $1 AND LOWER(c.dados->>'email') = $2${dateFilter}
     ORDER BY e.id, (e.dados->>'data')::timestamptz ASC NULLS LAST`,
    params,
  );
  return rows.map(mapEscalaRow);
}

/**
 * Marca como `falta` candidaturas aprovadas cujo evento de check-in vinculado
 * já encerrou (fim_checkin < agora) e que não têm check-in registrado.
 * Idempotente; retorna nº de candidaturas atualizadas.
 */
export async function pgAutoMarcarFaltas(igrejaId = null) {
  const params = [];
  let where = "(c.dados->>'status') = 'aprovado'";
  if (igrejaId) {
    params.push(igrejaId);
    where += ` AND c.igreja_id = $${params.length}`;
  }
  const sql = `
    UPDATE candidaturas c
    SET dados = jsonb_set(c.dados, '{status}', '"falta"', true)
    FROM escalas e, eventos_checkin ec
    WHERE ${where}
      AND e.id = c.escala_id
      AND e.igreja_id = c.igreja_id
      AND ec.id = (e.dados->>'eventoCheckinId')
      AND ec.fim_checkin IS NOT NULL
      AND ec.fim_checkin < NOW()
      AND NOT EXISTS (
        SELECT 1 FROM checkins ch
        WHERE ch.igreja_id = c.igreja_id
          AND ch.evento_id = ec.id
          AND LOWER(ch.email) = LOWER(c.dados->>'email')
      )
  `;
  const { rowCount } = await getPostgresPool().query(sql, params);
  return rowCount || 0;
}

/**
 * Backfill manual: vincula check-ins existentes a candidaturas aprovadas pela
 * heurística (igreja, evento_checkin associado à escala, mesmo email, aprovado).
 * Idempotente. Retorna nº de check-ins atualizados.
 */
export async function pgBackfillCheckinCandidaturas(igrejaId = null) {
  const params = [];
  let where = 'ch.candidatura_id IS NULL';
  if (igrejaId) {
    params.push(igrejaId);
    where += ` AND ch.igreja_id = $${params.length}`;
  }
  const sql = `
    UPDATE checkins ch SET candidatura_id = c.id
    FROM candidaturas c, escalas e
    WHERE ${where}
      AND e.id = c.escala_id
      AND e.igreja_id = ch.igreja_id
      AND e.dados->>'eventoCheckinId' = ch.evento_id
      AND LOWER(c.dados->>'email') = LOWER(ch.email)
      AND c.dados->>'status' = 'aprovado'
  `;
  const { rowCount } = await getPostgresPool().query(sql, params);
  return rowCount || 0;
}

export function getEventDateStringFromPg(evento) {
  return escalaDataToYMD(evento?.data);
}

export async function pgCreateCandidatura({
  igrejaId, escalaId, nome, email, telefone, ministerio, status = 'pendente',
}) {
  const id = randomUUID();
  const dados = {
    nome: String(nome || '').trim(),
    email: String(email || '').trim().toLowerCase(),
    telefone: String(telefone || '').trim(),
    ministerio: String(ministerio || '').trim(),
    status,
    emailEnviado: false,
    createdAt: new Date().toISOString(),
  };
  await getPostgresPool().query(
    'INSERT INTO candidaturas (id, igreja_id, escala_id, dados) VALUES ($1, $2, $3, $4::jsonb)',
    [id, igrejaId, escalaId, JSON.stringify(dados)],
  );
  return { _id: id, ...dados, escalaId, igrejaId };
}

export async function pgListCandidaturasByEscalaIds(igrejaId, escalaIds) {
  if (!escalaIds?.length) return [];
  const { rows } = await getPostgresPool().query(
    'SELECT id, escala_id, dados FROM candidaturas WHERE igreja_id = $1 AND escala_id = ANY($2::text[])',
    [igrejaId, escalaIds],
  );
  return rows.map((r) => {
    const d = r.dados || {};
    return {
      _id: r.id,
      escalaId: r.escala_id,
      email: d.email || '',
      nome: d.nome || '',
      ministerio: d.ministerio || '',
      status: d.status || 'pendente',
    };
  });
}

export async function pgFindCandidaturaDuplicada(igrejaId, escalaId, email) {
  const { rows } = await getPostgresPool().query(
    `SELECT id FROM candidaturas
     WHERE igreja_id = $1 AND escala_id = $2 AND LOWER(dados->>'email') = $3 LIMIT 1`,
    [igrejaId, escalaId, email.toLowerCase()],
  );
  return rows[0]?.id || null;
}
