/**
 * Verificação e desativação permanente do MongoDB na plataforma (PostgreSQL only).
 */
import { isPostgres, isMongoDecommissioned, setMongoDecommissionedFlag } from '../db/connection.js';
import { pgGetMongoDecommissionInfo, pgIsMongoDecommissioned, pgSetPlatformSetting } from '../db/postgres/platform-settings.js';
import { runPostgresValidationAudit, isMigrationRunning } from './mongo-to-pg-migrate.js';

const MONGO_ONLY_BLOCK_THRESHOLD = 50;

export async function getMongoDecommissionStatus() {
  const info = await pgGetMongoDecommissionInfo().catch(() => null);
  const decommissioned = !!(info?.active) || isMongoDecommissioned();
  return {
    decommissioned,
    info: info || null,
    postgresReady: isPostgres(),
    dbProvider: (process.env.DB_PROVIDER || 'auto').trim().toLowerCase(),
    mongodbUriConfigured: !!(process.env.MONGODB_URI || '').trim(),
    migrationRunning: isMigrationRunning(),
  };
}

/**
 * Verifica se a plataforma pode operar só com PostgreSQL.
 * @returns {Promise<{ ready: boolean, errors: string[], warnings: string[], audit: object, message: string }>}
 */
export async function verifyMongoDecommissionReady() {
  if (!isPostgres()) {
    return {
      ready: false,
      errors: ['PostgreSQL não está disponível.'],
      warnings: [],
      audit: null,
      message: 'PostgreSQL indisponível.',
    };
  }

  if (await pgIsMongoDecommissioned()) {
    return {
      ready: false,
      errors: ['MongoDB já está desativado nesta plataforma.'],
      warnings: [],
      audit: null,
      message: 'MongoDB já desativado.',
    };
  }

  if (isMigrationRunning()) {
    return {
      ready: false,
      errors: ['Aguarde a migração em andamento terminar.'],
      warnings: [],
      audit: null,
      message: 'Migração em andamento.',
    };
  }

  const errors = [];
  const warnings = [];
  const audit = await runPostgresValidationAudit({ allIgrejas: true });

  if (!audit.summary?.pgHasOperationalData) {
    errors.push('PostgreSQL não contém dados operacionais (voluntários, check-ins, etc.).');
  }

  const grandTotal = audit.global?.totals?.grandTotal ?? 0;
  if (grandTotal < 1) {
    errors.push('Nenhum registro operacional no PostgreSQL.');
  }

  if ((audit.global?.orphans?.total ?? 0) > 0) {
    warnings.push(
      `${audit.global.orphans.total} registro(s) órfão(s) (igreja_id inválido) — podem não aparecer na UI.`,
    );
  }

  for (const ig of audit.igrejas || []) {
    const pc = ig.pgCounts || {};
    const hasData = (pc.voluntarios || 0) > 0 || (pc.checkins || 0) > 0 || (pc.users || 0) > 0;
    if (!hasData) {
      warnings.push(`${ig.nome || ig.slug}: sem dados operacionais no PostgreSQL.`);
    }
  }

  if (audit.mongoConnected) {
    let stillInMongoOnly = 0;
    for (const ig of audit.igrejas || []) {
      const imp = ig.impact;
      if (!imp) continue;
      stillInMongoOnly += (imp.mongoOnlyVoluntarios || 0) + (imp.mongoOnlyCheckins || 0);
    }
    if (stillInMongoOnly > MONGO_ONLY_BLOCK_THRESHOLD) {
      errors.push(
        `Ainda há ${stillInMongoOnly} voluntário(s)/check-in(s) somente no MongoDB. Conclua a migração antes de desativar.`,
      );
    } else if (stillInMongoOnly > 0) {
      warnings.push(
        `${stillInMongoOnly} registro(s) ainda só no Mongo — considere reexecutar a migração.`,
      );
    }
  } else if (audit.mongodbUriConfigured && audit.mongoError) {
    warnings.push(`MongoDB inacessível (${audit.mongoError}) — verificação de paridade não realizada.`);
  }

  const dbProvider = (process.env.DB_PROVIDER || 'auto').trim().toLowerCase();
  if (dbProvider !== 'postgres') {
    warnings.push(
      `DB_PROVIDER="${dbProvider}" — recomendado definir DB_PROVIDER=postgres no Railway após desativar.`,
    );
  }

  if (audit.mongodbUriConfigured) {
    warnings.push(
      'Após desativar, remova MONGODB_URI das variáveis do Railway (a plataforma passará a ignorá-la).',
    );
  }

  const ready = errors.length === 0;

  return {
    ready,
    errors,
    warnings,
    audit,
    pgGrandTotal: grandTotal,
    message: ready
      ? 'Plataforma pronta para operar somente com PostgreSQL.'
      : 'Corrija os problemas antes de desativar o MongoDB.',
  };
}

/**
 * Desativa MongoDB na plataforma (persiste flag no PostgreSQL).
 * @param {{ email?: string, confirm?: boolean }} opts
 */
export async function executeMongoDecommission(opts = {}) {
  if (opts.confirm !== true) {
    throw new Error('Confirmação obrigatória (confirm: true).');
  }

  const verification = await verifyMongoDecommissionReady();
  if (!verification.ready) {
    const msg = verification.errors.join(' ') || verification.message;
    throw new Error(msg);
  }

  const payload = {
    active: true,
    at: new Date().toISOString(),
    by: (opts.email || '').trim().toLowerCase() || null,
    pgGrandTotal: verification.pgGrandTotal,
    notes: [
      'MongoDB desativado via painel admin.',
      'A aplicação passa a usar exclusivamente PostgreSQL.',
      'Remova MONGODB_URI do Railway quando conveniente.',
    ],
  };

  await pgSetPlatformSetting('mongo_decommissioned', payload);
  setMongoDecommissionedFlag(true);

  return {
    ok: true,
    decommissioned: true,
    info: payload,
    verification,
    message: 'MongoDB desativado. A plataforma usa apenas PostgreSQL.',
    railwaySteps: [
      'Variables → remova MONGODB_URI (opcional, mas recomendado)',
      'Confirme DB_PROVIDER=postgres',
      'Redeploy se necessário',
    ],
  };
}
