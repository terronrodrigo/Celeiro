import { randomUUID } from 'crypto';
import { getPostgresPool } from './init.js';
import {
  listOcorrenciaDates,
  formatDataPtBr,
  parseHHMM,
} from '../../lib/brasilia.js';
import {
  pgCreateEscala,
  pgCreateEventoCheckin,
} from './escalas-checkin.js';

const EXTENSION_SQL = `
ALTER TABLE eventos_checkin ADD COLUMN IF NOT EXISTS horario_inicio TEXT DEFAULT '';
ALTER TABLE eventos_checkin ADD COLUMN IF NOT EXISTS horario_fim TEXT DEFAULT '';
ALTER TABLE eventos_checkin ADD COLUMN IF NOT EXISTS culto_recorrente_id TEXT;
ALTER TABLE eventos_checkin ADD COLUMN IF NOT EXISTS auto_gerado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE eventos_checkin ADD COLUMN IF NOT EXISTS criado_por TEXT;

CREATE TABLE IF NOT EXISTS cultos_recorrentes (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  dia_semana SMALLINT NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
  horario TEXT NOT NULL DEFAULT '10:00',
  horario_checkin_inicio TEXT DEFAULT '',
  horario_checkin_fim TEXT DEFAULT '',
  gerar_escala BOOLEAN NOT NULL DEFAULT TRUE,
  gerar_checkin BOOLEAN NOT NULL DEFAULT TRUE,
  semanas_a_frente SMALLINT NOT NULL DEFAULT 8 CHECK (semanas_a_frente >= 1 AND semanas_a_frente <= 52),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cultos_recorrentes_igreja_idx ON cultos_recorrentes (igreja_id, ativo);

CREATE TABLE IF NOT EXISTS culto_ocorrencias (
  id TEXT PRIMARY KEY,
  culto_recorrente_id TEXT NOT NULL REFERENCES cultos_recorrentes(id) ON DELETE CASCADE,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  escala_id TEXT REFERENCES escalas(id) ON DELETE SET NULL,
  evento_checkin_id TEXT REFERENCES eventos_checkin(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (culto_recorrente_id, data)
);

CREATE INDEX IF NOT EXISTS culto_ocorrencias_data_idx ON culto_ocorrencias (igreja_id, data);
`;

export async function migrateCultosRecorrentesSchema() {
  await getPostgresPool().query(EXTENSION_SQL);
}

function mapCultoRow(row) {
  if (!row) return null;
  return {
    _id: row.id,
    igrejaId: row.igreja_id,
    nome: row.nome,
    diaSemana: row.dia_semana,
    horario: row.horario,
    horarioCheckinInicio: row.horario_checkin_inicio || '',
    horarioCheckinFim: row.horario_checkin_fim || '',
    gerarEscala: row.gerar_escala,
    gerarCheckin: row.gerar_checkin,
    semanasAFrente: row.semanas_a_frente,
    ativo: row.ativo,
    criadoPor: row.criado_por,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function pgListCultosRecorrentes(igrejaId) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM cultos_recorrentes WHERE igreja_id = $1 ORDER BY dia_semana, horario, nome',
    [igrejaId],
  );
  const cultos = rows.map(mapCultoRow);
  const { rows: counts } = await getPostgresPool().query(
    `SELECT culto_recorrente_id, COUNT(*)::int AS c
     FROM culto_ocorrencias WHERE igreja_id = $1 GROUP BY culto_recorrente_id`,
    [igrejaId],
  );
  const countMap = new Map(counts.map((r) => [r.culto_recorrente_id, r.c]));
  return cultos.map((c) => ({ ...c, totalOcorrencias: countMap.get(c._id) || 0 }));
}

export async function pgFindCultoRecorrente(id, igrejaId) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM cultos_recorrentes WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  return mapCultoRow(rows[0]);
}

