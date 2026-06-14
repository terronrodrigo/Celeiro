/**
 * KPIs de engajamento de voluntários, cohorts de email e controle de envios semanais.
 */
import { getPostgresPool } from './init.js';
import {
  pgEmailsComAtividadeRecente,
  pgListVoluntariosParaEmailBroadcast,
} from './operational-data.js';
import { normBatizadoPerfil } from './repos.js';
import {
  candidaturaMatchesLiderMinisterios,
  voluntarioMatchesLiderMinisterios,
} from '../../lib/ministerio-match.js';

const NUNCA_SERVIU_EMAIL_SQL = `
CREATE TABLE IF NOT EXISTS voluntario_nunca_serviu_emails (
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  semana_ymd DATE NOT NULL,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  emails_enviados INT NOT NULL DEFAULT 0,
  PRIMARY KEY (igreja_id, semana_ymd)
);
`;

export async function pgEnsureVoluntarioNuncaServiuEmailSchema() {
  await getPostgresPool().query(NUNCA_SERVIU_EMAIL_SQL);
}

export async function pgWasVoluntarioNuncaServiuEmailEnviado(igrejaId, semanaYmd) {
  const { rows } = await getPostgresPool().query(
    `SELECT 1 FROM voluntario_nunca_serviu_emails
     WHERE igreja_id = $1 AND semana_ymd = $2::date LIMIT 1`,
    [igrejaId, semanaYmd],
  );
  return rows.length > 0;
}

export async function pgMarkVoluntarioNuncaServiuEmailEnviado(igrejaId, semanaYmd, emailsEnviados = 0) {
  await getPostgresPool().query(
    `INSERT INTO voluntario_nunca_serviu_emails (igreja_id, semana_ymd, emails_enviados)
     VALUES ($1, $2::date, $3)
     ON CONFLICT (igreja_id, semana_ymd) DO UPDATE SET
       enviado_em = NOW(),
       emails_enviados = EXCLUDED.emails_enviados`,
    [igrejaId, semanaYmd, emailsEnviados],
  );
}

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

