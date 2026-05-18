import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { getPostgresPool } from './init.js';
import { splitVoluntarioMinisterios } from '../../lib/ministerio-match.js';

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

/** Normaliza batismo salvo no perfil (boolean ou legado sim/nao). */
export function normBatizadoPerfil(raw) {
  if (raw === true || raw === false) return raw;
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'sim' || s === 's') return true;
  if (s === 'nao' || s === 'não' || s === 'n') return false;
  return null;
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
  const ministerios = splitVoluntarioMinisterios({ ministerios: d.ministerios, ministerio: d.ministerio });
  const ministerio = ministerios.length ? ministerios.join(', ') : (d.ministerio || '');
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
    ministerio,
    ministerios,
    disponibilidade: d.disponibilidade,
    horasSemana: d.horasSemana,
    areas,
    testemunho: d.testemunho,
    batizado: normBatizadoPerfil(d.batizado),
    ativo: r.ativo !== false,
    fonte: r.fonte,
  };
}

function resolveMinisteriosForDados(baseDados, patch) {
  if (Object.prototype.hasOwnProperty.call(patch, 'ministerios') && Array.isArray(patch.ministerios)) {
    const arr = [...new Set(patch.ministerios.map((x) => String(x ?? '').trim()).filter(Boolean))];
    return { ministerios: arr, ministerio: arr.join(', ') };
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'ministerio')) {
    const arr = [...new Set(String(patch.ministerio || '').split(',').map((s) => s.trim()).filter(Boolean))];
    return { ministerios: arr, ministerio: arr.join(', ') };
  }
  const keep = splitVoluntarioMinisterios({ ministerios: baseDados.ministerios, ministerio: baseDados.ministerio });
  return { ministerios: keep, ministerio: keep.join(', ') };
}

