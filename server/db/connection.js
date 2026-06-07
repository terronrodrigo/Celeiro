/**
 * Inicialização do banco: PostgreSQL (Railway DATABASE_URL) e/ou MongoDB (MONGODB_URI).
 * Prioridade para voltar ao ar: Postgres sobe mesmo se Mongo estiver suspenso.
 * Mongoose é carregado sob demanda (lazy) quando Postgres-only — startup mais rápido.
 */
import { initPostgres, isPostgresReady, getPostgresPool } from './postgres/init.js';

let mongooseModule = null;
let mongooseLoadPromise = null;
let mongoConnected = false;
let mongoDecommissioned = false;

async function loadMongoose() {
  if (mongooseModule) return mongooseModule;
  if (!mongooseLoadPromise) {
    mongooseLoadPromise = import('mongoose').then((mod) => {
      mongooseModule = mod.default;
      return mongooseModule;
    });
  }
  return mongooseLoadPromise;
}

export function isMongoDecommissioned() {
  if (mongoDecommissioned) return true;
  if ((process.env.MONGO_DECOMMISSIONED || '').trim().toLowerCase() === 'true') return true;
  return false;
}

export function setMongoDecommissionedFlag(value) {
  mongoDecommissioned = !!value;
}

export async function loadMongoDecommissionFlag() {
  if (!isPostgresReady()) return;
  try {
    const { pgIsMongoDecommissioned } = await import('./postgres/platform-settings.js');
    mongoDecommissioned = await pgIsMongoDecommissioned();
    if (mongoDecommissioned) {
      console.log('ℹ️ MongoDB desativado nesta plataforma — modo PostgreSQL exclusivo.');
    }
  } catch (_) { /* schema ainda não criado */ }
}

export function isMongo() {
  if (isMongoDecommissioned()) return false;
  if (!mongoConnected || !mongooseModule) return false;
  return mongooseModule.connection.readyState === 1;
}

export function isPostgres() {
  return isPostgresReady();
}

export function isDbReady() {
  return isMongo() || isPostgres();
}

export function getDbMode() {
  if (isMongo() && isPostgres()) return 'dual';
  if (isPostgres()) return 'postgres';
  if (isMongo()) return 'mongo';
  return 'none';
}

export function getPostgres() {
  return getPostgresPool();
}

function resolvePostgresUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_PRIVATE_URL ||
    ''
  ).trim();
}

function shouldUsePostgres() {
  const mode = (process.env.DB_PROVIDER || 'auto').trim().toLowerCase();
  if (mode === 'mongo') return false;
  if (mode === 'postgres') return !!resolvePostgresUrl();
  return !!resolvePostgresUrl();
}

function shouldUseMongo() {
  if (isMongoDecommissioned()) return false;
  const mode = (process.env.DB_PROVIDER || 'auto').trim().toLowerCase();
  if (mode === 'postgres') return false;
  return !!(process.env.MONGODB_URI || '').trim();
}

export async function initDatabase() {
  const pgUrl = resolvePostgresUrl();
  const mongoUri = (process.env.MONGODB_URI || '').trim();

  if (shouldUsePostgres() && pgUrl) {
    try {
      await initPostgres(pgUrl);
      console.log('✅ PostgreSQL conectado (Railway)');
      await loadMongoDecommissionFlag();
    } catch (err) {
      console.error('❌ PostgreSQL erro:', err.message || err);
      if ((process.env.DB_PROVIDER || '').toLowerCase() === 'postgres') throw err;
    }
  }

  const mongoUriConfigured = !!mongoUri;
  if (mongoUriConfigured && isMongoDecommissioned()) {
    console.log('ℹ️ MONGODB_URI ignorado — MongoDB desativado nesta plataforma.');
  } else if (mongoUriConfigured && (process.env.DB_PROVIDER || '').trim().toLowerCase() === 'postgres') {
    console.log('ℹ️ MONGODB_URI definido — MongoDB conecta sob demanda (migração).');
  }

  if (shouldUseMongo() && mongoUri) {
    try {
      const mongoose = await loadMongoose();
      await mongoose.connect(mongoUri);
      mongoConnected = true;
      console.log('✅ MongoDB conectado');
    } catch (err) {
      mongoConnected = false;
      console.warn('⚠️ MongoDB indisponível:', err.message || err);
      if (isPostgres()) {
        console.warn('   Aplicação segue em modo PostgreSQL (dados operacionais vazios até migração).');
      } else if ((process.env.DB_PROVIDER || '').toLowerCase() !== 'postgres') {
        throw err;
      }
    }
  }

  if (!isDbReady()) {
    throw new Error(
      'Nenhum banco disponível. Configure DATABASE_URL (Postgres) e/ou MONGODB_URI no Railway.',
    );
  }
}

/** Conecta ao Mongo sob demanda (ex.: migração quando o boot falhou por IP whitelist). */
export async function ensureMongoConnection() {
  if (isMongoDecommissioned()) {
    throw new Error('MongoDB desativado nesta plataforma. Todos os dados usam PostgreSQL.');
  }
  const mongoUri = (process.env.MONGODB_URI || '').trim();
  if (!mongoUri) {
    throw new Error('MONGODB_URI não configurado no Railway.');
  }
  const mongoose = await loadMongoose();
  const state = mongoose.connection.readyState;
  if (state === 1 && mongoose.connection.db) {
    mongoConnected = true;
    return;
  }
  if (state === 1 || state === 2) {
    await mongoose.connection.asPromise();
    if (mongoose.connection.db) {
      mongoConnected = true;
      return;
    }
  }
  await mongoose.connect(mongoUri);
  await mongoose.connection.asPromise();
  if (!mongoose.connection.db) {
    throw new Error('MongoDB: falha ao obter database após connect. Verifique MONGODB_URI.');
  }
  mongoConnected = true;
}

function resolveMongoDb(mongoose) {
  if (mongoose.connection.db) return mongoose.connection.db;
  try {
    const client = mongoose.connection.getClient?.();
    if (client) {
      const dbName = mongoose.connection.name || undefined;
      return client.db(dbName);
    }
  } catch (_) { /* ignore */ }
  return null;
}

/** Ping no Mongo após conexão garantida. */
export async function pingMongo() {
  await ensureMongoConnection();
  const mongoose = await loadMongoose();
  const db = resolveMongoDb(mongoose);
  if (!db) {
    throw new Error('MongoDB: database indisponível após conexão. Verifique MONGODB_URI e Network Access no Atlas.');
  }
  await db.command({ ping: 1 });
}
