/**
 * Visão consolidada de escalas por data: Manhã / Almoço (2 cultos) / Tarde por ministério.
 * Horário de referência: calendário de Brasília.
 */
import { escalaDataToYMD, formatDataPtBr, weekdayBrasilia, TZ_BRASILIA } from './brasilia.js';

/** Ordem sugerida no relatório (aliases via normalizeMinisterioKey). */
export const MINISTERIO_REPORT_ORDER = [
  'PARKING',
  'CARE',
  'KIDS',
  'BEAUTY',
  'WELCOME',
  'CONSOLIDAÇÃO',
  'EXPERIENCE',
  'MÍDIA',
  'SALA DE VOLUNTÁRIOS',
  'INTERCESSÃO',
  'PRODUÇÃO DE CULTO',
  'STREAMING',
  'EVENTOS',
  'STORE',
  'SUPORTE/ALICERCE',
  'MUSIC',
  'TECNOLOGIA',
  'SEGURANÇA EXTERNA',
  'HOST',
];

const ALIAS_RULES = [
  { key: 'PARKING', match: [/parking/i, /estacionamento/i] },
  { key: 'CARE', match: [/care/i, /sa[uú]de/i] },
  { key: 'KIDS', match: [/kids/i, /infantil/i] },
  { key: 'BEAUTY', match: [/beauty/i] },
  { key: 'WELCOME', match: [/welcome/i, /recep/i] },
  { key: 'CONSOLIDAÇÃO', match: [/consolida/i] },
  { key: 'EXPERIENCE', match: [/experience/i, /audit[oó]rio/i] },
  { key: 'MÍDIA', match: [/m[ií]dia/i, /lab/i, /fotos/i, /stories/i, /v[ií]deo/i] },
  { key: 'SALA DE VOLUNTÁRIOS', match: [/sala de volunt/i] },
  { key: 'INTERCESSÃO', match: [/intercess/i] },
  { key: 'PRODUÇÃO DE CULTO', match: [/produ[cç][aã]o ao vivo/i, /produ[cç][aã]o de culto/i, /^produ[cç][aã]o$/i] },
  { key: 'STREAMING', match: [/streaming/i, /ao vivo/i] },
  { key: 'EVENTOS', match: [/eventos/i] },
  { key: 'STORE', match: [/store/i] },
  { key: 'SUPORTE/ALICERCE', match: [/alicerce/i, /suporte geral/i] },
  { key: 'MUSIC', match: [/music/i, /mid led/i] },
  { key: 'TECNOLOGIA', match: [/tecnologia/i] },
  { key: 'SEGURANÇA EXTERNA', match: [/seguran/i] },
  { key: 'HOST', match: [/^host$/i] },
];

export function normalizeMinisterioKey(nome) {
  const raw = String(nome || '').trim();
  if (!raw) return 'OUTROS';
  for (const rule of ALIAS_RULES) {
    if (rule.match.some((re) => re.test(raw))) return rule.key;
  }
  return raw.toUpperCase();
}

export function detectTurnoEscala(nomeEscala) {
  const n = String(nomeEscala || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  if (/\bmanha\b|\bmanhã\b/.test(n)) return 'manha';
  if (/\btarde\b|\bnoite\b/.test(n)) return 'tarde';
  return null;
}

function emptyMinistroBucket() {
  return { manha: 0, almoco: 0, tarde: 0, manhaEmails: new Set(), tardeEmails: new Set() };
}

/**
 * @param {object} opts
 * @param {Array} opts.escalas — { _id, nome, data }
 * @param {Array} opts.candidaturas — { escalaId, email, ministerio, status, nome? }
 * @param {string[]} opts.statusIn — default ['aprovado']
 */
export function buildVisaoConsolidada({ escalas, candidaturas, statusIn = ['aprovado'] }) {
  const statusSet = new Set(statusIn);
  const byDate = new Map();

  const escalasById = new Map(escalas.map((e) => [String(e._id), e]));

  for (const c of candidaturas) {
    if (!statusSet.has(c.status)) continue;
    const escala = escalasById.get(String(c.escalaId));
    if (!escala) continue;
    const ymd = escala.data ? escalaDataToYMD(escala.data) : null;
    if (!ymd) continue;

    const turno = detectTurnoEscala(escala.nome);
    if (!turno) continue;

    if (!byDate.has(ymd)) {
      byDate.set(ymd, {
        data: ymd,
        dataLabel: formatDataPtBr(ymd),
        diaSemana: weekdayBrasilia(ymd),
        escalas: { manha: [], tarde: [] },
        ministerios: new Map(),
      });
    }
    const day = byDate.get(ymd);
    if (!day.escalas[turno].some((x) => String(x.id) === String(escala._id))) {
      day.escalas[turno].push({ id: escala._id, nome: escala.nome });
    }

    const minKey = normalizeMinisterioKey(c.ministerio);
    if (!day.ministerios.has(minKey)) day.ministerios.set(minKey, emptyMinistroBucket());
    const bucket = day.ministerios.get(minKey);
    const email = (c.email || '').toLowerCase().trim();
    if (turno === 'manha') {
      bucket.manha += 1;
      if (email) bucket.manhaEmails.add(email);
    } else {
      bucket.tarde += 1;
      if (email) bucket.tardeEmails.add(email);
    }
  }

  for (const day of byDate.values()) {
    const almocoGlobal = new Set();
    for (const bucket of day.ministerios.values()) {
      for (const em of bucket.manhaEmails) {
        if (bucket.tardeEmails.has(em)) {
          bucket.almoco += 1;
          almocoGlobal.add(em);
        }
      }
    }
    day.totalAlmoco = almocoGlobal.size;
    day.intercessao = {
      manha: day.ministerios.get('INTERCESSÃO')?.manha || 0,
      almoco: day.ministerios.get('INTERCESSÃO')?.almoco || 0,
      tarde: day.ministerios.get('INTERCESSÃO')?.tarde || 0,
    };
  }

  return { byDate, timezone: TZ_BRASILIA };
}

export function formatVisaoConsolidadaTexto(day, { tituloPrefix = '' } = {}) {
  if (!day) return 'Nenhuma escala encontrada para esta data.';
  const diaNome = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][day.diaSemana] || '';
  const titulo = tituloPrefix || (diaNome ? `*${diaNome.toUpperCase()} ${day.dataLabel}*` : `*${day.dataLabel}*`);

  const lines = [titulo, ''];
  const keys = new Set(day.ministerios.keys());
  const ordered = [
    ...MINISTERIO_REPORT_ORDER.filter((k) => keys.has(k)),
    ...[...keys].filter((k) => !MINISTERIO_REPORT_ORDER.includes(k)).sort(),
  ];

  for (const key of ordered) {
    const b = day.ministerios.get(key);
    if (!b) continue;
    lines.push(`. ${key}:`);
    lines.push(`Manhã: ${b.manha || ''}`);
    lines.push(`Almoço: ${b.almoco || ''}`);
    lines.push(`Tarde: ${b.tarde || ''}`);
    lines.push('');
  }

  lines.push(`_Almoçam (2 cultos no dia): ${day.totalAlmoco || 0} pessoas_`);
  const escManha = day.escalas.manha.map((e) => e.nome).join(' · ') || '—';
  const escTarde = day.escalas.tarde.map((e) => e.nome).join(' · ') || '—';
  lines.push(`Escalas manhã: ${escManha}`);
  lines.push(`Escalas tarde: ${escTarde}`);

  return lines.join('\n').trim();
}

