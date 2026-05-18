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
    // Compara como YMD em Brasília (TZ fixa no fuso do servidor): pega o início do dia hoje.
    sql += " AND (dados->>'data')::timestamptz >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo')";
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
    const ymd = it?.data instanceof Date ? it.data.toISOString().slice(0, 10) : (typeof it?.data === 'string' ? it.data.slice(0, 10) : null);
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
    'SELECT id, igreja_id, data_ymd, dados, created_at FROM escalas WHERE igreja_id = $1 AND id = ANY($2::text[])',
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

export async function pgDeleteEscala(id, igrejaId) {
  const { rows } = await getPostgresPool().query(
    'SELECT COUNT(*)::int AS c FROM candidaturas WHERE escala_id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  const count = rows[0]?.c || 0;
  if (count > 0) return { deleted: false, candidaturas: count };
  const { rowCount } = await getPostgresPool().query(
    'DELETE FROM escalas WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  return { deleted: rowCount > 0, candidaturas: 0 };
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
    culto_recorrente_id, auto_gerado, criado_por, created_at
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

export async function pgFindEventoCheckinById(id, igrejaId = null) {
  const params = [id];
  let sql = `SELECT id, igreja_id, data, label, ativo, horario_inicio, horario_fim,
    culto_recorrente_id, auto_gerado, criado_por, created_at FROM eventos_checkin WHERE id = $1`;
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
  await getPostgresPool().query(
    `UPDATE eventos_checkin SET
      label = COALESCE($3, label),
      ativo = COALESCE($4, ativo),
      horario_inicio = COALESCE($5, horario_inicio),
      horario_fim = COALESCE($6, horario_fim)
     WHERE id = $1 AND igreja_id = $2`,
    [
      id,
      igrejaId,
      patch.label !== undefined ? patch.label : null,
      patch.ativo !== undefined ? patch.ativo : null,
      patch.horarioInicio !== undefined ? patch.horarioInicio : null,
      patch.horarioFim !== undefined ? patch.horarioFim : null,
    ],
  );
  return pgFindEventoCheckinById(id, igrejaId);
}

export async function pgDeleteEventoCheckin(id, igrejaId) {
  const { rowCount } = await getPostgresPool().query(
    'DELETE FROM eventos_checkin WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  return rowCount > 0;
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
    const ymd = escalaDataToYMD(escala.data);
    if (!ymd) return escala;
    const evt = await pgFindEventoCheckinPorData(igrejaId, ymd);
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
    const ymd = escalaDataToYMD(row.dados?.data);
    if (!ymd) continue;
    const { rows: evts } = await getPostgresPool().query(
      "SELECT id FROM eventos_checkin WHERE igreja_id = $1 AND data = $2::date AND ativo = TRUE",
      [row.igreja_id, ymd],
    );
    if (evts.length === 1) {
      await pgUpdateEscala(row.id, row.igreja_id, { eventoCheckinId: evts[0].id });
      vinculadas += 1;
    }
  }
  return vinculadas;
}

/** Busca a escala vinculada a um evento de check-in (se houver). */
export async function pgFindEscalaByEventoCheckin(igrejaId, eventoCheckinId) {
  if (!eventoCheckinId) return null;
  const { rows } = await getPostgresPool().query(
    `SELECT id, igreja_id, dados, created_at FROM escalas
     WHERE igreja_id = $1 AND dados->>'eventoCheckinId' = $2
     LIMIT 1`,
    [igrejaId, eventoCheckinId],
  );
  return mapEscalaRow(rows[0]);
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
    if (ymd && ymd <= hoje) {
      await pgUpdateEscala(row.id, igrejaId, { ativo: false });
      fechadas += 1;
    }
  }
  return fechadas;
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
  if (existing.length) return { duplicate: true, id: existing[0].id };

  const id = randomUUID();
  const now = Date.now();
  await getPostgresPool().query(
    `INSERT INTO checkins (id, igreja_id, evento_id, email, nome, ministerio, batizado, data_checkin, timestamp_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id, igrejaId, eventoId, em, nome || '', ministerio || '',
      batizado == null ? null : (batizado ? 'sim' : 'nao'),
      dataCheckin, now,
    ],
  );
  return { id, created: true };
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
