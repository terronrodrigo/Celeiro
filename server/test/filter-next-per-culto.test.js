import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterNextPerCulto } from '../db/postgres/escalas-checkin.js';

describe('filterNextPerCulto', () => {
  it('mantém apenas a próxima futura por cultoRecorrenteId (lista já ordenada asc)', () => {
    const items = [
      { _id: 'a', data: '2026-05-24', cultoRecorrenteId: 'culto-dom' },
      { _id: 'b', data: '2026-05-31', cultoRecorrenteId: 'culto-dom' },
      { _id: 'c', data: '2026-06-07', cultoRecorrenteId: 'culto-dom' },
      { _id: 'd', data: '2026-05-27', cultoRecorrenteId: 'culto-qua' },
      { _id: 'e', data: '2026-06-03', cultoRecorrenteId: 'culto-qua' },
    ];
    const out = filterNextPerCulto(items, '2026-05-18');
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((x) => x._id).sort(), ['a', 'd']);
  });

  it('itens avulsos sem cultoRecorrenteId aparecem se forem futuros', () => {
    const items = [
      { _id: 'a', data: '2026-05-24', cultoRecorrenteId: 'c1' },
      { _id: 'b', data: '2026-05-30', cultoRecorrenteId: null },
      { _id: 'c', data: '2026-04-01', cultoRecorrenteId: null },
    ];
    const out = filterNextPerCulto(items, '2026-05-18');
    assert.deepEqual(out.map((x) => x._id), ['a', 'b']);
  });

  it('passada do mesmo culto não impede a próxima futura', () => {
    const items = [
      { _id: 'a', data: '2026-05-24', cultoRecorrenteId: 'c1' },
      { _id: 'b', data: '2026-05-10', cultoRecorrenteId: 'c1' },
    ];
    const out = filterNextPerCulto(items, '2026-05-18');
    assert.deepEqual(out.map((x) => x._id), ['a']);
  });

  it('quando data já passou (todayYmd igual à data), considera futura (inclusivo)', () => {
    const items = [
      { _id: 'a', data: '2026-05-18', cultoRecorrenteId: 'c1' },
      { _id: 'b', data: '2026-05-25', cultoRecorrenteId: 'c1' },
    ];
    const out = filterNextPerCulto(items, '2026-05-18');
    assert.deepEqual(out.map((x) => x._id), ['a']);
  });
});
