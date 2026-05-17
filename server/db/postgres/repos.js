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

function mapMinisterioRow(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    nome: row.nome,
    slug: row.slug,
    ativo: row.ativo,
    igrejaId: row.igreja_id,
    criadoEm: row.criado_em,
  };
}

export async function pgListMinisterios(igrejaId) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM ministerios WHERE igreja_id = $1 ORDER BY nome',
    [igrejaId],
  );
  return rows.map(mapMinisterioRow);
}

export async function pgFindMinisterioByNome(igrejaId, nome) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM ministerios WHERE igreja_id = $1 AND LOWER(TRIM(nome)) = LOWER(TRIM($2)) LIMIT 1',
    [igrejaId, nome],
  );
  return mapMinisterioRow(rows[0]);
}

export async function pgCreateMinisterio({ igrejaId, nome, slug }) {
  const id = randomUUID();
  await getPostgresPool().query(
    'INSERT INTO ministerios (id, igreja_id, nome, slug, ativo) VALUES ($1, $2, $3, $4, TRUE)',
    [id, igrejaId, nome, slug],
  );
  const { rows } = await getPostgresPool().query('SELECT * FROM ministerios WHERE id = $1', [id]);
  return mapMinisterioRow(rows[0]);
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

export async function pgSetUserResetToken(userId, token, expiresAt) {
  await getPostgresPool().query(
    'UPDATE users SET reset_token = $2, reset_token_expires = $3 WHERE id = $1',
    [userId, token, expiresAt instanceof Date ? expiresAt : new Date(expiresAt)],
  );
}

export async function pgFindUserByResetToken(token) {
  const { rows } = await getPostgresPool().query(
    `SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW() LIMIT 1`,
    [token],
  );
  return mapUserRow(rows[0]);
}

export async function pgUpdateUserPassword(userId, senhaPlain) {
  const hash = await bcrypt.hash(senhaPlain, 10);
  await getPostgresPool().query(
    `UPDATE users SET senha = $2, reset_token = NULL, reset_token_expires = NULL,
      must_change_password = FALSE WHERE id = $1`,
    [userId, hash],
  );
  return pgFindUserById(userId);
}

export async function pgFindVoluntarioByEmail(igrejaId, emailLower) {
  const { rows } = await getPostgresPool().query(
    'SELECT id, email, nome, dados, ativo, fonte FROM voluntarios WHERE igreja_id = $1 AND LOWER(email) = $2 LIMIT 1',
    [igrejaId, emailLower],
  );
  const r = rows[0];
  if (!r) return null;
  const d = r.dados || {};
  const areas = Array.isArray(d.areas) ? d.areas : (d.areas ? String(d.areas).split(',').map((x) => x.trim()).filter(Boolean) : []);
  return {
    _id: r.id,
    email: r.email,
    nome: d.nome || r.nome || '',
    nascimento: d.nascimento,
    whatsapp: d.whatsapp || d.telefone,
    pais: d.pais,
    estado: d.estado,
    cidade: d.cidade,
    evangelico: d.evangelico,
    igreja: d.igreja,
    tempoIgreja: d.tempoIgreja,
    voluntarioIgreja: d.voluntarioIgreja,
    ministerio: d.ministerio,
    disponibilidade: d.disponibilidade,
    horasSemana: d.horasSemana,
    areas,
    testemunho: d.testemunho,
    ativo: r.ativo !== false,
    fonte: r.fonte,
  };
}

export async function pgUpsertVoluntarioPerfil(igrejaId, emailLower, patch) {
  const current = await pgFindVoluntarioByEmail(igrejaId, emailLower);
  const merged = { ...(current || {}), ...patch, email: emailLower };
  if (Array.isArray(merged.areas)) {
    merged.areas = merged.areas;
  } else if (typeof merged.areas === 'string') {
    merged.areas = merged.areas.split(',').map((a) => a.trim()).filter(Boolean);
  }
  const dados = {
    nome: merged.nome || '',
    nascimento: merged.nascimento,
    whatsapp: merged.whatsapp,
    pais: merged.pais,
    estado: merged.estado,
    cidade: merged.cidade,
    evangelico: merged.evangelico,
    igreja: merged.igreja,
    tempoIgreja: merged.tempoIgreja,
    voluntarioIgreja: merged.voluntarioIgreja,
    ministerio: merged.ministerio,
    disponibilidade: merged.disponibilidade,
    horasSemana: merged.horasSemana,
    areas: merged.areas || [],
    testemunho: merged.testemunho,
  };
  if (current?._id) {
    await getPostgresPool().query(
      `UPDATE voluntarios SET nome = $3, dados = $4::jsonb, updated_at = NOW()
       WHERE id = $1 AND igreja_id = $2`,
      [current._id, igrejaId, dados.nome || emailLower, JSON.stringify(dados)],
    );
    return pgFindVoluntarioByEmail(igrejaId, emailLower);
  }
  const id = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO voluntarios (id, igreja_id, email, nome, dados, ativo, fonte)
     VALUES ($1, $2, $3, $4, $5::jsonb, TRUE, 'manual')`,
    [id, igrejaId, emailLower, dados.nome || emailLower, JSON.stringify(dados)],
  );
  return pgFindVoluntarioByEmail(igrejaId, emailLower);
}

function mapUserForApi(user, ministeriosPopulated = []) {
  if (!user) return null;
  const { senha, compararSenha, save, ...rest } = user;
  return {
    ...rest,
    ministerioIds: ministeriosPopulated.length
      ? ministeriosPopulated
      : (rest.ministerioIds || []),
  };
}

export async function pgPopulateMinisterioIds(ids, igrejaId) {
  const mins = await pgFindMinisteriosByIds(ids, igrejaId);
  return mins.map((m) => ({ _id: m._id, nome: m.nome }));
}

export async function pgListUsers(igrejaId, { search, ativo } = {}) {
  const params = [igrejaId];
  let sql = 'SELECT * FROM users WHERE igreja_id = $1';
  if (ativo === true || ativo === 'true') sql += ' AND ativo = TRUE';
  if (ativo === false || ativo === 'false') sql += ' AND ativo = FALSE';
  if (search && String(search).trim()) {
    params.push(`%${String(search).trim()}%`);
    sql += ` AND (nome ILIKE $${params.length} OR email ILIKE $${params.length})`;
  }
  sql += ' ORDER BY nome';
  const { rows } = await getPostgresPool().query(sql, params);
  const users = rows.map(mapUserRow);
  const out = [];
  for (const u of users) {
    const ids = u.ministerioIds || [];
    const mins = ids.length ? await pgPopulateMinisterioIds(ids, igrejaId) : [];
    out.push(mapUserForApi(u, mins));
  }
  return out;
}

export async function pgFindUserByEmailInIgreja(igrejaId, emailLower) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM users WHERE igreja_id = $1 AND LOWER(email) = $2 LIMIT 1',
    [igrejaId, emailLower],
  );
  const u = mapUserRow(rows[0]);
  if (!u) return null;
  const mins = u.ministerioIds?.length
    ? await pgPopulateMinisterioIds(u.ministerioIds, igrejaId)
    : [];
  return mapUserForApi(u, mins);
}

export async function pgUpsertUserWithPasswordHash({
  email, nome, senhaHash, role, igrejaId, ministerioIds = [], mustChangePassword = true, ativo = true,
}) {
  const existing = await pgFindUserByEmailInIgreja(igrejaId, email.toLowerCase());
  const ids = (role === 'lider' || role === 'admin') ? ministerioIds : [];
  if (existing) {
    await getPostgresPool().query(
      `UPDATE users SET nome = $3, role = $4, senha = $5, ministerio_ids = $6::jsonb,
        ativo = $7, must_change_password = $8 WHERE id = $1 AND igreja_id = $2`,
      [existing._id, igrejaId, nome, role, senhaHash, JSON.stringify(ids), ativo, !!mustChangePassword],
    );
    const u = await pgFindUserById(existing._id);
    const mins = ids.length ? await pgPopulateMinisterioIds(ids, igrejaId) : [];
    return { user: mapUserForApi(u, mins), created: false };
  }
  const id = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO users (id, email, nome, senha, role, igreja_id, ministerio_ids, ativo, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [id, email.toLowerCase(), nome, senhaHash, role, igrejaId, JSON.stringify(ids), ativo, !!mustChangePassword],
  );
  const u = await pgFindUserById(id);
  const mins = ids.length ? await pgPopulateMinisterioIds(ids, igrejaId) : [];
  return { user: mapUserForApi(u, mins), created: true };
}

export async function pgCreateUser({
  email, nome, senha, role, igrejaId, ministerioIds = [], mustChangePassword = true,
}) {
  const hash = await bcrypt.hash(senha, 10);
  const id = randomUUID();
  const ids = (role === 'lider' || role === 'admin') ? ministerioIds : [];
  await getPostgresPool().query(
    `INSERT INTO users (id, email, nome, senha, role, igreja_id, ministerio_ids, ativo, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, TRUE, $8)`,
    [id, email.toLowerCase(), nome, hash, role, igrejaId, JSON.stringify(ids), !!mustChangePassword],
  );
  const u = await pgFindUserById(id);
  const mins = ids.length ? await pgPopulateMinisterioIds(ids, igrejaId) : [];
  return mapUserForApi(u, mins);
}

export async function pgUpdateUser(id, igrejaId, { nome, role, ativo, ministerioIds }) {
  const current = await pgFindUserById(id);
  if (!current || String(current.igrejaId) !== String(igrejaId)) return null;

  const newRole = role !== undefined ? role : current.role;
  let newIds = current.ministerioIds || [];
  if (newRole === 'voluntario') {
    newIds = [];
  } else if (ministerioIds !== undefined && (newRole === 'lider' || newRole === 'admin')) {
    newIds = ministerioIds.filter(Boolean);
  }

  const sets = ['ministerio_ids = $3::jsonb'];
  const params = [id, igrejaId, JSON.stringify(newIds)];
  if (nome !== undefined) {
    params.push(nome);
    sets.push(`nome = $${params.length}`);
  }
  if (role !== undefined) {
    params.push(role);
    sets.push(`role = $${params.length}`);
  }
  if (ativo !== undefined) {
    params.push(!!ativo);
    sets.push(`ativo = $${params.length}`);
  }
  await getPostgresPool().query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $1 AND igreja_id = $2`,
    params,
  );
  const u = await pgFindUserById(id);
  const mins = newIds.length ? await pgPopulateMinisterioIds(newIds, igrejaId) : [];
  return mapUserForApi(u, mins);
}

/** Líderes ativos da igreja, agrupados por ministério (para GET /api/ministros). */
export async function pgLeadersByMinisterioId(igrejaId) {
  const { rows } = await getPostgresPool().query(
    `SELECT id, nome, email, ministerio_ids FROM users
     WHERE igreja_id = $1 AND ativo = TRUE AND role IN ('lider', 'admin')`,
    [igrejaId],
  );
  const map = {};
  for (const row of rows) {
    const ids = Array.isArray(row.ministerio_ids)
      ? row.ministerio_ids
      : JSON.parse(row.ministerio_ids || '[]');
    for (const mid of ids) {
      const k = String(mid);
      if (!map[k]) map[k] = [];
      map[k].push({ _id: row.id, nome: row.nome, email: row.email, role: 'lider' });
    }
  }
  return map;
}
