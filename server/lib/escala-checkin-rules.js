import {
  escalaDataToYMD,
  getHojeDateString,
  listOcorrenciaDates,
  parseHHMM,
  TZ_BRASILIA,
} from './brasilia.js';

export function getNowHHMMBrasilia() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: TZ_BRASILIA,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function getEventDateYmd(evento) {
  if (!evento?.data) return '';
  const d = evento.data instanceof Date ? evento.data : new Date(evento.data);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
}

/** Check-in só no dia do evento; horário opcional (vazio = dia inteiro). */
export function isWithinCheckinWindow(evento, hoje = getHojeDateString()) {
  const eventYmd = getEventDateYmd(evento);
  if (!eventYmd || eventYmd !== hoje) return false;
  const hin = parseHHMM(evento.horarioInicio);
  const hfi = parseHHMM(evento.horarioFim);
  if (!hin && !hfi) return true;
  const now = getNowHHMMBrasilia();
  if (hin && now < hin) return false;
  if (hfi && now > hfi) return false;
  return true;
}

/** Líder/admin desligam com ativo=false; com ativo=true, vale janela de data/horário. */
export function isCheckinEventAberto(evento, hoje = getHojeDateString()) {
  if (!evento || evento.ativo === false) return false;
  return isWithinCheckinWindow(evento, hoje);
}

export function getProximaOcorrenciaYmd(diaSemana, fromYmd = getHojeDateString()) {
  const dates = listOcorrenciaDates(diaSemana, 1, fromYmd);
  return dates[0] || null;
}

/**
 * Inscrição na escala: ativo do líder/admin + data futura + só a próxima ocorrência do culto recorrente.
 * No dia do culto (e após) inscrições fecham — salvo prazo estendido (inscricaoAte).
 */
function normInscricaoAteYmd(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return escalaDataToYMD(raw) || '';
}

/** Prazo manual definido no editar escala ainda válido? */
export function isInscricaoPrazoExtendidoAtivo(escala, hoje = getHojeDateString()) {
  const ate = normInscricaoAteYmd(escala?.inscricaoAte);
  if (!ate) return false;
  if (ate < hoje) return false;
  if (ate > hoje) return true;
  const horaLim = parseHHMM(escala?.inscricaoAteHora);
  if (!horaLim) return true;
  return getNowHHMMBrasilia() <= horaLim;
}

/** Campos para reabrir inscrições (ex.: culto hoje ou escala fechada manualmente). */
export function buildReativacaoInscricaoPatch(escala, culto = null, hoje = getHojeDateString()) {
  const base = {
    ...escala,
    ativo: true,
    inscricaoAte: null,
    inscricaoAteHora: null,
  };
  if (isEscalaAbertaParaCandidatura(base, culto, hoje)) {
    return { ativo: true, inscricaoAte: null, inscricaoAteHora: null };
  }
  const ymd = escalaDataToYMD(escala.data) || hoje;
  const ate = ymd < hoje ? hoje : ymd;
  return { ativo: true, inscricaoAte: ate, inscricaoAteHora: null };
}

export function isEscalaAbertaParaCandidatura(escala, culto = null, hoje = getHojeDateString()) {
  if (!escala || escala.ativo === false) return false;

  const prazoYmd = normInscricaoAteYmd(escala.inscricaoAte);
  if (prazoYmd) {
    if (isInscricaoPrazoExtendidoAtivo(escala, hoje)) return true;
    return false;
  }

  const ymd = escalaDataToYMD(escala.data);
  if (!ymd || ymd <= hoje) return false;
  if (escala.cultoRecorrenteId && culto && Number.isInteger(culto.diaSemana)) {
    const proxima = getProximaOcorrenciaYmd(culto.diaSemana, hoje);
    return ymd === proxima;
  }
  return true;
}

export function sortEscalasByDataDesc(escalas) {
  return [...escalas].sort((a, b) => {
    const da = escalaDataToYMD(a.data) || '';
    const db = escalaDataToYMD(b.data) || '';
    if (da !== db) return db.localeCompare(da);
    return String(b._id || '').localeCompare(String(a._id || ''));
  });
}

export function checkinFechadoMensagem(evento) {
  if (!evento) return 'Evento não encontrado ou check-in encerrado.';
  if (evento.ativo === false) return 'Check-in encerrado pelo administrador.';
  const hoje = getHojeDateString();
  const ymd = getEventDateYmd(evento);
  if (ymd !== hoje) {
    return ymd && ymd < hoje
      ? 'Check-in encerrado: a data deste culto já passou.'
      : 'Check-in ainda não está aberto para hoje.';
  }
  const hin = parseHHMM(evento.horarioInicio);
  const hfi = parseHHMM(evento.horarioFim);
  if (hin || hfi) {
    const now = getNowHHMMBrasilia();
    if (hin && now < hin) return `Check-in abre às ${hin} (horário de Brasília).`;
    if (hfi && now > hfi) return `Check-in encerrado às ${hfi} (horário de Brasília).`;
  }
  return 'Check-in encerrado.';
}
