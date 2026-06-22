/** URL e remetente padrão da plataforma (sobrescreva com APP_URL / RESEND_FROM_EMAIL no Railway). */
export const DEFAULT_APP_URL = 'https://app.celeirosp.com';

export const DEFAULT_RESEND_FROM_EMAIL = 'Celeiro São Paulo <voluntarios@celeirosp.com>';

/** Hosts antigos que redirecionam 301 para APP_URL (LEGACY_REDIRECT_HOSTS, vírgula). */
export function legacyRedirectHosts() {
  const raw = Object.prototype.hasOwnProperty.call(process.env, 'LEGACY_REDIRECT_HOSTS')
    ? process.env.LEGACY_REDIRECT_HOSTS
    : 'voluntariosceleirosp.com,www.voluntariosceleirosp.com';
  if (raw == null) return [];
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized || normalized === '_disabled_' || normalized === 'disabled' || normalized === 'none') return [];
  return (raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeAppBase(appBase) {
  const b = (appBase || process.env.APP_URL || '').trim().replace(/\/$/, '');
  return b || DEFAULT_APP_URL;
}

export function resolveAppBaseUrl(req) {
  const fromEnv = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const host = (req?.get?.('host') || '').trim();
  if (host) {
    const xf = req.get('x-forwarded-proto');
    const proto = (xf && String(xf).split(',')[0].trim()) || (req.secure ? 'https' : (req.protocol || 'http'));
    return `${proto}://${host}`;
  }
  return DEFAULT_APP_URL;
}

export function defaultResendFrom() {
  return (process.env.RESEND_FROM_EMAIL || DEFAULT_RESEND_FROM_EMAIL).trim();
}
