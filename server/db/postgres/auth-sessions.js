import { randomUUID } from 'crypto';
import { getPostgresPool } from './init.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'voluntario',
  email TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  ministerio_id TEXT,
  ministerio_nome TEXT,
  ministerio_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ministerio_nomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  igreja_id TEXT,
  is_global_admin BOOLEAN NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions (expires_at);
`;

export async function migrateAuthSessionsSchema() {
  await getPostgresPool().query(SCHEMA_SQL);
}

function parseJsonArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch (_) { return []; }
  }
  return [];
}

function rowToSession(row) {
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  const ministerioNomes = parseJsonArray(row.ministerio_nomes);
  const ministerioIds = parseJsonArray(row.ministerio_ids);
  return {
    user: row.display_name || row.email || 'Usuário',
    userId: row.user_id || null,
    role: row.role || 'voluntario',
    email: row.email || null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    ministerioId: row.ministerio_id || ministerioIds[0] || null,
    ministerioNome: row.ministerio_nome || ministerioNomes[0] || null,
    ministerioIds,
    ministerioNomes,
    igrejaId: row.igreja_id || null,
    isGlobalAdmin: !!row.is_global_admin,
    mustChangePassword: !!row.must_change_password,
  };
}

export async function pgSaveAuthSession(token, data) {
  const ministerioIds = Array.isArray(data.ministerioIds) ? data.ministerioIds : [];
  const ministerioNomes = Array.isArray(data.ministerioNomes) ? data.ministerioNomes : [];
  await getPostgresPool().query(
    `INSERT INTO auth_sessions (
      token, user_id, display_name, role, email, expires_at,
      ministerio_id, ministerio_nome, ministerio_ids, ministerio_nomes,
      igreja_id, is_global_admin, must_change_password
    ) VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0),$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13)
    ON CONFLICT (token) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      display_name = EXCLUDED.display_name,
      role = EXCLUDED.role,
      email = EXCLUDED.email,
      expires_at = EXCLUDED.expires_at,
      ministerio_id = EXCLUDED.ministerio_id,
      ministerio_nome = EXCLUDED.ministerio_nome,
      ministerio_ids = EXCLUDED.ministerio_ids,
      ministerio_nomes = EXCLUDED.ministerio_nomes,
      igreja_id = EXCLUDED.igreja_id,
      is_global_admin = EXCLUDED.is_global_admin,
      must_change_password = EXCLUDED.must_change_password`,
    [
      token,
      data.userId || null,
      data.user || '',
      data.role || 'voluntario',
      data.email || null,
      data.expiresAt,
      data.ministerioId || null,
      data.ministerioNome || null,
      JSON.stringify(ministerioIds),
      JSON.stringify(ministerioNomes),
      data.igrejaId || null,
      !!data.isGlobalAdmin,
      !!data.mustChangePassword,
    ],
  );
}

export async function pgLoadAuthSession(token) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM auth_sessions WHERE token = $1 LIMIT 1',
    [token],
  );
  return rowToSession(rows[0]);
}

export async function pgDeleteAuthSession(token) {
  await getPostgresPool().query('DELETE FROM auth_sessions WHERE token = $1', [token]);
}

/** Remove sessões expiradas (chamada ocasional no boot). */
export async function pgPurgeExpiredAuthSessions() {
  await getPostgresPool().query('DELETE FROM auth_sessions WHERE expires_at < NOW()');
}