export async function pgUpsertVoluntarioPerfil(igrejaId, emailLower, patch) {
  const current = await pgFindVoluntarioByEmail(igrejaId, emailLower);
  const merged = { ...(current || {}), ...patch, email: emailLower };
  if (Array.isArray(merged.areas)) {
    merged.areas = merged.areas;
  } else if (typeof merged.areas === 'string') {
    merged.areas = merged.areas.split(',').map((a) => a.trim()).filter(Boolean);
  }
  const buildCore = (base) => {
    const { ministerios, ministerio } = resolveMinisteriosForDados(base, patch);
    return {
      ...base,
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
      ministerios,
      ministerio,
      disponibilidade: merged.disponibilidade,
      horasSemana: merged.horasSemana,
      areas: merged.areas || [],
      testemunho: merged.testemunho,
    };
  };
  if (current?._id) {
    const { rows: dr } = await getPostgresPool().query(
      'SELECT dados FROM voluntarios WHERE id = $1 AND igreja_id = $2',
      [current._id, igrejaId],
    );
    const dados = buildCore({ ...(dr[0]?.dados || {}) });
    const batNorm = normBatizadoPerfil(merged.batizado);
    if (batNorm === true || batNorm === false) {
      dados.batizado = batNorm;
    }
    await getPostgresPool().query(
      `UPDATE voluntarios SET nome = $3, dados = $4::jsonb, updated_at = NOW()
       WHERE id = $1 AND igreja_id = $2`,
      [current._id, igrejaId, dados.nome || emailLower, JSON.stringify(dados)],
    );
    return pgFindVoluntarioByEmail(igrejaId, emailLower);
  }
  const dados = buildCore({});
  const batNorm = normBatizadoPerfil(merged.batizado);
  if (batNorm === true || batNorm === false) {
    dados.batizado = batNorm;
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

/** Versão batch: 1 única query para resolver nomes de todos os ministérios usados em uma lista de users. */
async function buildMinisteriosLookupForUsers(users, igrejaId) {
  const allIds = new Set();
  for (const u of users) {
    for (const mid of (u.ministerioIds || [])) allIds.add(String(mid));
  }
  if (allIds.size === 0) return new Map();
  const idsArr = [...allIds];
  const mins = await pgFindMinisteriosByIds(idsArr, igrejaId);
  return new Map(mins.map((m) => [String(m._id), { _id: m._id, nome: m.nome }]));
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
  sql += ' ORDER BY nome LIMIT 1000';
  const { rows } = await getPostgresPool().query(sql, params);
  const users = rows.map(mapUserRow);
  const lookup = await buildMinisteriosLookupForUsers(users, igrejaId);
  return users.map((u) => {
    const mins = (u.ministerioIds || [])
      .map((id) => lookup.get(String(id)))
      .filter(Boolean);
    return mapUserForApi(u, mins);
  });
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

export async function pgSetUserFotoUrl(userId, fotoUrl) {
  await getPostgresPool().query(
    'UPDATE users SET foto_url = $2 WHERE id = $1',
    [userId, fotoUrl == null ? null : String(fotoUrl)],
  );
}

export async function pgFindUserFotoUrl(igrejaId, emailLower) {
  const { rows } = await getPostgresPool().query(
    'SELECT foto_url FROM users WHERE igreja_id = $1 AND LOWER(email) = $2 LIMIT 1',
    [igrejaId, emailLower],
  );
  return rows[0]?.foto_url || null;
}

export async function pgFindMinisterioById(id, igrejaId) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM ministerios WHERE id = $1 AND igreja_id = $2 LIMIT 1',
    [id, igrejaId],
  );
  return mapMinisterioRow(rows[0]);
}

export async function pgUpdateMinisterio(id, igrejaId, { nome, ativo }) {
  const sets = [];
  const params = [id, igrejaId];
  if (nome !== undefined) {
    params.push(String(nome).trim());
    sets.push(`nome = $${params.length}`);
  }
  if (ativo !== undefined) {
    params.push(!!ativo);
    sets.push(`ativo = $${params.length}`);
  }
  if (!sets.length) return pgFindMinisterioById(id, igrejaId);
  await getPostgresPool().query(
    `UPDATE ministerios SET ${sets.join(', ')} WHERE id = $1 AND igreja_id = $2`,
    params,
  );
  return pgFindMinisterioById(id, igrejaId);
}

export async function pgDeleteMinisterio(id, igrejaId) {
  const { rowCount } = await getPostgresPool().query(
    'DELETE FROM ministerios WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  return rowCount > 0;
}

/**
 * Atualiza líderes de um ministério em transação:
 * - tira ex-líderes (que não estão em newLiderIds) e os volta a voluntário se não tiverem outros ministérios.
 * - adiciona novos líderes (promove a 'lider' se for 'voluntario').
 * - grava role_history para cada mudança.
 * Retorna { addedUserIds, removedUserIds } para uso por logs/notificações.
 */
export async function pgSetMinisterioLideres(ministerioId, igrejaId, newLiderIds, changedBy) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  const added = [];
  const removed = [];
  try {
    await client.query('BEGIN');
    const { rows: currentRows } = await client.query(
      `SELECT id, role, ministerio_ids FROM users
       WHERE igreja_id = $1 AND ministerio_ids @> $2::jsonb`,
      [igrejaId, JSON.stringify([ministerioId])],
    );
    const wantSet = new Set((newLiderIds || []).map(String).filter(Boolean));
    const haveSet = new Set(currentRows.map((r) => String(r.id)));

    for (const row of currentRows) {
      if (wantSet.has(String(row.id))) continue;
      const ids = Array.isArray(row.ministerio_ids)
        ? row.ministerio_ids
        : JSON.parse(row.ministerio_ids || '[]');
      const newIds = ids.filter((id) => String(id) !== String(ministerioId));
      const newRole = (newIds.length === 0 && row.role !== 'admin') ? 'voluntario' : (row.role || 'lider');
      await client.query(
        `UPDATE users SET ministerio_ids = $2::jsonb, role = $3 WHERE id = $1`,
        [row.id, JSON.stringify(newIds), newRole],
      );
      await client.query(
        `INSERT INTO role_history (id, igreja_id, user_id, dados)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [randomUUID(), igrejaId, row.id, JSON.stringify({
          fromRole: row.role || 'lider',
          toRole: newRole,
          ministerioId,
          changedBy: changedBy || null,
          createdAt: new Date().toISOString(),
        })],
      );
      removed.push(String(row.id));
    }

    for (const uid of wantSet) {
      if (haveSet.has(uid)) continue;
      const { rows: ur } = await client.query(
        'SELECT id, role, ministerio_ids FROM users WHERE id = $1 AND igreja_id = $2 LIMIT 1',
        [uid, igrejaId],
      );
      if (!ur[0]) continue;
      const u = ur[0];
      const ids = Array.isArray(u.ministerio_ids)
        ? u.ministerio_ids
        : JSON.parse(u.ministerio_ids || '[]');
      if (ids.some((id) => String(id) === String(ministerioId))) continue;
      const newIds = [...ids, ministerioId];
      const newRole = u.role === 'admin' ? 'admin' : 'lider';
      await client.query(
        `UPDATE users SET ministerio_ids = $2::jsonb, role = $3 WHERE id = $1`,
        [u.id, JSON.stringify(newIds), newRole],
      );
      await client.query(
        `INSERT INTO role_history (id, igreja_id, user_id, dados)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [randomUUID(), igrejaId, u.id, JSON.stringify({
          fromRole: u.role || 'voluntario',
          toRole: newRole,
          ministerioId,
          changedBy: changedBy || null,
          createdAt: new Date().toISOString(),
        })],
      );
      added.push(String(u.id));
    }

    await client.query('COMMIT');
    return { added, removed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function pgListRoleHistoryByUser(userId, igrejaId) {
  const { rows } = await getPostgresPool().query(
    `SELECT rh.id, rh.dados, rh.created_at
     FROM role_history rh
     WHERE rh.user_id = $1 AND (rh.igreja_id IS NULL OR rh.igreja_id = $2)
     ORDER BY rh.created_at DESC LIMIT 200`,
    [userId, igrejaId],
  );
  if (!rows.length) return [];
  const userIds = new Set();
  const minIds = new Set();
  for (const r of rows) {
    const d = r.dados || {};
    if (d.changedBy) userIds.add(String(d.changedBy));
    if (d.ministerioId) minIds.add(String(d.ministerioId));
  }
  const usersMap = new Map();
  if (userIds.size > 0) {
    const { rows: ur } = await getPostgresPool().query(
      'SELECT id, nome FROM users WHERE id = ANY($1::text[])',
      [[...userIds]],
    );
    for (const u of ur) usersMap.set(String(u.id), { _id: u.id, nome: u.nome });
  }
  const minsMap = new Map();
  if (minIds.size > 0) {
    const mins = await pgFindMinisteriosByIds([...minIds], igrejaId);
    for (const m of mins) minsMap.set(String(m._id), { _id: m._id, nome: m.nome });
  }
  return rows.map((r) => {
    const d = r.dados || {};
    return {
      _id: r.id,
      createdAt: r.created_at,
      fromRole: d.fromRole || null,
      toRole: d.toRole || null,
      changedBy: d.changedBy ? (usersMap.get(String(d.changedBy)) || { _id: d.changedBy, nome: null }) : null,
      ministerioId: d.ministerioId ? (minsMap.get(String(d.ministerioId)) || { _id: d.ministerioId, nome: null }) : null,
    };
  });
}

export async function pgCreateRoleHistory({ igrejaId, userId, fromRole, toRole, ministerioId, changedBy }) {
  await getPostgresPool().query(
    `INSERT INTO role_history (id, igreja_id, user_id, dados) VALUES ($1, $2, $3, $4::jsonb)`,
    [randomUUID(), igrejaId, userId, JSON.stringify({
      fromRole, toRole, ministerioId: ministerioId || null, changedBy: changedBy || null,
      createdAt: new Date().toISOString(),
    })],
  );
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
