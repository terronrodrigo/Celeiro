/** Utilitários de data/hora em America/Sao_Paulo (Brasília, sem horário de verão). */

export const TZ_BRASILIA = process.env.TZ || process.env.APP_TIMEZONE || 'America/Sao_Paulo';

export function getHojeDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
}

export function parseDateAsBrasilia(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T03:00:00.000Z`);
}

export function parseDateOnlyToUTC(dateStr) {
  if (dateStr == null || dateStr === '') return null;
  if (dateStr instanceof Date) {
    const s = dateStr.toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
    return parseDateAsBrasilia(s);
  }
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(`${match[0]}T03:00:00.000Z`);
  return new Date(str);
}

export function escalaDataToYMD(dateVal) {
  if (dateVal == null) return null;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: TZ_BRASILIA });
}

export function getDayRangeBrasilia(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return { start: null, end: null };
  const s = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { start: null, end: null };
  const start = new Date(`${s}T03:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

const RE_HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseHHMM(s) {
  const t = (s || '').toString().trim();
  return RE_HHMM.test(t) ? t : null;
}

/** 0 = domingo … 6 = sábado (mesmo que Date.getUTCDay em meio-dia BRT). */
export function weekdayBrasilia(ymd) {
  const d = parseDateAsBrasilia(ymd);
  if (!d) return -1;
  return new Date(d.getTime() + 12 * 60 * 60 * 1000).getUTCDay();
}

export function addDaysYmd(ymd, days) {
  const d = parseDateAsBrasilia(ymd);
  if (!d) return null;
  return escalaDataToYMD(new Date(d.getTime() + days * 24 * 60 * 60 * 1000));
}

/** Próximas N ocorrências (inclui hoje se for o dia). */
export function listOcorrenciaDates(diaSemana, count, fromYmd = getHojeDateString()) {
  const out = [];
  let cursor = fromYmd;
  let guard = 0;
  while (out.length < count && guard < 400) {
    if (weekdayBrasilia(cursor) === diaSemana) out.push(cursor);
    const next = addDaysYmd(cursor, 1);
    if (!next || next === cursor) break;
    cursor = next;
    guard += 1;
  }
  return out;
}

export function formatDataPtBr(ymd) {
  const d = parseDateAsBrasilia(ymd);
  if (!d) return ymd;
  return d.toLocaleDateString('pt-BR', { timeZone: TZ_BRASILIA });
}

export const DIAS_SEMANA = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
];
