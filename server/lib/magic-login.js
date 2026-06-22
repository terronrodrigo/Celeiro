import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pgFindIgrejaById, pgFindUserByEmailInIgreja, pgCreateUser, pgFindVoluntarioByEmail } from '../db/postgres/repos.js';
import { pgEnsureVoluntarioInList } from '../db/postgres/operational-data.js';
import { pgGetOrCreateShortLink } from '../db/postgres/short-links.js';
import {
  pgInsertMagicLoginToken,
  pgFindMagicLoginToken,
  pgMarkMagicLoginTokenUsed,
} from '../db/postgres/magic-login.js';
import { EMAIL_COLORS, escapeHtml } from './email-layout.js';
import { normalizeAppBase } from './app-url.js';

const MAGIC_LINK_TTL_DAYS = Number(process.env.MAGIC_LINK_TTL_DAYS || 14);

function magicLinkTtlMs() {
  return MAGIC_LINK_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export function buildMagicLoginTarget({ token, igrejaSlug, redirectView }) {
  const t = String(token || '').trim();
  if (!t) return '';
  const qs = new URLSearchParams({ entrar: t });
  const slug = (igrejaSlug || 'celeiro-sp').toString().trim().toLowerCase();
  if (slug) qs.set('igreja', slug);
  if (redirectView) qs.set('view', redirectView);
  return `/?${qs.toString()}`;
}

export async function buildMagicLoginUrl({
  token,
  igrejaSlug,
  igrejaId,
  appBase,
  useShortLink = true,
}) {
  const base = normalizeAppBase(appBase);
  const target = buildMagicLoginTarget({ token, igrejaSlug });
  if (!target) return base;
  if (useShortLink && igrejaId) {
    try {
      const code = await pgGetOrCreateShortLink(target, igrejaId);
      if (code) return `${base}/f/${code}`;
    } catch (_) { /* fallback long url */ }
  }
  return `${base}${target}`;
}

/** Garante conta role=voluntario para magic link (cria senha aleatória interna). */
export async function ensureVoluntarioUserForMagicLogin(igrejaId, email, nomeHint = '') {
  const em = String(email || '').toLowerCase().trim();
  if (!em || !em.includes('@') || !igrejaId) return null;

  let user = await pgFindUserByEmailInIgreja(igrejaId, em);
  if (user) return user;

  const vol = await pgFindVoluntarioByEmail(igrejaId, em);
  const nome = (nomeHint || vol?.nome || em).toString().trim() || em;
  const senhaInterna = crypto.randomBytes(32).toString('hex');
  user = await pgCreateUser({
    email: em,
    nome,
    senha: senhaInterna,
    role: 'voluntario',
    igrejaId,
    mustChangePassword: false,
  });
  await pgEnsureVoluntarioInList({ email: em, nome, igrejaId, fonte: 'magic_link' });
  return user;
}

/** Cria token de acesso direto e retorna URL pronta para email. */
export async function createMagicLoginLinkForEmail({
  igrejaId,
  email,
  nome,
  appBase,
  redirectView = 'escalas',
  useShortLink = true,
}) {
  const em = String(email || '').toLowerCase().trim();
  if (!em || !em.includes('@') || !igrejaId) return null;

  const user = await ensureVoluntarioUserForMagicLogin(igrejaId, em, nome);
  if (!user) return null;

  const igreja = await pgFindIgrejaById(igrejaId);
  const slug = igreja?.slug || 'celeiro-sp';
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + magicLinkTtlMs();

  await pgInsertMagicLoginToken({
    token,
    igrejaId,
    email: em,
    userId: user._id,
    redirectView,
    expiresAt,
  });

  const url = await buildMagicLoginUrl({
    token,
    igrejaSlug: slug,
    igrejaId,
    appBase,
    useShortLink,
  });

  return { url, token, expiresAt, userId: user._id };
}

/** Valida token e retorna usuário para login. Token de uso único. */
export async function consumeMagicLoginToken(token) {
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'Link inválido.' };

  const row = await pgFindMagicLoginToken(t);
  if (!row) return { ok: false, error: 'Link inválido ou expirado.' };
  if (row.used_at) return { ok: false, error: 'Este link já foi utilizado. Solicite um novo email ou faça login com senha.' };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Link expirado. Faça login com email e senha ou aguarde um novo email.' };
  }

  const igrejaId = row.igreja_id;
  const email = String(row.email || '').toLowerCase().trim();
  let user = row.user_id
    ? await pgFindUserByEmailInIgreja(igrejaId, email)
    : await ensureVoluntarioUserForMagicLogin(igrejaId, email);
  if (!user) return { ok: false, error: 'Conta não encontrada para este link.' };

  await pgMarkMagicLoginTokenUsed(t);

  return {
    ok: true,
    user,
    redirectView: row.redirect_view || 'escalas',
  };
}

/** Bloco HTML padrão para emails transacionais. */
export function buildPlatformAccessEmailBlock({
  magicLoginUrl,
  title = 'Acesse sua conta na plataforma',
  hint = 'Entre com um clique — sem precisar de senha neste link.',
  ctaLabel = 'Acessar minha conta →',
  platformExtra = ' Veja suas escalas, histórico de check-ins e mantenha seu perfil atualizado.',
}) {
  const url = String(magicLoginUrl || '').trim();
  if (!url) return '';
  const display = escapeHtml(url);
  const extra = platformExtra ? escapeHtml(platformExtra) : '';
  return `
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:28px 0 0;padding:20px;background:${EMAIL_COLORS.accentSoft};border:1px solid ${EMAIL_COLORS.border};border-radius:12px;">
      <tr><td>
        <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:${EMAIL_COLORS.text};">${escapeHtml(title)}</p>
        <p style="margin:0 0 14px;font-size:14px;color:${EMAIL_COLORS.textSecondary};line-height:1.55;">${escapeHtml(hint)}${extra}</p>
        <table cellpadding="0" cellspacing="0" role="presentation"><tr><td style="border-radius:10px;background:${EMAIL_COLORS.accent};">
          <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#fff;text-decoration:none;border-radius:10px;">${escapeHtml(ctaLabel)}</a>
        </td></tr></table>
        <p style="margin:14px 0 0;font-size:12px;color:${EMAIL_COLORS.textMuted};word-break:break-all;">${display}</p>
      </td></tr>
    </table>`;
}
