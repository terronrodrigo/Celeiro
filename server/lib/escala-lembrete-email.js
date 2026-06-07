import { Resend } from 'resend';
import {
  formatDataPtBr,
  escalaDataToYMD,
  getHojeDateString,
  weekdayBrasilia,
} from './brasilia.js';
import { getProximaOcorrenciaYmd, getNowHHMMBrasilia } from './escala-checkin-rules.js';
import { buildEscalaPublicUrl } from './escala-public-url.js';
import { pgListVoluntarios, pgMapUltimosMinisteriosServidos, pgResolveDestinatariosEscalaEmail } from '../db/postgres/operational-data.js';
import { pgFindIgrejaById, pgListIgrejas } from '../db/postgres/repos.js';
import {
  pgFindEscalasByIds,
  pgListEscalasByDataYmd,
  pgMarkEscalaLembreteEnviado,
  pgWasEscalaLembreteEnviado,
} from '../db/postgres/escalas-checkin.js';
import { splitVoluntarioMinisterios } from './ministerio-match.js';

/** 1=segunda … 4=quinta; horário de Brasília. */
export const ESCALA_LEMBRETE_SCHEDULE = {
  quarta: { weekday: 1, cultoDiaSemana: 3, label: 'Quarta-feira', assuntoPrefix: 'Culto de quarta' },
  domingo: { weekday: 4, cultoDiaSemana: 0, label: 'Domingo', assuntoPrefix: 'Culto de domingo' },
};

export function isEscalaLembreteMorningWindow(now = new Date()) {
  const hhmm = getNowHHMMBrasilia();
  const hour = parseInt(hhmm.slice(0, 2), 10);
  const minHour = Number(process.env.ESCALA_LEMBRETE_HOUR_MIN || 7);
  const maxHour = Number(process.env.ESCALA_LEMBRETE_HOUR_MAX || 11);
  return Number.isFinite(hour) && hour >= minHour && hour < maxHour;
}

export function resolveEscalaLembreteTipoForToday(hoje = getHojeDateString()) {
  const wd = weekdayBrasilia(hoje);
  for (const [tipo, cfg] of Object.entries(ESCALA_LEMBRETE_SCHEDULE)) {
    if (wd === cfg.weekday) return tipo;
  }
  return null;
}

export function getCultoDataYmdForLembrete(tipo, hoje = getHojeDateString()) {
  const cfg = ESCALA_LEMBRETE_SCHEDULE[tipo];
  if (!cfg) return null;
  return getProximaOcorrenciaYmd(cfg.cultoDiaSemana, hoje);
}

/** Quarta (3) ou domingo (0) a partir da data do culto — para envio manual. */
export function resolveEscalaLembreteTipoForCulto(cultoDataYmd) {
  if (!cultoDataYmd) return null;
  const wd = weekdayBrasilia(cultoDataYmd);
  if (wd === 3) return 'quarta';
  if (wd === 0) return 'domingo';
  return null;
}

function pickEscalaForMinisterioLink({ ministerioEntry, upcomingEscalas, pastEscalaById }) {
  if (!upcomingEscalas.length) return null;
  const lastId = ministerioEntry?.escalaId;
  if (lastId) {
    const last = pastEscalaById.get(lastId);
    if (last?.cultoRecorrenteId) {
      const match = upcomingEscalas.find((e) => e.cultoRecorrenteId === last.cultoRecorrenteId);
      if (match) return match;
    }
  }
  return upcomingEscalas[0];
}

function resolveMinisteriosForVoluntario(email, historicoMap, voluntario, perEmail = 3) {
  const em = (email || '').toLowerCase().trim();
  const fromHistory = historicoMap.get(em) || [];
  if (fromHistory.length) {
    return fromHistory.map((h) => ({
      ministerio: h.ministerio,
      escalaId: h.escalaId,
      source: 'history',
    }));
  }
  const fromProfile = splitVoluntarioMinisterios({
    ministerios: voluntario?.ministerios,
    ministerio: voluntario?.ministerio,
  }).slice(0, perEmail);
  return fromProfile.map((m) => ({ ministerio: m, escalaId: null, source: 'profile' }));
}

