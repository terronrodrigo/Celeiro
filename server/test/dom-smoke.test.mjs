/**
 * Verifica que o HTML principal expõe IDs críticos dos fluxos recentes.
 * Não substitui teste E2E no browser, mas evita regressão de markup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const REQUIRED_IDS = [
  'btnNovoCultoRecorrente',
  'modalCultoRecorrente',
  'formCultoRecorrente',
  'cultoRecorrenteNome',
  'cultoRecorrenteDia',
  'btnSyncCultosRecorrentes',
  'cultosRecorrentesBody',
  'kpiGridResumoGlobal',
  'kpiGridResumoVolEngajamento',
  'resumoVolEngMinisterio',
  'btnEmailReengajamento',
  'modalVolReengajamentoEmail',
];

describe('index.html — elementos críticos', () => {
  for (const id of REQUIRED_IDS) {
    it(`contém #${id}`, () => {
      assert.match(html, new RegExp(`id="${id}"`));
    });
  }

  it('app.js referenciado com versão de cache', () => {
    assert.match(html, /app\.js\?v=/);
  });

  it('não carrega Chart.js no HTML (lazy load)', () => {
    assert.doesNotMatch(html, /chart\.js@/i);
  });
});
