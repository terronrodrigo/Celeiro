/**
 * KPIs de engajamento de voluntários e cohort de re-engajamento por email.
 */
import { getPostgresPool } from './init.js';
import {
  pgEmailsComAtividadeRecente,
  pgListVoluntariosParaEmailBroadcast,
} from './operational-data.js';
import {
  candidaturaMatchesLiderMinisterios,
  voluntarioMatchesLiderMinisterios,
} from '../../lib/ministerio-match.js';

function normEmail(v) {
  return String(v || '').toLowerCase().trim();
}

function activityMsFromCheckin(row) {
  if (row.timestamp_ms != null && Number.isFinite(Number(row.timestamp_ms))) {
    return Number(row.timestamp_ms);
  }
  const d = row.data_checkin || row.created_at;
  return d ? new Date(d).getTime() : 0;
}

function activityMsFromCandidatura(row) {
  const d = row.created_at;
  return d ? new Date(d).getTime() : 0;
}

function isWithinDays(ms, days) {
  if (!ms) return false;
  return ms >= Date.now() - days * 24 * 60 * 60 * 1000;
}

/** @returns {Map<string, { ever: boolean, msMax: number, ministries: Set<string> }>} */
function buildEmailActivityMap(candRows, ckRows) {
  const map = new Map();
  function ensure(em) {
    if (!map.has(em)) map.set(em, { ever: false, msMax: 0, ministries: new Set() });
    return map.get(em);
  }
  for (const r of candRows) {
    const em = normEmail(r.em);
    if (!em || !em.includes('@')) continue;
    const s = ensure(em);
    s.ever = true;
    const ms = activityMsFromCandidatura(r);
    if (ms > s.msMax) s.msMax = ms;
    const m = String(r.ministerio || '').trim();
    if (m) s.ministries.add(m);
  }
  for (const r of ckRows) {
    const em = normEmail(r.em);
    if (!em || !em.includes('@')) continue;
    const s = ensure(em);
    s.ever = true;
    const ms = activityMsFromCheckin(r);
    if (ms > s.msMax) s.msMax = ms;
    const m = String(r.ministerio || '').trim();
    if (m) s.ministries.add(m);
  }
  return map;
}

function volunteerInMinistryCohort(vol, email, activityMap, ministerioFiltro) {
  const f = ministerioFiltro ? String(ministerioFiltro).trim() : '';
  if (!f) return true;
  if (voluntarioMatchesLiderMinisterios(vol, [f])) return true;
  const act = activityMap.get(email);
  if (!act) return false;
  for (const m of act.ministries) {
    if (candidaturaMatchesLiderMinisterios(m, [f])) return true;
  }
  return false;
}

async function loadActivityRows(igrejaId) {
  const pool = getPostgresPool();
  const [{ rows: candRows }, { rows: ckRows }] = await Promise.all([
    pool.query(
      `SELECT LOWER(TRIM(dados->>'email')) AS em,
              dados->>'ministerio' AS ministerio,
              created_at
       FROM candidaturas
       WHERE igreja_id = $1
         AND LOWER(COALESCE(dados->>'email', '')) LIKE '%@%'`,
      [igrejaId],
    ),
    pool.query(
      `SELECT LOWER(TRIM(email)) AS em,
              ministerio,
              timestamp_ms,
              data_checkin,
              created_at
       FROM checkins
       WHERE igreja_id = $1
         AND LOWER(COALESCE(email, '')) LIKE '%@%'`,
      [igrejaId],
    ),
  ]);
  return { candRows, ckRows };
}

function servedInLastDays(email, activityMap, recentSet, days) {
  if (recentSet.has(email)) return true;
  const act = activityMap.get(email);
  return act ? isWithinDays(act.msMax, days) : false;
}

/**
 * Resumo de engajamento de voluntários cadastrados.
 * @returns {{ total, nuncaServiram, serviram30, serviram60, serviram90 }}
 */
export async function pgVoluntariosEngajamentoResumo(igrejaId, { ministerioFiltro } = {}) {
  const voluntarios = await pgListVoluntariosParaEmailBroadcast(igrejaId);
  const { candRows, ckRows } = await loadActivityRows(igrejaId);
  const activityMap = buildEmailActivityMap(candRows, ckRows);

  const [recent30, recent60, recent90] = await Promise.all([
    pgEmailsComAtividadeRecente(igrejaId, 30),
    pgEmailsComAtividadeRecente(igrejaId, 60),
    pgEmailsComAtividadeRecente(igrejaId, 90),
  ]);

  let total = 0;
  let nuncaServiram = 0;
  let serviram30 = 0;
  let serviram60 = 0;
  let serviram90 = 0;

  for (const v of voluntarios) {
    const em = normEmail(v.email);
    if (!em || !em.includes('@')) continue;
    if (!volunteerInMinistryCohort(v, em, activityMap, ministerioFiltro)) continue;

    total += 1;
    const act = activityMap.get(em);
    const ever = act?.ever === true;

    if (!ever) {
      nuncaServiram += 1;
    } else {
      if (servedInLastDays(em, activityMap, recent30, 30)) serviram30 += 1;
      if (servedInLastDays(em, activityMap, recent60, 60)) serviram60 += 1;
      if (servedInLastDays(em, activityMap, recent90, 90)) serviram90 += 1;
    }
  }

  return { total, nuncaServiram, serviram30, serviram60, serviram90 };
}

/**
 * Voluntários que serviram nos últimos 180 dias mas não nos últimos 30.
 * @returns {{ email: string, nome: string }[]}
 */
export async function pgResolveDestinatariosReengajamento(igrejaId, { ministerioFiltro } = {}) {
  const voluntarios = await pgListVoluntariosParaEmailBroadcast(igrejaId);
  const { candRows, ckRows } = await loadActivityRows(igrejaId);
  const activityMap = buildEmailActivityMap(candRows, ckRows);

  const [ativos180, ativos30] = await Promise.all([
    pgEmailsComAtividadeRecente(igrejaId, 180),
    pgEmailsComAtividadeRecente(igrejaId, 30),
  ]);

  const out = [];
  for (const v of voluntarios) {
    const em = normEmail(v.email);
    if (!em || !em.includes('@')) continue;
    if (!ativos180.has(em)) continue;
    if (ativos30.has(em)) continue;
    if (!volunteerInMinistryCohort(v, em, activityMap, ministerioFiltro)) continue;
    out.push({ email: em, nome: (v.nome || '').trim() || em.split('@')[0] || em });
  }

  out.sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR'));
  return out;
}
