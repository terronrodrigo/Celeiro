import { randomUUID } from 'node:crypto';
import { getPostgresPool } from './init.js';

// ─── Eventos de formulário (batismo / apresentação) ──────────────────────────
function mapEventoFormRow(row) {
  if (!row) return null;
  let dataIso;
  if (row.data instanceof Date) dataIso = row.data.toISOString();
  else if (typeof row.data === 'string') dataIso = new Date(`${row.data.slice(0, 10)}T03:00:00.000Z`).toISOString();
  else dataIso = null;
  return {
    _id: row.id,
    id: row.id,
    igrejaId: row.igreja_id,
    tipo: row.tipo,
    data: dataIso,
    label: row.label || '',
    ativo: row.ativo !== false,
    horarioInicio: row.horario_inicio || '',
    horarioFim: row.horario_fim || '',
    shortCode: row.short_code || '',
    createdAt: row.created_at,
  };
}

// Alfabeto sem caracteres ambíguos (0/O, 1/l/I) para links curtos legíveis.
const SHORT_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
export function generateEventoShortCode(len = 7) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
  }
  return out;
}

async function ensureEventoFormColumns() {
  // Migração leve para colunas opcionais (horarioInicio/Fim, criadoPor e shortCode) se ainda não existirem.
  await getPostgresPool().query(`
    ALTER TABLE eventos_formulario ADD COLUMN IF NOT EXISTS horario_inicio TEXT;
    ALTER TABLE eventos_formulario ADD COLUMN IF NOT EXISTS horario_fim TEXT;
    ALTER TABLE eventos_formulario ADD COLUMN IF NOT EXISTS criado_por TEXT;
    ALTER TABLE eventos_formulario ADD COLUMN IF NOT EXISTS short_code TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS eventos_formulario_short_code_idx
      ON eventos_formulario (short_code) WHERE short_code IS NOT NULL;
  `).catch(() => {});
}

/** Gera short_code para eventos antigos que ainda não têm (uma vez por boot). */
async function backfillEventoShortCodes() {
  try {
    const pool = getPostgresPool();
    const { rows } = await pool.query('SELECT id FROM eventos_formulario WHERE short_code IS NULL OR short_code = \'\' LIMIT 1000');
    for (const row of rows) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await pool.query('UPDATE eventos_formulario SET short_code = $2 WHERE id = $1', [row.id, generateEventoShortCode()]);
          break;
        } catch (e) {
          if (attempt === 4) throw e; // colisão de código único: tenta outro
        }
      }
    }
  } catch (e) {
    console.error('backfill short_code eventos_formulario:', e?.message || e);
  }
}

let columnsEnsured = false;
async function ensureOnce() {
  if (columnsEnsured) return;
  columnsEnsured = true;
  await ensureEventoFormColumns();
  await backfillEventoShortCodes();
}

export async function pgListEventosFormulario(igrejaId, { tipo, ativo, data } = {}) {
  await ensureOnce();
  const params = [igrejaId];
  let sql = 'SELECT * FROM eventos_formulario WHERE igreja_id = $1';
  if (tipo === 'batismo' || tipo === 'apresentacao' || tipo === 'novo_membro') {
    params.push(tipo);
    sql += ` AND tipo = $${params.length}`;
  }
  if (ativo === true) sql += ` AND ativo = TRUE`;
  if (data) {
    const ymd = String(data).slice(0, 10);
    params.push(ymd);
    sql += ` AND data = $${params.length}::date`;
  }
  sql += ' ORDER BY data DESC, created_at DESC LIMIT 500';
  const { rows } = await getPostgresPool().query(sql, params);
  return rows.map(mapEventoFormRow);
}

export async function pgFindEventoFormularioById(id, igrejaId) {
  await ensureOnce();
  const params = [id];
  let sql = 'SELECT * FROM eventos_formulario WHERE id = $1';
  if (igrejaId) {
    params.push(igrejaId);
    sql += ` AND igreja_id = $${params.length}`;
  }
  sql += ' LIMIT 1';
  const { rows } = await getPostgresPool().query(sql, params);
  return mapEventoFormRow(rows[0]);
}

export async function pgCreateEventoFormulario({
  igrejaId, tipo, dataYmd, label, ativo = true, horarioInicio = '', horarioFim = '', criadoPor = null,
}) {
  await ensureOnce();
  const id = randomUUID();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await getPostgresPool().query(
        `INSERT INTO eventos_formulario (id, igreja_id, tipo, data, label, ativo, horario_inicio, horario_fim, criado_por, short_code)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10)`,
        [id, igrejaId, tipo, dataYmd, label || '', !!ativo, horarioInicio || '', horarioFim || '', criadoPor, generateEventoShortCode()],
      );
      break;
    } catch (e) {
      if (attempt === 4) throw e; // colisão de short_code: tenta outro código
    }
  }
  return pgFindEventoFormularioById(id, igrejaId);
}

export async function pgFindEventoFormularioByShortCode(code) {
  await ensureOnce();
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM eventos_formulario WHERE short_code = $1 LIMIT 1',
    [code],
  );
  return mapEventoFormRow(rows[0]);
}

