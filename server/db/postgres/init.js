import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const { Pool, types: pgTypes } = pg;

// PostgreSQL DATE (OID 1082): mantém como string 'YYYY-MM-DD'.
// Default do node-postgres converte para Date em meia-noite no TZ local do processo
// (UTC no Railway), o que muda o dia ao formatar em America/Sao_Paulo.
pgTypes.setTypeParser(1082, (val) => (val == null ? val : String(val)));

let pool = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS igrejas (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  nome TEXT NOT NULL,
  senha TEXT,
  role TEXT NOT NULL DEFAULT 'voluntario',
  igreja_id TEXT REFERENCES igrejas(id) ON DELETE SET NULL,
  ministerio_ids JSONB NOT NULL DEFAULT '[]',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  foto_url TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp TEXT,
  reset_token TEXT,
  reset_token_expires TIMESTAMPTZ,
  ultimo_acesso TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_igreja_unique ON users (LOWER(email), COALESCE(igreja_id, ''));
CREATE INDEX IF NOT EXISTS users_email_idx ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS users_igreja_idx ON users (igreja_id);

CREATE TABLE IF NOT EXISTS ministerios (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ministerios_igreja_slug ON ministerios (igreja_id, slug);

CREATE TABLE IF NOT EXISTS voluntarios (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nome TEXT,
  dados JSONB NOT NULL DEFAULT '{}',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  fonte TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS voluntarios_igreja_email ON voluntarios (igreja_id, LOWER(email));

CREATE TABLE IF NOT EXISTS eventos_checkin (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  label TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  inicio_checkin TIMESTAMPTZ,
  fim_checkin TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  evento_id TEXT REFERENCES eventos_checkin(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  nome TEXT,
  ministerio TEXT,
  batizado TEXT,
  data_checkin TIMESTAMPTZ,
  timestamp_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eventos_formulario (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  data DATE NOT NULL,
  label TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS formulario_membro (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  dados JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS formulario_consolidacao (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  dados JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS formulario_batismo (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  evento_id TEXT NOT NULL REFERENCES eventos_formulario(id) ON DELETE CASCADE,
  dados JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS formulario_apresentacao (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  evento_id TEXT NOT NULL REFERENCES eventos_formulario(id) ON DELETE CASCADE,
  dados JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS formulario_novo_membro (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  evento_id TEXT NOT NULL REFERENCES eventos_formulario(id) ON DELETE CASCADE,
  dados JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS escalas (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  dados JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidaturas (
  id TEXT PRIMARY KEY,
  igreja_id TEXT NOT NULL REFERENCES igrejas(id) ON DELETE CASCADE,
  escala_id TEXT NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
  dados JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_history (
  id TEXT PRIMARY KEY,
  igreja_id TEXT REFERENCES igrejas(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  dados JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS escala_inscricoes_por_ministerio (
  escala_id TEXT NOT NULL REFERENCES escalas(id) ON DELETE CASCADE,
  ministerio TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (escala_id, ministerio)
);
`;

const MINISTERIOS_PADRAO = [
  'Suporte Geral',
  'Welcome / Recepção',
  'Experience / Auditório',
  'Streaming / Ao Vivo',
  'Produção Ao Vivo',
  'Lab / Mídia',
  'Produção',
  'Intercessão Presencial',
  'Sala de Voluntários',
  'Kids / Min. Infantil',
  'Consolidação',
  'Care / Saúde',
  'Parking / Estacionamento',
  'Segurança',
  'Intercessão Online',
];

function slugifyNome(nome) {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '') || 'ministerio';
}

export function isPostgresReady() {
  return pool != null;
}

export function getPostgresPool() {
  return pool;
}

export async function initPostgres(connectionString) {
  if (pool) return pool;
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') || process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : undefined,
    max: Number(process.env.PG_POOL_MAX || 10),
  });
  await pool.query('SELECT 1');
  await pool.query(SCHEMA_SQL);
  await pool.query(`
    ALTER TABLE checkins ADD COLUMN IF NOT EXISTS candidatura_id TEXT REFERENCES candidaturas(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS checkins_candidatura_idx ON checkins (candidatura_id) WHERE candidatura_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS checkins_igreja_evento_idx ON checkins (igreja_id, evento_id);
    CREATE INDEX IF NOT EXISTS checkins_igreja_email_idx ON checkins (igreja_id, LOWER(email));
    CREATE INDEX IF NOT EXISTS checkins_timestamp_idx ON checkins (igreja_id, timestamp_ms DESC);
    CREATE INDEX IF NOT EXISTS candidaturas_igreja_escala_idx ON candidaturas (igreja_id, escala_id);
    CREATE INDEX IF NOT EXISTS escalas_igreja_created_idx ON escalas (igreja_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS eventos_checkin_igreja_data_idx ON eventos_checkin (igreja_id, data DESC);
    CREATE INDEX IF NOT EXISTS voluntarios_igreja_ativo_idx ON voluntarios (igreja_id, ativo);
    CREATE INDEX IF NOT EXISTS users_reset_token_idx ON users (reset_token) WHERE reset_token IS NOT NULL;
    CREATE INDEX IF NOT EXISTS eventos_formulario_igreja_data_idx ON eventos_formulario (igreja_id, tipo, data DESC);
    CREATE INDEX IF NOT EXISTS formulario_membro_igreja_idx ON formulario_membro (igreja_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS formulario_consolidacao_igreja_idx ON formulario_consolidacao (igreja_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS formulario_batismo_evento_idx ON formulario_batismo (igreja_id, evento_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS formulario_apresentacao_evento_idx ON formulario_apresentacao (igreja_id, evento_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS formulario_novo_membro_evento_idx ON formulario_novo_membro (igreja_id, evento_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS role_history_user_idx ON role_history (user_id, created_at DESC);
  `);
  const { migrateCultosRecorrentesSchema } = await import('./cultos-recorrentes.js');
  await migrateCultosRecorrentesSchema();
  const { migrateEventosCheckinSchema } = await import('./escalas-checkin.js');
  await migrateEventosCheckinSchema();
  const { migrateConvitesLiderSchema } = await import('./convites-lider.js');
  await migrateConvitesLiderSchema();
  const { migrateAuthSessionsSchema, pgPurgeExpiredAuthSessions } = await import('./auth-sessions.js');
  await migrateAuthSessionsSchema();
  await pgPurgeExpiredAuthSessions().catch(() => {});
  await seedIfEmpty();
  const { migratePlatformSettingsSchema } = await import('./platform-settings.js');
  await migratePlatformSettingsSchema();
  return pool;
}

async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM igrejas');
  if (rows[0].c > 0) return;

  console.log('📦 PostgreSQL: seed inicial (igrejas, ministérios, admin)...');

  const igrejas = [
    { nome: 'Celeiro São Paulo', slug: 'celeiro-sp' },
    { nome: 'Inc São Paulo', slug: 'inc-sp' },
    { nome: 'INC Adolescentes', slug: 'inc-adolescentes' },
  ];

  const igrejaIds = {};
  for (const g of igrejas) {
    const id = randomUUID();
    igrejaIds[g.slug] = id;
    await pool.query(
      'INSERT INTO igrejas (id, nome, slug, ativo) VALUES ($1, $2, $3, TRUE)',
      [id, g.nome, g.slug],
    );
  }

  for (const slug of Object.keys(igrejaIds)) {
    const igrejaId = igrejaIds[slug];
    const used = new Set();
    for (const nome of MINISTERIOS_PADRAO) {
      let s = slugifyNome(nome);
      const base = s;
      let n = 2;
      while (used.has(s)) {
        s = `${base}-${n}`;
        n += 1;
      }
      used.add(s);
      await pool.query(
        'INSERT INTO ministerios (id, igreja_id, nome, slug, ativo) VALUES ($1, $2, $3, $4, TRUE)',
        [randomUUID(), igrejaId, nome, s],
      );
    }
  }

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || process.env.ADMIN_USER || '').trim().toLowerCase();
  const adminPass = (process.env.SEED_ADMIN_PASSWORD || process.env.ADMIN_PASS || '').trim();
  const adminNome = (process.env.SEED_ADMIN_NAME || 'Administrador').trim();

  if (adminEmail && adminEmail.includes('@') && adminPass.length >= 6) {
    const hash = await bcrypt.hash(adminPass, 10);
    await pool.query(
      `INSERT INTO users (id, email, nome, senha, role, igreja_id, ministerio_ids, ativo, must_change_password)
       VALUES ($1, $2, $3, $4, 'admin', NULL, '[]', TRUE, FALSE)`,
      [randomUUID(), adminEmail, adminNome, hash],
    );
    console.log(`   Admin global criado: ${adminEmail}`);
  } else {
    console.warn('   Defina ADMIN_USER + ADMIN_PASS (ou SEED_ADMIN_*) no Railway para criar admin no primeiro boot.');
  }
}