export function pickDayFromVisao(visao, dataYmd) {
  if (!visao?.byDate?.size) return null;
  if (dataYmd) return visao.byDate.get(dataYmd) || null;
  const sorted = [...visao.byDate.keys()].sort();
  return visao.byDate.get(sorted[sorted.length - 1]) || null;
}

/** Pessoas aprovadas em manhã E tarde no mesmo domingo (inner join por email). */
export function buildIntersecaoDomingo({ escalas, candidaturas, statusIn = ['aprovado'] }) {
  const statusSet = new Set(statusIn);
  const escalasById = new Map(escalas.map((e) => [String(e._id), e]));
  const byEmail = new Map();

  for (const c of candidaturas) {
    if (!statusSet.has(c.status)) continue;
    const escala = escalasById.get(String(c.escalaId));
    if (!escala) continue;
    const turno = detectTurnoEscala(escala.nome);
    if (!turno) continue;
    const em = (c.email || '').toLowerCase().trim();
    if (!em) continue;
    if (!byEmail.has(em)) {
      byEmail.set(em, { email: em, nome: (c.nome || '').trim(), manha: [], tarde: [] });
    }
    const row = byEmail.get(em);
    if (!row.nome && c.nome) row.nome = (c.nome || '').trim();
    row[turno].push({
      ministerio: (c.ministerio || '').trim(),
      ministerioKey: normalizeMinisterioKey(c.ministerio),
      escalaId: escala._id,
      escalaNome: (escala.nome || '').trim(),
    });
  }

  return [...byEmail.values()]
    .filter((p) => p.manha.length > 0 && p.tarde.length > 0)
    .sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR'));
}

export function sortMinisterioKeys(keys) {
  const set = new Set(keys);
  const ordered = [
    ...MINISTERIO_REPORT_ORDER.filter((k) => set.has(k)),
    ...[...set].filter((k) => !MINISTERIO_REPORT_ORDER.includes(k)).sort(),
  ];
  return ordered;
}

export function dayPayloadFromVisao(day) {
  if (!day) {
    return {
      ministerios: [],
      totalAlmoco: 0,
      intercessao: { manha: 0, almoco: 0, tarde: 0 },
      escalasManha: [],
      escalasTarde: [],
    };
  }
  const keys = sortMinisterioKeys([...day.ministerios.keys()]);
  return {
    dataLabel: day.dataLabel,
    diaSemana: day.diaSemana,
    escalasManha: day.escalas.manha,
    escalasTarde: day.escalas.tarde,
    ministerios: keys.map((key) => {
      const v = day.ministerios.get(key);
      return { key, manha: v?.manha || 0, almoco: v?.almoco || 0, tarde: v?.tarde || 0 };
    }),
    totalAlmoco: day.totalAlmoco || 0,
    intercessao: day.intercessao || { manha: 0, almoco: 0, tarde: 0 },
  };
}

/** Parse "17/05", "17/05/2026", "2026-05-17" → YYYY-MM-DD */
export function parseDataQuery(input, refYmd) {
  const s = String(input || '').trim();
  if (!s) return refYmd || null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (m) {
    const year = m[3] ? Number(m[3]) : Number((refYmd || '').slice(0, 4)) || new Date().getFullYear();
    const month = String(m[2]).padStart(2, '0');
    const day = String(m[1]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return null;
}