/** @returns {Map<string, { ever: boolean, msMax: number, msFirst: number, ministries: Set<string> }>} */
function buildEmailActivityMap(candRows, ckRows) {
  const map = new Map();
  function ensure(em) {
    if (!map.has(em)) {
      map.set(em, { ever: false, msMax: 0, msFirst: Infinity, ministries: new Set() });
    }
    return map.get(em);
  }
  for (const r of candRows) {
    const em = normEmail(r.em);
    if (!em || !em.includes('@')) continue;
    const s = ensure(em);
    s.ever = true;
    const ms = activityMsFromCandidatura(r);
    if (ms > 0) {
      if (ms < s.msFirst) s.msFirst = ms;
      if (ms > s.msMax) s.msMax = ms;
    }
    const m = String(r.ministerio || '').trim();
    if (m) s.ministries.add(m);
  }
  for (const r of ckRows) {
    const em = normEmail(r.em);
    if (!em || !em.includes('@')) continue;
    const s = ensure(em);
    s.ever = true;
    const ms = activityMsFromCheckin(r);
    if (ms > 0) {
      if (ms < s.msFirst) s.msFirst = ms;
      if (ms > s.msMax) s.msMax = ms;
    }
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

/** Perfil de membro completo: dados essenciais do cadastro + batizado. */
export function isVoluntarioPerfilMembroCompleto(vol) {
  if (!vol) return false;
  const nome = String(vol.nome || '').trim();
  const tel = String(vol.telefone || vol.whatsapp || '').trim();
  const nasc = String(vol.nascimento || '').trim();
  const ev = String(vol.evangelico || '').trim();
  const igreja = String(vol.igreja || '').trim();
  const bat = normBatizadoPerfil(vol.batizado);
  return Boolean(nome && tel && nasc && ev && igreja && bat === true);
}

async function loadMembroFormEmails(igrejaId) {
  const pool = getPostgresPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT LOWER(TRIM(dados->>'email')) AS em
     FROM formulario_membro
     WHERE igreja_id = $1
       AND LOWER(TRIM(COALESCE(dados->>'email', ''))) LIKE '%@%'`,
    [igrejaId],
  );
  return new Set(rows.map((r) => normEmail(r.em)).filter(Boolean));
}

/** Cadastros + formulários com email válido (base ampliada para engajamento). */
export async function pgListPessoasVoluntariosBase(igrejaId) {
  const byEmail = new Map();
  const voluntarios = await pgListVoluntariosParaEmailBroadcast(igrejaId);
  for (const v of voluntarios) {
    const em = normEmail(v.email);
    if (!em || !em.includes('@') || byEmail.has(em)) continue;
    byEmail.set(em, {
      email: em,
      nome: (v.nome || '').trim() || em.split('@')[0] || em,
      fonte: 'voluntario',
      vol: v,
    });
  }

  const pool = getPostgresPool();
  const formSql = [
    `SELECT LOWER(TRIM(dados->>'email')) AS em,
            COALESCE(NULLIF(TRIM(dados->>'nome'), ''), NULLIF(TRIM(dados->>'nomeCompleto'), '')) AS nome,
            'formulario_membro' AS fonte
     FROM formulario_membro
     WHERE igreja_id = $1 AND LOWER(TRIM(COALESCE(dados->>'email', ''))) LIKE '%@%'`,
    `SELECT LOWER(TRIM(dados->>'email')) AS em,
            NULLIF(TRIM(dados->>'nome'), '') AS nome,
            'formulario_novo_membro' AS fonte
     FROM formulario_novo_membro
     WHERE igreja_id = $1 AND LOWER(TRIM(COALESCE(dados->>'email', ''))) LIKE '%@%'`,
    `SELECT LOWER(TRIM(dados->>'email')) AS em,
            COALESCE(NULLIF(TRIM(dados->>'nome'), ''), NULLIF(TRIM(dados->>'nomeCompleto'), '')) AS nome,
            'formulario_consolidacao' AS fonte
     FROM formulario_consolidacao
     WHERE igreja_id = $1 AND LOWER(TRIM(COALESCE(dados->>'email', ''))) LIKE '%@%'`,
  ];

  for (const sql of formSql) {
    const { rows } = await pool.query(sql, [igrejaId]);
    for (const r of rows) {
      const em = normEmail(r.em);
      if (!em || !em.includes('@')) continue;
      if (byEmail.has(em)) continue;
      byEmail.set(em, {
        email: em,
        nome: (r.nome || '').trim() || em.split('@')[0] || em,
        fonte: r.fonte || 'formulario',
        vol: null,
      });
    }
  }

  return [...byEmail.values()];
}

/**
 * Resumo de engajamento de voluntários cadastrados (+ formulários).
 * @returns {{ total, nuncaServiram, serviram30, serviram60, serviram90, primeiraVez7d, primeiraVez30d, cadastrosFormularios }}
 */
export async function pgVoluntariosEngajamentoResumo(igrejaId, { ministerioFiltro } = {}) {
  const pessoas = await pgListPessoasVoluntariosBase(igrejaId);
  const { candRows, ckRows } = await loadActivityRows(igrejaId);
  const activityMap = buildEmailActivityMap(candRows, ckRows);
  const membroFormEmails = await loadMembroFormEmails(igrejaId);

  const ckCountByEmail = new Map();
  for (const r of ckRows) {
    const em = normEmail(r.em);
    if (!em) continue;
    ckCountByEmail.set(em, (ckCountByEmail.get(em) || 0) + 1);
  }

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
  let primeiraVez7d = 0;
  let primeiraVez30d = 0;
  let cadastrosFormularios = 0;
  let jaServiram = 0;
  let servindoSemBatismo = 0;
  let servindoNaoBatizado = 0;
  let servindoBatismoDesconhecido = 0;
  let servindoBatizados = 0;
  let servindoSemCadastroMembro = 0;
  const servindoSemBatismoLista = [];

  for (const p of pessoas) {
    const em = normEmail(p.email);
    if (!em || !em.includes('@')) continue;
    const vol = p.vol || p;
    if (!volunteerInMinistryCohort(vol, em, activityMap, ministerioFiltro)) continue;

    total += 1;
    const act = activityMap.get(em);
    const ever = act?.ever === true;

    if (!ever) {
      nuncaServiram += 1;
      if (p.fonte && p.fonte !== 'voluntario' && p.fonte !== 'user') cadastrosFormularios += 1;
    } else {
      if (servedInLastDays(em, activityMap, recent30, 30)) serviram30 += 1;
      if (servedInLastDays(em, activityMap, recent60, 60)) serviram60 += 1;
      if (servedInLastDays(em, activityMap, recent90, 90)) serviram90 += 1;
      const firstMs = act.msFirst !== Infinity ? act.msFirst : 0;
      if (firstMs && isWithinDays(firstMs, 7)) primeiraVez7d += 1;
      if (firstMs && isWithinDays(firstMs, 30)) primeiraVez30d += 1;

      jaServiram += 1;
      const bat = p.vol ? normBatizadoPerfil(p.vol.batizado) : null;
      const temMembro = membroFormEmails.has(em) || isVoluntarioPerfilMembroCompleto(p.vol);
      if (!temMembro) servindoSemCadastroMembro += 1;

      if (bat === true) {
        servindoBatizados += 1;
      } else {
        servindoSemBatismo += 1;
        if (bat === false) servindoNaoBatizado += 1;
        else servindoBatismoDesconhecido += 1;

        if (p.vol) {
          const mins = [...(act?.ministries || [])];
          const ministerio = mins.length
            ? mins.join(', ')
            : (p.vol.ministerio || p.vol.ministerios?.join(', ') || '—');
          servindoSemBatismoLista.push({
            email: em,
            nome: (p.nome || p.vol.nome || '').trim() || em.split('@')[0],
            ministerio,
            vezesCheckin: ckCountByEmail.get(em) || 0,
            batizado: bat,
          });
        }
      }
    }
  }

  servindoSemBatismoLista.sort((a, b) => {
    const ck = (b.vezesCheckin || 0) - (a.vezesCheckin || 0);
    if (ck !== 0) return ck;
    return (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR');
  });

  return {
    total,
    nuncaServiram,
    serviram30,
    serviram60,
    serviram90,
    primeiraVez7d,
    primeiraVez30d,
    cadastrosFormularios,
    jaServiram,
    servindoSemBatismo,
    servindoNaoBatizado,
    servindoBatismoDesconhecido,
    servindoBatizados,
    servindoSemCadastroMembro,
    servindoSemBatismoLista,
  };
}

/**
 * Pessoas que nunca tiveram candidatura nem check-in (cadastro + formulários).
 * @returns {{ email: string, nome: string }[]}
 */
export async function pgResolveDestinatariosNuncaServiram(igrejaId, { ministerioFiltro } = {}) {
  const pessoas = await pgListPessoasVoluntariosBase(igrejaId);
  const { candRows, ckRows } = await loadActivityRows(igrejaId);
  const activityMap = buildEmailActivityMap(candRows, ckRows);

  const out = [];
  for (const p of pessoas) {
    const em = normEmail(p.email);
    if (!em || !em.includes('@')) continue;
    const act = activityMap.get(em);
    if (act?.ever) continue;
    const vol = p.vol || p;
    if (!volunteerInMinistryCohort(vol, em, activityMap, ministerioFiltro)) continue;
    out.push({ email: em, nome: (p.nome || '').trim() || em.split('@')[0] || em });
  }

  out.sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR'));
  return out;
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
