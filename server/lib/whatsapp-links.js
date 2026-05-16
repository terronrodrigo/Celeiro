/**
 * Links click-to-chat (wa.me) — sem custo de API Meta.
 * O líder envia do próprio WhatsApp; não abre janela de cobrança da Cloud API.
 */

/** Dígitos E.164 Brasil: 55 + DDD + número (10–11 dígitos locais). */
export function phoneToWaMeDigits(phoneRaw) {
  let d = String(phoneRaw || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length > 11 && d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d.length >= 12 ? d : null;
}

export function buildWaMeUrl(phoneRaw, message) {
  const digits = phoneToWaMeDigits(phoneRaw);
  if (!digits) return null;
  const text = encodeURIComponent(String(message || '').trim());
  return `https://wa.me/${digits}${text ? `?text=${text}` : ''}`;
}

export function buildMensagemAprovacaoEscala({
  nomeVoluntario,
  escalaNome,
  escalaDataLabel,
  checkinUrl,
  liderNome,
}) {
  const nome = (nomeVoluntario || '').trim() || 'voluntário(a)';
  const escala = (escalaNome || '').trim() || 'o culto';
  const data = escalaDataLabel ? ` (${escalaDataLabel})` : '';
  const lider = (liderNome || '').trim();
  const saudacao = lider ? `Olá ${nome}! Aqui é ${lider}, do time de voluntários.` : `Olá ${nome}!`;
  let msg = `${saudacao}\n\nSua participação na escala *${escala}*${data} foi confirmada. Obrigado por servir conosco!`;
  if (checkinUrl) {
    msg += `\n\nNo dia do culto, faça seu check-in de presença por este link:\n${checkinUrl}`;
  }
  msg += '\n\nQualquer dúvida, responda por aqui.';
  return msg;
}