export function buildEscalaLembreteEmailHtml({
  nome,
  tipo,
  cultoDataLabel,
  escalasResumo,
  ministerioLinks,
  igrejaNome,
}) {
  const n = (nome || '').trim() || 'voluntário(a)';
  const cfg = ESCALA_LEMBRETE_SCHEDULE[tipo] || { label: 'Culto' };
  const ig = (igrejaNome || 'Celeiro São Paulo').trim();

  const escalasHtml = (escalasResumo || []).map((e) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
        <p style="margin:0 0 6px;font-size:15px;color:#111827;font-weight:600;">${e.nome}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">${e.dataLabel}</p>
        <a href="${e.url}" style="font-size:14px;color:#f59e0b;font-weight:600;text-decoration:none;">Ver escala e inscrever-se →</a>
      </td>
    </tr>`).join('');

  const ministeriosHtml = (ministerioLinks || []).length
    ? (ministerioLinks || []).map((m, i) => `
      <p style="margin:0 0 10px;">
        <a href="${m.url}" style="display:inline-block;background:${i === 0 ? '#1a1a2e' : '#374151'};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">${m.ministerio}</a>
      </p>`).join('')
    : `<p style="margin:0;font-size:14px;color:#6b7280;">Acesse o link da escala acima e escolha o ministério em que deseja servir.</p>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Lembrete de escala</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <tr><td style="background:#1a1a2e;padding:28px 36px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#f59e0b;text-transform:uppercase;letter-spacing:.08em;font-weight:600;">${ig}</p>
    <h1 style="margin:8px 0 0;font-size:22px;color:#fff;font-weight:700;">Inscrições na escala — ${cfg.label}</h1>
  </td></tr>
  <tr><td style="padding:36px;">
    <p style="margin:0 0 14px;font-size:16px;color:#374151;line-height:1.6;">Olá, <strong>${n}</strong>!</p>
    <p style="margin:0 0 20px;font-size:16px;color:#374151;line-height:1.6;">As inscrições para o culto de <strong>${cfg.label.toLowerCase()}</strong>${cultoDataLabel ? ` (${cultoDataLabel})` : ''} estão abertas. Que tal se inscrever para servir?</p>
    ${escalasResumo?.length ? `
    <h2 style="margin:0 0 12px;font-size:15px;color:#111827;text-transform:uppercase;letter-spacing:.04em;">Escalas disponíveis</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${escalasHtml}</table>` : ''}
    <h2 style="margin:0 0 12px;font-size:15px;color:#111827;text-transform:uppercase;letter-spacing:.04em;">Seus ministérios</h2>
    <p style="margin:0 0 14px;font-size:14px;color:#6b7280;line-height:1.5;">Links diretos com base nos ministérios em que você já serviu (do mais recente ao mais antigo):</p>
    ${ministeriosHtml}
  </td></tr>
  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">Equipe de Voluntários · ${ig}</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

/**
 * Envia lembrete de escala para todos os voluntários da igreja.
 * @returns {{ sent, failed, total, skipped?, reason? }}
 */
export async function sendEscalaLembreteEmailsForIgreja({
  igrejaId,
  tipo,
  cultoDataYmd,
  appBase,
  force = false,
}) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_resend' };

  const cfg = ESCALA_LEMBRETE_SCHEDULE[tipo];
  if (!cfg || !cultoDataYmd) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'invalid_tipo' };
  }

  if (!force && await pgWasEscalaLembreteEnviado(igrejaId, tipo, cultoDataYmd)) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'already_sent' };
  }

  const upcomingEscalas = await pgListEscalasByDataYmd(igrejaId, cultoDataYmd, { ativoOnly: true });
  if (!upcomingEscalas.length) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_escalas' };
  }

  const igreja = await pgFindIgrejaById(igrejaId);
  const slug = igreja?.slug || 'celeiro-sp';
  const base = (appBase || process.env.APP_URL || 'https://voluntariosceleirosp.com').replace(/\/$/, '');
  const cultoDataLabel = formatDataPtBr(cultoDataYmd);

  const escalasResumo = upcomingEscalas.map((e) => ({
    nome: (e.nome || 'Escala').trim(),
    dataLabel: cultoDataLabel,
    url: buildEscalaPublicUrl({ appBase: base, escalaId: e._id, igrejaSlug: slug }),
  }));

  const [voluntarios, historicoMap] = await Promise.all([
    pgListVoluntarios(igrejaId),
    pgMapUltimosMinisteriosServidos(igrejaId, { perEmail: 3 }),
  ]);

  const pastEscalaIds = [...new Set(
    [...historicoMap.values()].flat().map((h) => h.escalaId).filter(Boolean),
  )];
  const pastEscalas = pastEscalaIds.length
    ? await pgFindEscalasByIds(igrejaId, pastEscalaIds)
    : [];
  const pastEscalaById = new Map(pastEscalas.map((e) => [String(e._id), e]));

  const byEmail = new Map();
  for (const v of voluntarios) {
    const em = (v.email || '').toLowerCase().trim();
    if (!em || !em.includes('@') || byEmail.has(em)) continue;
    byEmail.set(em, v);
  }
  const recipients = [...byEmail.entries()];
  if (!recipients.length) {
    if (!force) await pgMarkEscalaLembreteEnviado(igrejaId, tipo, cultoDataYmd, 0);
    return { sent: 0, failed: 0, total: 0 };
  }

  const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
  const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
  const resend = new Resend(apiKey);
  const subject = `${cfg.assuntoPrefix}${cultoDataLabel ? ` — ${cultoDataLabel}` : ''} · Inscrições abertas`;

  let sent = 0;
  let failed = 0;
  for (const [email, voluntario] of recipients) {
    const mins = resolveMinisteriosForVoluntario(email, historicoMap, voluntario, 3);
    const ministerioLinks = mins.map((m) => {
      const escala = pickEscalaForMinisterioLink({
        ministerioEntry: m,
        upcomingEscalas,
        pastEscalaById,
      });
      if (!escala) return null;
      return {
        ministerio: m.ministerio,
        url: buildEscalaPublicUrl({
          appBase: base,
          escalaId: escala._id,
          igrejaSlug: slug,
          ministerio: m.ministerio,
        }),
      };
    }).filter(Boolean);

    try {
      const { error } = await resend.emails.send({
        from,
        to: email,
        reply_to: replyTo,
        subject,
        html: buildEscalaLembreteEmailHtml({
          nome: voluntario.nome,
          tipo,
          cultoDataLabel,
          escalasResumo,
          ministerioLinks,
          igrejaNome: igreja?.nome,
        }),
      });
      if (error) {
        failed += 1;
        console.warn(`escala lembrete ${tipo} ${email}:`, error.message || error);
      } else {
        sent += 1;
      }
    } catch (e) {
      failed += 1;
      console.warn(`escala lembrete ${tipo} ${email}:`, e?.message || e);
    }
    if (recipients.length > 1) {
      await new Promise((r) => setTimeout(r, Number(process.env.EMAIL_SEND_DELAY_MS) || 450));
    }
  }

  if (sent > 0 || recipients.length === 0) {
    await pgMarkEscalaLembreteEnviado(igrejaId, tipo, cultoDataYmd, sent);
  }

  return { sent, failed, total: recipients.length, cultoDataYmd, tipo };
}

