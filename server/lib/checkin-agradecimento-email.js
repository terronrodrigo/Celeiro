import { BRAND_NAME } from './brand.js';
import { Resend } from 'resend';
import {
  addDaysYmd,
  formatDataPtBr,
  escalaDataToYMD,
  getHojeDateString,
} from './brasilia.js';
import { isEscalaAbertaParaCandidatura, getNowHHMMBrasilia } from './escala-checkin-rules.js';
import { buildEscalaPublicUrl } from './escala-public-url.js';
import { isEscalaLembreteMorningWindow } from './escala-lembrete-email.js';
import { pgFindIgrejaById } from '../db/postgres/repos.js';
import { pgHistoricoVoluntario } from '../db/postgres/historico-voluntario.js';
import { pgFindCultoRecorrente } from '../db/postgres/cultos-recorrentes.js';
import {
  pgListEscalas,
  pgListCheckinAgradecimentoPendentes,
  pgMarkCheckinAgradecimentoEnviado,
} from '../db/postgres/escalas-checkin.js';
import { createMagicLoginLinkForEmail, buildPlatformAccessEmailBlock } from './magic-login.js';
import { buildCeleiroEmailHtml, EMAIL_COLORS } from './email-layout.js';

function escapeHtmlEmail(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isCheckinAgradecimentoMorningWindow(now = new Date()) {
  return isEscalaLembreteMorningWindow(now);
}

export async function listProximasEscalasAbertas(igrejaId, { limit = 3, appBase, igrejaSlug } = {}) {
  const hoje = getHojeDateString();
  const escalas = await pgListEscalas(igrejaId, {
    ativoOnly: true,
    futureOnly: true,
    nextPerCultoOnly: true,
    limit: 40,
  });
  const cultoIds = [...new Set(escalas.map((e) => e.cultoRecorrenteId).filter(Boolean))];
  const cultoMap = new Map();
  await Promise.all(cultoIds.map(async (id) => {
    const c = await pgFindCultoRecorrente(id, igrejaId);
    if (c) cultoMap.set(id, c);
  }));
  const base = (appBase || process.env.APP_URL || 'https://voluntariosceleirosp.com').replace(/\/$/, '');
  const slug = igrejaSlug || 'celeiro-sp';
  const abertas = [];
  for (const e of escalas) {
    const culto = e.cultoRecorrenteId ? cultoMap.get(e.cultoRecorrenteId) : null;
    if (!isEscalaAbertaParaCandidatura(e, culto, hoje)) continue;
    const ymd = escalaDataToYMD(e.data);
    abertas.push({
      nome: (e.nome || 'Escala').trim(),
      dataLabel: ymd ? formatDataPtBr(ymd) : '',
      url: buildEscalaPublicUrl({ appBase: base, escalaId: e._id, igrejaSlug: slug }),
    });
    if (abertas.length >= limit) break;
  }
  return abertas;
}

export function buildCheckinAgradecimentoEmailHtml({
  nome,
  checkinDataLabel,
  ministerioOntem,
  vezesEscalaInscricao,
  vezesCheckin,
  proximasEscalas,
  igrejaNome,
  platformAccessHtml = '',
  appBase,
}) {
  const c = EMAIL_COLORS;
  const n = escapeHtmlEmail((nome || '').trim() || 'voluntário(a)');
  const ig = escapeHtmlEmail((igrejaNome || 'Celeiro São Paulo').trim());
  const dataLabel = escapeHtmlEmail(checkinDataLabel || 'ontem');
  const minOntem = escapeHtmlEmail(ministerioOntem || '');

  const kpiBlock = `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 24px;background:${c.accentSoft};border-radius:12px;border:1px solid ${c.border};">
      <tr>
        <td style="padding:16px 20px;width:50%;text-align:center;border-right:1px solid ${c.border};">
          <p style="margin:0;font-size:11px;color:${c.textMuted};text-transform:uppercase;letter-spacing:.06em;">Participações em escala</p>
          <p style="margin:6px 0 0;font-size:28px;font-weight:700;color:${c.text};">${Number(vezesEscalaInscricao) || 0}</p>
        </td>
        <td style="padding:16px 20px;width:50%;text-align:center;">
          <p style="margin:0;font-size:11px;color:${c.textMuted};text-transform:uppercase;letter-spacing:.06em;">Check-ins realizados</p>
          <p style="margin:6px 0 0;font-size:28px;font-weight:700;color:${c.accent};">${Number(vezesCheckin) || 0}</p>
        </td>
      </tr>
    </table>`;

  const escalasHtml = (proximasEscalas || []).length
    ? (proximasEscalas || []).map((e) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${c.border};">
          <p style="margin:0 0 4px;font-size:15px;color:${c.text};font-weight:600;">${escapeHtmlEmail(e.nome)}</p>
          <p style="margin:0 0 8px;font-size:13px;color:${c.textSecondary};">${escapeHtmlEmail(e.dataLabel)}</p>
          <a href="${e.url}" style="font-size:14px;color:${c.accent};font-weight:600;text-decoration:none;">Inscrever-se na escala →</a>
        </td>
      </tr>`).join('')
    : '';

  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:13px;color:${c.textMuted};text-transform:uppercase;letter-spacing:.06em;">${ig}</p>
    <p style="margin:0 0 14px;">Olá, <strong>${n}</strong>!</p>
    <p style="margin:0 0 20px;color:${c.textSecondary};">
      Registramos seu check-in em <strong style="color:${c.text};">${dataLabel}</strong>${minOntem ? ` no ministério <strong style="color:${c.text};">${minOntem}</strong>` : ''}.
      Muito obrigado por servir conosco — sua participação faz toda a diferença!
    </p>
    <h2 style="margin:0 0 12px;font-size:14px;color:${c.text};text-transform:uppercase;letter-spacing:.04em;">Sua jornada até aqui</h2>
    ${kpiBlock}
    ${escalasHtml ? `
    <h2 style="margin:0 0 12px;font-size:14px;color:${c.text};text-transform:uppercase;letter-spacing:.04em;">Próximas escalas abertas</h2>
    <p style="margin:0 0 14px;font-size:14px;color:${c.textSecondary};">Que tal já se inscrever para servir de novo?</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 8px;">${escalasHtml}</table>` : ''}
    <p style="margin:16px 0 0;font-size:14px;color:${c.textMuted};">Contamos com você. Até o próximo culto!</p>`;

  return buildCeleiroEmailHtml({
    title: 'Obrigado por servir!',
    preheader: `Check-in registrado em ${checkinDataLabel || 'ontem'}`,
    bodyHtml,
    afterCtaHtml: platformAccessHtml,
    footerNote: BRAND_NAME,
    appBase,
  });
}

export async function sendCheckinAgradecimentoEmail({
  igrejaId,
  email,
  nome,
  ministerio,
  checkinYmd,
  appBase,
}) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { sent: 0, skipped: true, reason: 'no_resend' };

  const em = String(email || '').toLowerCase().trim();
  if (!em || !em.includes('@')) return { sent: 0, skipped: true, reason: 'invalid_email' };

  const igreja = await pgFindIgrejaById(igrejaId);
  const slug = igreja?.slug || 'celeiro-sp';
  const base = (appBase || process.env.APP_URL || 'https://voluntariosceleirosp.com').replace(/\/$/, '');

  const [{ resumo }, proximasEscalas] = await Promise.all([
    pgHistoricoVoluntario(igrejaId, em),
    listProximasEscalasAbertas(igrejaId, { limit: 3, appBase: base, igrejaSlug: slug }),
  ]);

  const from = process.env.RESEND_FROM_EMAIL || 'Celeiro São Paulo <info@voluntariosceleirosp.com>';
  const replyTo = process.env.RESEND_REPLY_TO || 'voluntariosceleiro@gmail.com';
  const resend = new Resend(apiKey);
  const dataLabel = formatDataPtBr(checkinYmd);
  const subject = `Obrigado por servir — ${dataLabel}`;

  let platformAccessHtml = '';
  try {
    const magic = await createMagicLoginLinkForEmail({
      igrejaId,
      email: em,
      nome,
      appBase: base,
      redirectView: 'escalas',
    });
    if (magic?.url) platformAccessHtml = buildPlatformAccessEmailBlock({ magicLoginUrl: magic.url });
  } catch (_) { /* opcional */ }

  const { error } = await resend.emails.send({
    from,
    to: em,
    reply_to: replyTo,
    subject,
    html: buildCheckinAgradecimentoEmailHtml({
      nome,
      checkinDataLabel: dataLabel,
      ministerioOntem: ministerio,
      vezesEscalaInscricao: resumo?.vezesEscalaInscricao ?? 0,
      vezesCheckin: resumo?.vezesCheckin ?? 0,
      proximasEscalas,
      igrejaNome: igreja?.nome,
      platformAccessHtml,
      appBase: base,
    }),
  });

  if (error) {
    console.warn(`checkin agradecimento ${em}:`, error.message || error);
    return { sent: 0, failed: 1, error: error.message || String(error) };
  }

  await pgMarkCheckinAgradecimentoEnviado(igrejaId, em, checkinYmd);
  return { sent: 1, failed: 0 };
}

/** Job diário: agradece check-ins de ontem (janela matinal, Brasília). */
export async function runCheckinAgradecimentoEmailJob() {
  if ((process.env.CHECKIN_AGRADECIMENTO_EMAIL || 'true').toLowerCase() === 'false') {
    return { skipped: true, reason: 'disabled' };
  }
  if (!isCheckinAgradecimentoMorningWindow()) {
    return { skipped: true, reason: 'outside_window', hhmm: getNowHHMMBrasilia() };
  }

  const hoje = getHojeDateString();
  const ontem = addDaysYmd(hoje, -1);
  if (!ontem) return { skipped: true, reason: 'no_yesterday' };

  const pendentes = await pgListCheckinAgradecimentoPendentes(ontem);
  if (!pendentes.length) {
    return { skipped: true, reason: 'none_pending', checkinYmd: ontem };
  }

  let sent = 0;
  let failed = 0;
  for (const p of pendentes) {
    try {
      const r = await sendCheckinAgradecimentoEmail({
        igrejaId: p.igrejaId,
        email: p.email,
        nome: p.nome,
        ministerio: p.ministerio,
        checkinYmd: ontem,
      });
      if (r.sent) sent += 1;
      else if (r.failed) failed += 1;
    } catch (e) {
      failed += 1;
      console.warn(`checkin agradecimento job ${p.email}:`, e?.message || e);
    }
    if (pendentes.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.EMAIL_SEND_DELAY_MS) || 450));
    }
  }

  if (sent > 0) {
    console.log(`✉️ Check-in agradecimento (${ontem}): ${sent}/${pendentes.length} enviado(s).`);
  }

  return { checkinYmd: ontem, total: pendentes.length, sent, failed };
}
