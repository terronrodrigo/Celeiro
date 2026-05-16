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
    createdAt: row.created_at,
    updatedAt: d.updatedAt || row.created_at,
  };
}

function mapEventoRow(row) {
  const ymd = row.data instanceof Date
    ? escalaDataToYMD(row.data)
    : String(row.data || '').slice(0, 10);
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

export async function pgListEscalas(igrejaId, { ativoOnly = false, limit = 80 } = {}) {
  let sql = 'SELECT id, igreja_id, dados, created_at FROM escalas WHERE igreja_id = $1';
  const params = [igrejaId];
  if (ativoOnly) {
    sql += " AND (dados->>'ativo')::boolean IS DISTINCT FROM FALSE";
  }
  sql += ' ORDER BY created_at DESC LIMIT $2';
  params.push(limit);
  const { rows } = await getPostgresPool().query(sql, params);
  return rows.map(mapEscalaRow);
}

export async function pgFindEscalaById(id, igrejaId) {
  const { rows } = await getPostgresPool().query(
    'SELECT id, igreja_id, dados, created_at FROM escalas WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  return mapEscalaRow(rows[0]);
}

export async function pgCreateEscala({
  igrejaId, nome, data, descricao = '', ativo = true, criadoPor = null,
  cultoRecorrenteId = null, autoGerada = false,
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
    updatedAt: new Date().toISOString(),
  };
  await getPostgresPool().query(
    'UPDATE escalas SET dados = $3::jsonb WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId, JSON.stringify(dados)],
  );
  return pgFindEscalaById(id, igrejaId);
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

export async function pgListEventosCheckin(igrejaId, { ativoOnly = false, dataYmd = null } = {}) {
  let sql = `SELECT id, igreja_id, data, label, ativo, horario_inicio, horario_fim,
    culto_recorrente_id, auto_gerado, criado_por, created_at
    FROM eventos_checkin WHERE igreja_id = $1`;
  const params = [igrejaId];
  if (ativoOnly) sql += ' AND ativo = TRUE';
  if (dataYmd) {
    params.push(dataYmd);
    sql += ` AND data = $${params.length}::date`;
  }
  sql += ' ORDER BY data DESC, created_at DESC';
  const { rows } = await getPostgresPool().query(sql, params);
  return rows.map(mapEventoRow);
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

export async function pgCreateCheckin({
  igrejaId, eventoId, email, nome, ministerio, batizado, userId = null,
}) {
  const evento = await pgFindEventoCheckinById(eventoId, igrejaId);
  if (!evento) return { error: 'not_found' };
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

export async function pgFindCandidaturaDuplicada(igrejaId, escalaId, email) {
  const { rows } = await getPostgresPool().query(
    `SELECT id FROM candidaturas
     WHERE igreja_id = $1 AND escala_id = $2 AND LOWER(dados->>'email') = $3 LIMIT 1`,
    [igrejaId, escalaId, email.toLowerCase()],
  );
  return rows[0]?.id || null;
}