/** Job: segunda (quarta) e quinta (domingo) pela manhã, para todas as igrejas. */
export async function runEscalaLembreteEmailJob() {
  if ((process.env.ESCALA_LEMBRETE_EMAIL || 'true').toLowerCase() === 'false') {
    return { skipped: true, reason: 'disabled' };
  }
  if (!isEscalaLembreteMorningWindow()) {
    return { skipped: true, reason: 'outside_window' };
  }

  const hoje = getHojeDateString();
  const tipo = resolveEscalaLembreteTipoForToday(hoje);
  if (!tipo) return { skipped: true, reason: 'not_scheduled_day' };

  const cultoDataYmd = getCultoDataYmdForLembrete(tipo, hoje);
  if (!cultoDataYmd) return { skipped: true, reason: 'no_culto_date' };

  const igrejas = await pgListIgrejas();
  let totalSent = 0;
  let totalFailed = 0;
  let processed = 0;

  for (const ig of igrejas) {
    if (await pgWasEscalaLembreteEnviado(ig._id, tipo, cultoDataYmd)) continue;
    try {
      const r = await sendEscalaLembreteEmailsForIgreja({
        igrejaId: ig._id,
        tipo,
        cultoDataYmd,
      });
      processed += 1;
      totalSent += r.sent || 0;
      totalFailed += r.failed || 0;
      if ((r.sent || 0) > 0) {
        console.log(`✉️ Lembrete escala ${tipo}: ${r.sent}/${r.total} — ${ig.nome} (${cultoDataYmd})`);
      } else if (r.reason === 'no_escalas') {
        console.log(`⏭️ Lembrete escala ${tipo}: sem escalas em ${cultoDataYmd} — ${ig.nome}`);
      }
    } catch (e) {
      console.error('runEscalaLembreteEmailJob igreja', ig._id, e?.message || e);
    }
  }

  return { tipo, cultoDataYmd, processed, sent: totalSent, failed: totalFailed };
}

