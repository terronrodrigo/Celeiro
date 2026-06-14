import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMinisterioCatalogIndex,
  resolveRawMinisterioToCatalog,
  resolveVoluntarioMinisteriosFromCatalog,
} from '../lib/ministerio-resolver.js';

const catalog = [
  { _id: '1', nome: 'Kids / Min. Infantil' },
  { _id: '2', nome: 'Alicerce / Suporte Geral' },
  { _id: '3', nome: 'Welcome / Recepção' },
  { _id: '4', nome: 'Lab / Mídia ( Fotos )' },
];
const index = buildMinisterioCatalogIndex(catalog);

test('resolveRawMinisterioToCatalog — alias legado Suporte Geral', () => {
  const hit = resolveRawMinisterioToCatalog('Suporte Geral', index);
  assert.equal(hit?.nome, 'Alicerce / Suporte Geral');
});

test('resolveRawMinisterioToCatalog — kids parcial', () => {
  const hit = resolveRawMinisterioToCatalog('Kids', index);
  assert.equal(hit?.nome, 'Kids / Min. Infantil');
});

test('resolveVoluntarioMinisteriosFromCatalog — ministério + habilidade extra', () => {
  const r = resolveVoluntarioMinisteriosFromCatalog({
    dados: {
      ministerio: 'Suporte Geral, Instrumentista',
      areas: ['Recepção'],
    },
  }, index);
  assert.ok(r.ministerioIds.includes('2'));
  assert.ok(r.ministerioIds.includes('3'));
  assert.ok(r.habilidades.includes('Instrumentista'));
});
