/**
 * Smoke tests de rotas HTTP (sem auth).
 * Rode com o servidor local: npm run dev & npm test
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
let serverUp = false;

before(async () => {
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    serverUp = r.ok;
  } catch {
    serverUp = false;
  }
});

describe('smoke HTTP (opcional — requer servidor)', () => {
  it('GET /api/health', async (t) => {
    if (!serverUp) {
      t.skip('Servidor não está em ' + BASE + ' — inicie com npm run dev');
      return;
    }
    const r = await fetch(`${BASE}/api/health`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok('ok' in j || j.status === 'ok' || typeof j === 'object');
  });

  it('GET /api/cultos-recorrentes/meta exige auth', async (t) => {
    if (!serverUp) {
      t.skip('Servidor offline');
      return;
    }
    const r = await fetch(`${BASE}/api/cultos-recorrentes/meta`);
    assert.equal(r.status, 401);
  });

  it('POST /api/candidaturas sem body retorna 4xx', async (t) => {
    if (!serverUp) {
      t.skip('Servidor offline');
      return;
    }
    const r = await fetch(`${BASE}/api/candidaturas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.ok(r.status >= 400 && r.status < 500);
  });
});
