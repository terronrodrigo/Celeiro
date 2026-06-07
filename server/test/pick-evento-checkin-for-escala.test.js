import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickEventoCheckinForEscala } from '../db/postgres/escalas-checkin.js';

describe('pickEventoCheckinForEscala', () => {
  const domManha = { _id: 'evt-dom-manha', cultoRecorrenteId: 'culto-dom-manha' };
  const domNoite = { _id: 'evt-dom-noite', cultoRecorrenteId: 'culto-dom-noite' };
  const avulso = { _id: 'evt-avulso', cultoRecorrenteId: null };

  it('vincula por culto_recorrente_id quando há vários eventos no mesmo dia', () => {
    const escala = { cultoRecorrenteId: 'culto-dom-noite', data: '2026-06-07' };
    const out = pickEventoCheckinForEscala(escala, [domManha, domNoite]);
    assert.equal(out?._id, 'evt-dom-noite');
  });

  it('usa único evento na data quando escala não tem culto_recorrente_id', () => {
    const escala = { cultoRecorrenteId: null, data: '2026-06-07' };
    const out = pickEventoCheckinForEscala(escala, [avulso]);
    assert.equal(out?._id, 'evt-avulso');
  });

  it('retorna null quando há vários eventos e nenhum match de culto', () => {
    const escala = { cultoRecorrenteId: null, data: '2026-06-07' };
    const out = pickEventoCheckinForEscala(escala, [domManha, domNoite]);
    assert.equal(out, null);
  });

  it('retorna null quando culto não encontra evento correspondente no dia', () => {
    const escala = { cultoRecorrenteId: 'culto-quarta', data: '2026-06-07' };
    const out = pickEventoCheckinForEscala(escala, [domManha, domNoite]);
    assert.equal(out, null);
  });
});