export async function pgUpdateEventoFormulario(id, igrejaId, { label, ativo, horarioInicio, horarioFim }) {
  await ensureOnce();
  const sets = [];
  const params = [id, igrejaId];
  if (label !== undefined) { params.push(label); sets.push(`label = $${params.length}`); }
  if (ativo !== undefined) { params.push(!!ativo); sets.push(`ativo = $${params.length}`); }
  if (horarioInicio !== undefined) { params.push(horarioInicio || ''); sets.push(`horario_inicio = $${params.length}`); }
  if (horarioFim !== undefined) { params.push(horarioFim || ''); sets.push(`horario_fim = $${params.length}`); }
  if (!sets.length) return pgFindEventoFormularioById(id, igrejaId);
  await getPostgresPool().query(
    `UPDATE eventos_formulario SET ${sets.join(', ')} WHERE id = $1 AND igreja_id = $2`,
    params,
  );
  return pgFindEventoFormularioById(id, igrejaId);
}

export async function pgDeleteEventoFormulario(id, igrejaId) {
  await ensureOnce();
  const { rowCount } = await getPostgresPool().query(
    'DELETE FROM eventos_formulario WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  return rowCount > 0;
}

// ─── Formulários públicos (membro, consolidação, batismo, apresentação) ──────
function mapFormularioRow(row) {
  if (!row) return null;
  const dados = row.dados || {};
  return {
    _id: row.id,
    id: row.id,
    igrejaId: row.igreja_id,
    eventoId: row.evento_id || dados.eventoId || null,
    createdAt: row.created_at,
    ...dados,
  };
}

export async function pgCreateFormularioMembro(igrejaId, dados) {
  const id = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO formulario_membro (id, igreja_id, dados) VALUES ($1, $2, $3::jsonb)`,
    [id, igrejaId, JSON.stringify(dados || {})],
  );
  return id;
}

export async function pgListFormulariosMembro(igrejaId) {
  const { rows } = await getPostgresPool().query(
    `SELECT * FROM formulario_membro WHERE igreja_id = $1 ORDER BY created_at DESC LIMIT 2000`,
    [igrejaId],
  );
  return rows.map(mapFormularioRow);
}

export async function pgCreateFormularioConsolidacao(igrejaId, dados) {
  const id = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO formulario_consolidacao (id, igreja_id, dados) VALUES ($1, $2, $3::jsonb)`,
    [id, igrejaId, JSON.stringify(dados || {})],
  );
  return id;
}

export async function pgListFormulariosConsolidacao(igrejaId) {
  const { rows } = await getPostgresPool().query(
    `SELECT * FROM formulario_consolidacao WHERE igreja_id = $1 ORDER BY created_at DESC LIMIT 2000`,
    [igrejaId],
  );
  return rows.map(mapFormularioRow);
}

export async function pgCreateFormularioBatismo(igrejaId, eventoId, dados) {
  const id = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO formulario_batismo (id, igreja_id, evento_id, dados) VALUES ($1, $2, $3, $4::jsonb)`,
    [id, igrejaId, eventoId, JSON.stringify(dados || {})],
  );
  return id;
}

export async function pgListFormulariosBatismoByEvento(igrejaId, eventoId) {
  const { rows } = await getPostgresPool().query(
    `SELECT * FROM formulario_batismo WHERE igreja_id = $1 AND evento_id = $2 ORDER BY created_at DESC LIMIT 2000`,
    [igrejaId, eventoId],
  );
  return rows.map(mapFormularioRow);
}

export async function pgCreateFormularioApresentacao(igrejaId, eventoId, dados) {
  const id = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO formulario_apresentacao (id, igreja_id, evento_id, dados) VALUES ($1, $2, $3, $4::jsonb)`,
    [id, igrejaId, eventoId, JSON.stringify(dados || {})],
  );
  return id;
}

export async function pgListFormulariosApresentacaoByEvento(igrejaId, eventoId) {
  const { rows } = await getPostgresPool().query(
    `SELECT * FROM formulario_apresentacao WHERE igreja_id = $1 AND evento_id = $2 ORDER BY created_at DESC LIMIT 2000`,
    [igrejaId, eventoId],
  );
  return rows.map(mapFormularioRow);
}

export async function pgCreateFormularioNovoMembro(igrejaId, eventoId, dados) {
  const id = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO formulario_novo_membro (id, igreja_id, evento_id, dados) VALUES ($1, $2, $3, $4::jsonb)`,
    [id, igrejaId, eventoId, JSON.stringify(dados || {})],
  );
  return id;
}

export async function pgListFormulariosNovoMembroByEvento(igrejaId, eventoId) {
  const { rows } = await getPostgresPool().query(
    `SELECT * FROM formulario_novo_membro WHERE igreja_id = $1 AND evento_id = $2 ORDER BY created_at DESC LIMIT 2000`,
    [igrejaId, eventoId],
  );
  return rows.map(mapFormularioRow);
}