function escapeHtmlEmail(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

export function buildEscalaAberturaCustomEmailHtml({
  nome,
  mensagemHtml,
  escalasResumo,
  ministerioLinks,
  igrejaNome,
}) {
  const n = (nome || '').trim() || 'voluntário(a)';
  const ig = (igrejaNome || 'Celeiro São Paulo').trim();
  const intro = mensagemHtml?.trim()
    ? `<div style="margin:0 0 20px;font-size:16px;color:#374151;line-height:1.6;">${mensagemHtml}</div>`
    : `<p style="margin:0 0 20px;font-size:16px;color:#374151;line-height:1.6;">As inscrições para as escalas abaixo estão disponíveis. Que tal se inscrever para servir?</p>`;

  const escalasHtml = (escalasResumo || []).map((e) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
        <p style="margin:0 0 6px;font-size:15px;color:#111827;font-weight:600;">${escapeHtmlEmail(e.nome).replace(/&lt;br&gt;/g, '<br>')}</p>
        <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">${escapeHtmlEmail(e.dataLabel).replace(/&lt;br&gt;/g, '<br>')}</p>
        <a href="${e.url}" style="font-size:14px;color:#f59e0b;font-weight:600;text-decoration:none;">Ver escala e inscrever-se →</a>
      </td>
    </tr>`).join('');

  const ministeriosHtml = (ministerioLinks || []).length
    ? (ministerioLinks || []).map((m, i) => `
      <p style="margin:0 0 10px;">
        <a href="${m.url}" style="display:inline-block;background:${i === 0 ? '#1a1a2e' : '#374151'};color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">${escapeHtmlEmail(m.ministerio).replace(/&lt;br&gt;/g, '<br>')}</a>
      </p>`).join('')
    : `<p style="margin:0;font-size:14px;color:#6b7280;">Acesse o link da escala acima e escolha o ministério em que deseja servir.</p>`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Inscrições na escala</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <tr><td style="background:#1a1a2e;padding:28px 36px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#f59e0b;text-transform:uppercase;letter-spacing:.08em;font-weight:600;">${ig}</p>
    <h1 style="margin:8px 0 0;font-size:22px;color:#fff;font-weight:700;">Inscrições abertas na escala</h1>
  </td></tr>
  <tr><td style="padding:36px;">
    <p style="margin:0 0 14px;font-size:16px;color:#374151;line-height:1.6;">Olá, <strong>${escapeHtmlEmail(n).replace(/&lt;br&gt;/g, '<br>')}</strong>!</p>
    ${intro}
    ${escalasResumo?.length ? `
    <h2 style="margin:0 0 12px;font-size:15px;color:#111827;text-transform:uppercase;letter-spacing:.04em;">Escalas selecionadas</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${escalasHtml}</table>` : ''}
    <h2 style="margin:0 0 12px;font-size:15px;color:#111827;text-transform:uppercase;letter-spacing:.04em;">Seus ministérios</h2>
    <p style="margin:0 0 14px;font-size:14px;color:#6b7280;line-height:1.5;">Links diretos com base nos ministérios em que você já serviu:</p>
    ${ministeriosHtml}
  </td></tr>
  <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">Equipe de Voluntários · ${ig}</p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

export async function sendEscalaAberturaEmailsCustom({
  igrejaId,
  escalaIds,
  mensagem = '',
  destinatarios = 'todos',
  appBase,
}) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_resend' };

  const ids = [...new Set((escalaIds || []).map(String).filter(Boolean))];
  if (!ids.length) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_escalas' };
  }

  const dest = destinatarios === 'ativos' ? 'ativos' : 'todos';
  const upcomingEscalas = await pgFindEscalasByIds(igrejaId, ids);
  const abertas = upcomingEscalas.filter((e) => e.ativo !== false);
  if (!abertas.length) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_escalas_ativas' };
  }

  const igreja = await pgFindIgrejaById(igrejaId);
  const slug = igreja?.slug || 'celeiro-sp';
  const base = (appBase || process.env.APP_URL || 'https://voluntariosceleirosp.com').replace(/\/$/, '');
  const mensagemHtml = escapeHtmlEmail(mensagem);

  const escalasResumo = abertas.map((e) => {
    const ymd = escalaDataToYMD(e.data);
    return {
      nome: (e.nome || 'Escala').trim(),
      dataLabel: ymd ? formatDataPtBr(ymd) : '',
      url: buildEscalaPublicUrl({ appBase: base, escalaId: e._id, igrejaSlug: slug }),
    };
  });

  const recipients = await pgResolveDestinatariosEscalaEmail(igrejaId, { destinatarios: dest });
  if (!recipients.length) {
    return { sent: 0, failed: 0, total: 0, skipped: true, reason: 'no_recipients' };
  }

  const historicoMap = await pgMapUltimosMinisteriosServidos(igrejaId, { perEmail: 3 });
  const pastEscalaIds = [...new Set(
    [...historicoMap.values()].flat().map((h) => h.escalaId).filter(Boolean),
  )];
  const pastEscalas = pastEscalaIds.length
    ? await pgFindEscalasByIds(igrejaId, pastEscalaIds)
    : [];
  const pastEscalaById = new Map(pastEscalas.map((e) => [String(e._id), e]));

  const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
  const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
  const resend = new Resend(apiKey);
  const tituloEscalas = abertas.length === 1
    ? (abertas[0].nome || 'Escala')
    : `${abertas.length} escalas abertas`;
  const subject = `Inscrições abertas — ${tituloEscalas}`;

  let sent = 0;
  let failed = 0;
  for (const voluntario of recipients) {
    const email = (voluntario.email || '').toLowerCase().trim();
    if (!email) continue;
    const mins = resolveMinisteriosForVoluntario(email, historicoMap, voluntario, 3);
    const ministerioLinks = mins.map((m) => {
      const escala = pickEscalaForMinisterioLink({
        ministerioEntry: m,
        upcomingEscalas: abertas,
        pastEscalaById,
      });
      if (!escala) return null;
      return {
        ministerio: m.ministerio,
        url: buildEscalaPublicUrl({
          appBase: base,
          escalaId: escala._id,
          igrejaSlug: slug,
          ministerio: m.ministerio,
        }),
      };
    }).filter(Boolean);

    try {
      const { error } = await resend.emails.send({
        from,
        to: email,
        reply_to: replyTo,
        subject,
        html: buildEscalaAberturaCustomEmailHtml({
          nome: voluntario.nome,
          mensagemHtml,
          escalasResumo,
          ministerioLinks,
          igrejaNome: igreja?.nome,
        }),
      });
      if (error) {
        failed += 1;
        console.warn(`escala abertura email ${email}:`, error.message || error);
      } else {
        sent += 1;
      }
    } catch (e) {
      failed += 1;
      console.warn(`escala abertura email ${email}:`, e?.message || e);
    }
    if (recipients.length > 1) {
      await new Promise((r) => setTimeout(r, Number(process.env.EMAIL_SEND_DELAY_MS) || 450));
    }
  }

  return { sent, failed, total: recipients.length, escalaIds: ids, destinatarios: dest };
}

export async function previewEscalaAberturaEmail(igrejaId, { escalaIds, destinatarios = 'todos' } = {}) {
  const ids = [...new Set((escalaIds || []).map(String).filter(Boolean))];
  const escalas = ids.length ? await pgFindEscalasByIds(igrejaId, ids) : [];
  const [todos, ativos] = await Promise.all([
    pgResolveDestinatariosEscalaEmail(igrejaId, { destinatarios: 'todos' }),
    pgResolveDestinatariosEscalaEmail(igrejaId, { destinatarios: 'ativos' }),
  ]);
  const dest = destinatarios === 'ativos' ? 'ativos' : 'todos';
  return {
    escalas: escalas.map((e) => ({
      id: String(e._id),
      nome: e.nome || '',
      data: escalaDataToYMD(e.data),
      ativo: e.ativo !== false,
    })),
    totalTodos: todos.length,
    totalAtivos: ativos.length,
    totalSelecionado: dest === 'ativos' ? ativos.length : todos.length,
    destinatarios: dest,
  };
}
