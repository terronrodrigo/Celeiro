import { getPostgresPool } from './init.js';

// Alfabeto sem caracteres ambíguos (0/O, 1/l/I) para links curtos legíveis.
const SHORT_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
function generateCode(len = 7) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
  }
  return out;
}

let ensured = false;
async function ensureOnce() {
  if (ensured) return;
  ensured = true;
  await getPostgresPool().query(`
    CREATE TABLE IF NOT EXISTS short_links (
      code TEXT PRIMARY KEY,
      target TEXT NOT NULL UNIQUE,
      igreja_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => {});
}

/** Retorna o code existente para o target, ou cria um novo (idempotente). */
export async function pgGetOrCreateShortLink(target, igrejaId = null) {
  await ensureOnce();
  const pool = getPostgresPool();
  const existing = await pool.query('SELECT code FROM short_links WHERE target = $1 LIMIT 1', [target]);
  if (existing.rows[0]) return existing.rows[0].code;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO short_links (code, target, igreja_id) VALUES ($1, $2, $3)
         ON CONFLICT (target) DO UPDATE SET target = EXCLUDED.target
         RETURNING code`,
        [generateCode(), target, igrejaId],
      );
      return rows[0]?.code || null;
    } catch (e) {
      if (attempt === 4) throw e; // colisão de code (PK): tenta outro
    }
  }
  return null;
}

export async function pgFindShortLinkTarget(code) {
  await ensureOnce();
  const { rows } = await getPostgresPool().query(
    'SELECT target FROM short_links WHERE code = $1 LIMIT 1',
    [code],
  );
  return rows[0]?.target || null;
}
