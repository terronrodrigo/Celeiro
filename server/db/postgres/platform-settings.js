import { getPostgresPool } from './init.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function migratePlatformSettingsSchema() {
  await getPostgresPool().query(SCHEMA_SQL);
}

export async function pgGetPlatformSetting(key) {
  await migratePlatformSettingsSchema();
  const { rows } = await getPostgresPool().query(
    'SELECT value, updated_at FROM platform_settings WHERE key = $1 LIMIT 1',
    [key],
  );
  return rows[0] || null;
}

export async function pgSetPlatformSetting(key, value) {
  await migratePlatformSettingsSchema();
  const payload = value == null ? {} : value;
  await getPostgresPool().query(
    `INSERT INTO platform_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(payload)],
  );
}

export async function pgIsMongoDecommissioned() {
  const row = await pgGetPlatformSetting('mongo_decommissioned');
  return row?.value?.active === true;
}

export async function pgGetMongoDecommissionInfo() {
  const row = await pgGetPlatformSetting('mongo_decommissioned');
  if (!row?.value?.active) return null;
  return {
    active: true,
    at: row.value.at || row.updated_at,
    by: row.value.by || null,
    pgGrandTotal: row.value.pgGrandTotal ?? null,
    notes: row.value.notes || [],
  };
}
