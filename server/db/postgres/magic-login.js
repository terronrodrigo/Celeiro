import { randomUUID } from 'crypto';
import { getPostgresPool } from './init.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS magic_login_tokens (
  token TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  redirect_view TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS magic_login_tokens_email_idx ON magic_login_tokens (igreja_id, LOWER(email));
CREATE INDEX IF NOT EXISTS magic_login_tokens_expires_idx ON magic_login_tokens (expires_at);
`;

export async function migrateMagicLoginSchema() {
  await getPostgresPool().query(SCHEMA_SQL);
}

export async function pgInsertMagicLoginToken({
  token,
  igrejaId,
  email,
  userId = null,
  redirectView = null,
  expiresAt,
}) {
  const em = String(email || '').toLowerCase().trim();
  if (!token || !igrejaId || !em || !expiresAt) return;
  await getPostgresPool().query(
    `INSERT INTO magic_login_tokens (token, igreja_id, email, user_id, redirect_view, expires_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))`,
    [token, igrejaId, em, userId, redirectView, expiresAt],
  );
}

export async function pgFindMagicLoginToken(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  const { rows } = await getPostgresPool().query(
    `SELECT token, igreja_id, email, user_id, redirect_view, expires_at, used_at
     FROM magic_login_tokens WHERE token = $1 LIMIT 1`,
    [t],
  );
  return rows[0] || null;
}

export async function pgMarkMagicLoginTokenUsed(token) {
  await getPostgresPool().query(
    `UPDATE magic_login_tokens SET used_at = NOW() WHERE token = $1 AND used_at IS NULL`,
    [token],
  );
}

export async function pgPurgeExpiredMagicLoginTokens() {
  await getPostgresPool().query('DELETE FROM magic_login_tokens WHERE expires_at < NOW()');
}
