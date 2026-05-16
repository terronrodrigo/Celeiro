/**
 * Inicialização do banco: PostgreSQL (Railway DATABASE_URL) e/ou MongoDB (MONGODB_URI).
 * Prioridade para voltar ao ar: Postgres sobe mesmo se Mongo estiver suspenso.
 */
import mongoose from 'mongoose';
import { initPostgres, isPostgresReady, getPostgresPool } from './postgres/init.js';

let mongoConnected = false;

export function isMongo() {
  return mongoConnected && mongoose.connection.readyState === 1;
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
    } catch (err) {
      console.error('❌ PostgreSQL erro:', err.message || err);
      if ((process.env.DB_PROVIDER || '').toLowerCase() === 'postgres') throw err;
    }
  }

  if (shouldUseMongo() && mongoUri) {
    try {
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
