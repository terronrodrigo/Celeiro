/**
 * Histórico de participação por ministério (líderes): escalas, check-ins e KPIs.
 */
import { getPostgresPool } from './init.js';
import {
  candidaturaMatchesLiderMinisterios,
  splitVoluntarioMinisterios,
  voluntarioMatchesLiderMinisterios,
} from '../../lib/ministerio-match.js';

function mapVoluntarioFromRow(row) {
  const d = row.dados || {};
  const ministerios = splitVoluntarioMinisterios({ ministerios: d.ministerios, ministerio: d.ministerio });
  const ministerio = ministerios.length ? ministerios.join(', ') : '';
  return {
    email: row.email,
    nome: d.nome || row.nome || '',
    ministerio,
    ministerios,
    ativo: row.ativo !== false,
  };
}

/** Restringe nomes do líder ao filtro opcional (mesma regra de match parcial). */
function resolveMinisterioNomes(ministerioNomes, ministerioFiltro) {
  let nomes = (ministerioNomes || []).map(String).map((s) => s.trim()).filter(Boolean);
  const f = ministerioFiltro ? String(ministerioFiltro).trim() : '';
  if (!f) return nomes;
  const matched = nomes.filter((n) => candidaturaMatchesLiderMinisterios(f, [n])
    || candidaturaMatchesLiderMinisterios(n, [f]));
  return matched.length ? matched : nomes.filter((n) => {
    const ln = n.toLowerCase();
    const fl = f.toLowerCase();
    return ln === fl || ln.includes(fl) || fl.includes(ln);
  });
}

function matchesMinisterio(ministerio, nomes) {
  return candidaturaMatchesLiderMinisterios(ministerio, nomes);
}

/**
 * @param {string} igrejaId
 * @param {string[]} ministerioNomes — ministérios do líder
 * @param {{ ministerioFiltro?: string, sort?: 'escala'|'checkin'|'nome' }} [opts]
 */
export async function pgHistoricoMinisterio(igrejaId, ministerioNomes, { ministerioFiltro, sort } = {}) {
  const nomes = resolveMinisterioNomes(ministerioNomes, ministerioFiltro);
  const emptyResumo = {
    cultos: 0,
    voluntariosCadastrados: 0,
    voluntariosParticiparam: 0,
    voluntariosComCheckin: 0,
  };
  if (!nomes.length) {
    return { resumo: emptyResumo, ministerios: [], voluntarios: [] };
  }

  const pool = getPostgresPool();
  const [{ rows: volRows }, { rows: candRows }, { rows: ckRows }] = await Promise.all([
    pool.query(
      `SELECT id, email, nome, dados, ativo, fonte FROM voluntarios WHERE igreja_id = $1`,
      [igrejaId],
    ),
    pool.query(
      `SELECT c.escala_id, c.dados, e.dados AS escala_dados
       FROM candidaturas c
       LEFT JOIN escalas e ON e.id = c.escala_id AND e.igreja_id = c.igreja_id
       WHERE c.igreja_id = $1`,
      [igrejaId],
    ),
    pool.query(
      `SELECT email, nome, ministerio, evento_id, timestamp_ms, data_checkin
       FROM checkins WHERE igreja_id = $1`,
      [igrejaId],
    ),
  ]);

  const filteredCands = candRows.filter((c) => matchesMinisterio((c.dados || {}).ministerio, nomes));
  const filteredCheckins = ckRows.filter((c) => matchesMinisterio(c.ministerio, nomes));

  const statsByEmail = new Map();

  function ensureStats(email, nome = '') {
    const em = String(email || '').toLowerCase().trim();
    if (!em) return null;
    if (!statsByEmail.has(em)) {
      statsByEmail.set(em, {
        email: em,
        nome: nome || '',
        vezesEscalaAprovado: 0,
        vezesEscalaInscricao: 0,
        vezesCheckin: 0,
        ultimoCheckinMs: null,
        ativo: true,
      });
    }
    const s = statsByEmail.get(em);
    if (nome && !s.nome) s.nome = nome;
    return s;
  }

  for (const c of filteredCands) {
    const d = c.dados || {};
    const s = ensureStats(d.email, d.nome);
    if (!s) continue;
    s.vezesEscalaInscricao += 1;
    if (d.status === 'aprovado') s.vezesEscalaAprovado += 1;
  }

  for (const c of filteredCheckins) {
    const s = ensureStats(c.email, c.nome);
    if (!s) continue;
    s.vezesCheckin += 1;
    const ms = c.timestamp_ms != null
      ? Number(c.timestamp_ms)
      : (c.data_checkin ? new Date(c.data_checkin).getTime() : null);
    if (ms != null && !Number.isNaN(ms) && (s.ultimoCheckinMs == null || ms > s.ultimoCheckinMs)) {
      s.ultimoCheckinMs = ms;
    }
  }

  const cadastradosEmails = new Set();
  for (const r of volRows) {
    const vol = mapVoluntarioFromRow(r);
    if (!voluntarioMatchesLiderMinisterios(vol, nomes)) continue;
    const em = String(vol.email || '').toLowerCase().trim();
    if (!em) continue;
    if (vol.ativo) cadastradosEmails.add(em);
    const s = ensureStats(em, vol.nome);
    if (s) {
      s.nome = vol.nome || s.nome;
      s.ativo = vol.ativo;
    }
  }

  const cultoIds = new Set();
  for (const c of filteredCheckins) {
    if (c.evento_id) cultoIds.add(String(c.evento_id));
  }
  for (const c of filteredCands) {
    const d = c.dados || {};
    if (d.status !== 'aprovado') continue;
    const evtId = (c.escala_dados || {}).eventoCheckinId;
    if (evtId) cultoIds.add(String(evtId));
  }

  const participaramEmails = new Set();
  for (const [em, s] of statsByEmail) {
    if (s.vezesCheckin > 0 || s.vezesEscalaAprovado > 0) participaramEmails.add(em);
  }

  const voluntariosComCheckin = [...statsByEmail.values()].filter((s) => s.vezesCheckin > 0).length;

  let voluntarios = [...statsByEmail.values()].map((s) => ({
    email: s.email,
    nome: s.nome,
    ativo: s.ativo,
    vezesEscalaAprovado: s.vezesEscalaAprovado,
    vezesEscalaInscricao: s.vezesEscalaInscricao,
    vezesCheckin: s.vezesCheckin,
    taxaPresenca: s.vezesEscalaAprovado > 0
      ? Math.round((s.vezesCheckin / s.vezesEscalaAprovado) * 100)
      : null,
    ultimoCheckinMs: s.ultimoCheckinMs,
  }));

  const sortKey = sort === 'checkin' || sort === 'nome' ? sort : 'escala';
  voluntarios.sort((a, b) => {
    if (sortKey === 'nome') return (a.nome || a.email || '').localeCompare(b.nome || b.email || '', 'pt-BR');
    if (sortKey === 'checkin') {
      return b.vezesCheckin - a.vezesCheckin
        || b.vezesEscalaAprovado - a.vezesEscalaAprovado
        || (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    }
    return b.vezesEscalaAprovado - a.vezesEscalaAprovado
      || b.vezesCheckin - a.vezesCheckin
      || (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
  });

  return {
    resumo: {
      cultos: cultoIds.size,
      voluntariosCadastrados: cadastradosEmails.size,
      voluntariosParticiparam: participaramEmails.size,
      voluntariosComCheckin,
    },
    ministerios: nomes,
    voluntarios,
  };
}
