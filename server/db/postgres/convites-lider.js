import { randomBytes, randomUUID } from 'crypto';
import { getPostgresPool } from './init.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS convites_lider (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  ministerio_id TEXT NOT NULL REFERENCES ministerios(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  usos_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (igreja_id, ministerio_id)
);
CREATE INDEX IF NOT EXISTS convites_lider_token_idx ON convites_lider (token);
`;

export async function migrateConvitesLiderSchema() {
  await getPostgresPool().query(SCHEMA_SQL);
}

function newToken() {
  return randomBytes(24).toString('hex');
}

function defaultExpiresAt() {
  const days = Number(process.env.LIDER_INVITE_DAYS || 90);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function pgFindConviteByToken(token) {
  const { rows } = await getPostgresPool().query(
    `SELECT c.id, c.igreja_id, c.ministerio_id, c.token, c.usos_count, c.expires_at, c.ativo,
            m.nome AS ministerio_nome, i.nome AS igreja_nome, i.slug AS igreja_slug
     FROM convites_lider c
     JOIN ministerios m ON m.id = c.ministerio_id
     JOIN igrejas i ON i.id = c.igreja_id
     WHERE c.token = $1 LIMIT 1`,
    [token],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    _id: r.id,
    igrejaId: r.igreja_id,
    ministerioId: r.ministerio_id,
    token: r.token,
    usosCount: r.usos_count,
    expiresAt: r.expires_at,
    ativo: r.ativo,
    ministerioNome: r.ministerio_nome,
    igrejaNome: r.igreja_nome,
    igrejaSlug: r.igreja_slug,
  };
}

export function conviteLiderValido(convite) {
  if (!convite || !convite.ativo) return false;
  if (convite.expiresAt && new Date(convite.expiresAt).getTime() < Date.now()) return false;
  return true;
}

export async function pgUpsertConviteLider(igrejaId, ministerioId, { regenerar = false } = {}) {
  const token = newToken();
  const expiresAt = defaultExpiresAt();
  const { rows: existing } = await getPostgresPool().query(
    'SELECT id, token FROM convites_lider WHERE igreja_id = $1 AND ministerio_id = $2',
    [igrejaId, ministerioId],
  );
  if (existing[0] && !regenerar) {
    return pgFindConviteByToken(existing[0].token);
  }
  const id = existing[0]?.id || randomUUID();
  await getPostgresPool().query(
    `INSERT INTO convites_lider (id, igreja_id, ministerio_id, token, usos_count, expires_at, ativo)
     VALUES ($1, $2, $3, $4, 0, $5, TRUE)
     ON CONFLICT (igreja_id, ministerio_id) DO UPDATE SET
       token = EXCLUDED.token,
       usos_count = CASE WHEN $6 THEN 0 ELSE convites_lider.usos_count END,
       expires_at = EXCLUDED.expires_at,
       ativo = TRUE`,
    [id, igrejaId, ministerioId, token, expiresAt, !!regenerar],
  );
  return pgFindConviteByToken(token);
}

export async function pgListConvitesLider(igrejaId) {
  const { rows } = await getPostgresPool().query(
    `SELECT c.id, c.ministerio_id, c.token, c.usos_count, c.expires_at, c.ativo, m.nome AS ministerio_nome
     FROM convites_lider c
     JOIN ministerios m ON m.id = c.ministerio_id
     WHERE c.igreja_id = $1
     ORDER BY m.nome`,
    [igrejaId],
  );
  return rows.map((r) => ({
    ministerioId: r.ministerio_id,
    ministerioNome: r.ministerio_nome,
    token: r.token,
    usosCount: r.usos_count,
    expiresAt: r.expires_at,
    ativo: r.ativo,
  }));
}

export async function pgIncrementConviteUso(token) {
  await getPostgresPool().query(
    'UPDATE convites_lider SET usos_count = usos_count + 1 WHERE token = $1',
    [token],
  );
}