export async function pgCreateCultoRecorrente(payload) {
  const id = randomUUID();
  const horario = parseHHMM(payload.horario) || '10:00';
  await getPostgresPool().query(
    `INSERT INTO cultos_recorrentes (
      id, igreja_id, nome, dia_semana, horario,
      horario_checkin_inicio, horario_checkin_fim,
      gerar_escala, gerar_checkin, semanas_a_frente, ativo, criado_por
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      payload.igrejaId,
      String(payload.nome).trim(),
      Number(payload.diaSemana),
      horario,
      parseHHMM(payload.horarioCheckinInicio) || '',
      parseHHMM(payload.horarioCheckinFim) || '',
      payload.gerarEscala !== false,
      payload.gerarCheckin !== false,
      Math.min(52, Math.max(1, Number(payload.semanasAFrente) || 8)),
      payload.ativo !== false,
      payload.criadoPor || null,
    ],
  );
  return pgFindCultoRecorrente(id, payload.igrejaId);
}

export async function pgUpdateCultoRecorrente(id, igrejaId, patch) {
  const cur = await pgFindCultoRecorrente(id, igrejaId);
  if (!cur) return null;
  await getPostgresPool().query(
    `UPDATE cultos_recorrentes SET
      nome = $3,
      dia_semana = $4,
      horario = $5,
      horario_checkin_inicio = $6,
      horario_checkin_fim = $7,
      gerar_escala = $8,
      gerar_checkin = $9,
      semanas_a_frente = $10,
      ativo = $11,
      updated_at = NOW()
     WHERE id = $1 AND igreja_id = $2`,
    [
      id,
      igrejaId,
      patch.nome !== undefined ? String(patch.nome).trim() : cur.nome,
      patch.diaSemana !== undefined ? Number(patch.diaSemana) : cur.diaSemana,
      patch.horario !== undefined ? (parseHHMM(patch.horario) || cur.horario) : cur.horario,
      patch.horarioCheckinInicio !== undefined
        ? (parseHHMM(patch.horarioCheckinInicio) || '')
        : cur.horarioCheckinInicio,
      patch.horarioCheckinFim !== undefined
        ? (parseHHMM(patch.horarioCheckinFim) || '')
        : cur.horarioCheckinFim,
      patch.gerarEscala !== undefined ? !!patch.gerarEscala : cur.gerarEscala,
      patch.gerarCheckin !== undefined ? !!patch.gerarCheckin : cur.gerarCheckin,
      patch.semanasAFrente !== undefined
        ? Math.min(52, Math.max(1, Number(patch.semanasAFrente) || 8))
        : cur.semanasAFrente,
      patch.ativo !== undefined ? !!patch.ativo : cur.ativo,
    ],
  );
  return pgFindCultoRecorrente(id, igrejaId);
}

export async function pgDeleteCultoRecorrente(id, igrejaId) {
  const { rowCount } = await getPostgresPool().query(
    'DELETE FROM cultos_recorrentes WHERE id = $1 AND igreja_id = $2',
    [id, igrejaId],
  );
  return rowCount > 0;
}

async function findOcorrencia(cultoId, dataYmd) {
  const { rows } = await getPostgresPool().query(
    'SELECT * FROM culto_ocorrencias WHERE culto_recorrente_id = $1 AND data = $2::date LIMIT 1',
    [cultoId, dataYmd],
  );
  return rows[0] || null;
}

async function ensureOcorrenciaForDate(culto, dataYmd) {
  const existing = await findOcorrencia(culto._id, dataYmd);
  if (existing) return { skipped: true };

  let escalaId = null;
  let eventoId = null;
  const tituloData = formatDataPtBr(dataYmd);
  const nomeOcorrencia = `${culto.nome} — ${tituloData}`;

  if (culto.gerarEscala) {
    const escala = await pgCreateEscala({
      igrejaId: culto.igrejaId,
      nome: nomeOcorrencia,
      data: dataYmd,
      descricao: `Culto recorrente (${culto.horario} · horário de Brasília). Gerado automaticamente.`,
      ativo: true,
      criadoPor: culto.criadoPor,
      cultoRecorrenteId: culto._id,
      autoGerada: true,
    });
    escalaId = escala._id;
  }

  if (culto.gerarCheckin) {
    const evento = await pgCreateEventoCheckin({
      igrejaId: culto.igrejaId,
      dataYmd,
      label: nomeOcorrencia,
      ativo: true,
      horarioInicio: culto.horarioCheckinInicio || '',
      horarioFim: culto.horarioCheckinFim || '',
      criadoPor: culto.criadoPor,
      cultoRecorrenteId: culto._id,
      autoGerado: true,
    });
    eventoId = evento._id;
  }

  const occId = randomUUID();
  await getPostgresPool().query(
    `INSERT INTO culto_ocorrencias (id, culto_recorrente_id, igreja_id, data, escala_id, evento_checkin_id)
     VALUES ($1, $2, $3, $4::date, $5, $6)`,
    [occId, culto._id, culto.igrejaId, dataYmd, escalaId, eventoId],
  );
  return { created: true, escalaId, eventoId, dataYmd };
}

export async function syncCultosRecorrentes({ igrejaId = null, cultoId = null } = {}) {
  let sql = 'SELECT * FROM cultos_recorrentes WHERE ativo = TRUE';
  const params = [];
  if (igrejaId) {
    params.push(igrejaId);
    sql += ` AND igreja_id = $${params.length}`;
  }
  if (cultoId) {
    params.push(cultoId);
    sql += ` AND id = $${params.length}`;
  }
  const { rows } = await getPostgresPool().query(sql, params);
  const summary = { cultos: rows.length, criadas: 0, ignoradas: 0 };

  for (const row of rows) {
    const culto = mapCultoRow(row);
    const dates = listOcorrenciaDates(culto.diaSemana, culto.semanasAFrente);
    for (const dataYmd of dates) {
      const r = await ensureOcorrenciaForDate(culto, dataYmd);
      if (r.skipped) summary.ignoradas += 1;
      else if (r.created) summary.criadas += 1;
    }
  }
  return summary;
}

let schedulerStarted = false;

export function startRecurringCultosScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const run = () => {
    syncCultosRecorrentes().then((s) => {
      if (s.criadas > 0) {
        console.log(`📅 Cultos recorrentes: ${s.criadas} ocorrência(s) nova(s) (${s.cultos} culto(s) ativos).`);
      }
    }).catch((e) => console.error('Erro sync cultos recorrentes:', e.message || e));
  };
  setTimeout(run, 8000);
  setInterval(run, 60 * 60 * 1000);
}
