import test from 'node:test';
import assert from 'node:assert/strict';
import { conviteLiderValido } from '../db/postgres/convites-lider.js';

test('conviteLiderValido rejects inactive or missing', () => {
  assert.equal(conviteLiderValido(null), false);
  assert.equal(conviteLiderValido({ ativo: false }), false);
});

test('conviteLiderValido accepts active without expiry', () => {
  assert.equal(conviteLiderValido({ ativo: true }), true);
});

test('conviteLiderValido rejects past expiry', () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.equal(conviteLiderValido({ ativo: true, expiresAt: past }), false);
});

test('conviteLiderValido accepts future expiry', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal(conviteLiderValido({ ativo: true, expiresAt: future }), true);
});
