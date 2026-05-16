import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { getPostgresPool } from './init.js';

function mapUserRow(row) {
  if (!row) return null;
  const ministerioIds = Array.isArray(row.ministerio_ids)
    ? row.ministerio_ids
    : (typeof row.ministerio_ids === 'string' ? JSON.parse(row.ministerio_ids || '[]') : []);
  return {
    _id: row.id,
    id: row.id,
    email: row.email,
    nome: row.nome,
    senha: row.senha,
    role: row.role,
    igrejaId: row.igreja_id || null,
    ministerioIds,
    ministerioId: ministerioIds[0] || null,
    ativo: row.ativo,
    fotoUrl: row.foto_url,
    mustChangePassword: row.must_change_password,
    whatsapp: row.whatsapp,
    async compararSenha(senhaFornecida) {
      if (!row.senha) return false;
      try {
        return await bcrypt.compare(senhaFornecida, row.senha);
      } catch (_) {
        return false;
      }
    },
    async save() {
      await getPostgresPool().query(
        `UPDATE users SET ultimo_acesso = NOW(), ministerio_ids = $2::jsonb WHERE id = $1`,
        [row.id, JSON.stringify(ministerioIds)],
      );
    },
  };
}

function mapIgrejaRow(row) {
  if (!row) return null;
  return { _id: row.id, nome: row.nome, slug: row.slug, ativo: row.ativo };
}

export async function pgFindIgrejaBySlug(slug) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM igrejas WHERE LOWER(slug) = LOWER($1) AND ativo = TRUE LIMIT 1',
    [slug],
  );
  return mapIgrejaRow(rows[0]);
}

export async function pgFindIgrejaById(id) {
  const { rows } = await getPostgresPool().query('SELECT * FROM igrejas WHERE id = $1 LIMIT 1', [id]);
  return mapIgrejaRow(rows[0]);
}

export async function pgListIgrejas() {
  const { rows } = await getPostgresPool().query(
    'SELECT id, nome, slug, ativo FROM igrejas WHERE ativo = TRUE ORDER BY nome',
  );
  return rows.map(mapIgrejaRow);
}

export async function pgFindUsersByEmail(emailLower) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM users WHERE LOWER(email) = $1',
    [emailLower],
  );
  return rows.map(mapUserRow);
}

export async function pgFindUserById(id) {
  const { rows } = await getPostgresPool().query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return mapUserRow(rows[0]);
}

export async function pgHasAdmin() {
  const { rows } = await getPostgresPool().query(
    "SELECT 1 FROM users WHERE role = 'admin' LIMIT 1",
  );
  return rows.length > 0;
}

export async function pgCreateAdmin({ email, nome, senha }) {
  const hash = await bcrypt.hash(senha, 10);
  const id = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO users (id, email, nome, senha, role, igreja_id, ministerio_ids, ativo, must_change_password)
     VALUES ($1, $2, $3, $4, 'admin', NULL, '[]', TRUE, FALSE)`,
    [id, email.toLowerCase(), nome, hash],
  );
  return pgFindUserById(id);
}

export async function pgFindMinisteriosByIds(ids, igrejaId) {
  if (!ids?.length) return [];
  const { rows } = await getPostgresPool().query(
    'SELECT id, nome FROM ministerios WHERE id = ANY($1::text[]) AND igreja_id = $2',
    [ids, igrejaId],
  );
  return rows.map((r) => ({ _id: r.id, nome: r.nome }));
}

export async function pgUpdateUserUltimoAcesso(userId, ministerioIds) {
  await getPostgresPool().query(
    'UPDATE users SET ultimo_acesso = NOW(), ministerio_ids = $2::jsonb WHERE id = $1',
    [userId, JSON.stringify(ministerioIds || [])],
  );
}
