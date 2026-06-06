/**
 * Histórico de participação do voluntário logado: escalas aprovadas e check-ins.
 */
import { getPostgresPool } from './init.js';

const TZ_BRASILIA = process.env.TZ || process.env.APP_TIMEZONE || 'America/Sao_Paulo';

const EMPTY_RESUMO = {
  cultosEmEscala: 0,
  vezesEscalaAprovado: 0,
  vezesEscalaInscricao: 0,
  vezesCheckin: 0,
  cultosComCheckin: 0,
  taxaPresenca: null,
  ultimoCheckin: null,
};

/**
 * @param {string} igrejaId
 * @param {string} emailLower
 */
export async function pgHistoricoVoluntario(igrejaId, emailLower) {
  const em = String(emailLower || '').toLowerCase().trim();
  if (!em) return { resumo: { ...EMPTY_RESUMO } };

  const pool = getPostgresPool();
  const [{ rows: candRows }, { rows: ckRows }] = await Promise.all([
    pool.query(
      `SELECT c.dados, e.dados AS escala_dados
       FROM candidaturas c
       LEFT JOIN escalas e ON e.id = c.escala_id AND e.igreja_id = c.igreja_id
       WHERE c.igreja_id = $1 AND LOWER(c.dados->>'email') = $2`,
      [igrejaId, em],
    ),
    pool.query(
      `SELECT evento_id, timestamp_ms, data_checkin
       FROM checkins WHERE igreja_id = $1 AND LOWER(email) = $2`,
      [igrejaId, em],
    ),
  ]);

  let vezesEscalaInscricao = 0;
  let vezesEscalaAprovado = 0;
  const cultoIdsEscala = new Set();

  for (const c of candRows) {
    vezesEscalaInscricao += 1;
    const d = c.dados || {};
    if (d.status === 'aprovado') {
      vezesEscalaAprovado += 1;
      const evtId = (c.escala_dados || {}).eventoCheckinId;
      if (evtId) cultoIdsEscala.add(String(evtId));
    }
  }

  const vezesCheckin = ckRows.length;
  const cultoIdsCheckin = new Set();
  let ultimoCheckinMs = null;

  for (const c of ckRows) {
    if (c.evento_id) cultoIdsCheckin.add(String(c.evento_id));
    const ms = c.timestamp_ms != null
      ? Number(c.timestamp_ms)
      : (c.data_checkin ? new Date(c.data_checkin).getTime() : null);
    if (ms != null && !Number.isNaN(ms) && (ultimoCheckinMs == null || ms > ultimoCheckinMs)) {
      ultimoCheckinMs = ms;
    }
  }

  const taxaPresenca = vezesEscalaAprovado > 0
    ? Math.round((vezesCheckin / vezesEscalaAprovado) * 100)
    : null;

  const ultimoCheckin = ultimoCheckinMs != null
    ? new Date(ultimoCheckinMs).toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA })
    : null;

  return {
    resumo: {
      cultosEmEscala: cultoIdsEscala.size,
      vezesEscalaAprovado,
      vezesEscalaInscricao,
      vezesCheckin,
      cultosComCheckin: cultoIdsCheckin.size,
      taxaPresenca,
      ultimoCheckin,
    },
  };
}
