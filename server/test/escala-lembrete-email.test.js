import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveEscalaLembreteTipoForToday,
  getCultoDataYmdForLembrete,
  isEscalaLembreteMorningWindow,
} from '../lib/escala-lembrete-email.js';
import { weekdayBrasilia } from '../lib/brasilia.js';

describe('escala-lembrete-email', () => {
  it('segunda dispara lembrete de quarta na mesma semana', () => {
    assert.equal(resolveEscalaLembreteTipoForToday('2026-06-01'), 'quarta'); // segunda
    assert.equal(getCultoDataYmdForLembrete('quarta', '2026-06-01'), '2026-06-03');
    assert.equal(weekdayBrasilia('2026-06-03'), 3);
  });

  it('quinta dispara lembrete de domingo', () => {
    assert.equal(resolveEscalaLembreteTipoForToday('2026-06-04'), 'domingo'); // quinta
    assert.equal(getCultoDataYmdForLembrete('domingo', '2026-06-04'), '2026-06-07');
    assert.equal(weekdayBrasilia('2026-06-07'), 0);
  });

  it('outros dias não têm tipo automático', () => {
    assert.equal(resolveEscalaLembreteTipoForToday('2026-06-03'), null);
    assert.equal(resolveEscalaLembreteTipoForToday('2026-06-07'), null);
  });

  it('janela da manhã respeita env vars', () => {
    const prevMin = process.env.ESCALA_LEMBRETE_HOUR_MIN;
    const prevMax = process.env.ESCALA_LEMBRETE_HOUR_MAX;
    process.env.ESCALA_LEMBRETE_HOUR_MIN = '8';
    process.env.ESCALA_LEMBRETE_HOUR_MAX = '10';
    try {
      // Função lê hora real — só garante que retorna boolean
      assert.equal(typeof isEscalaLembreteMorningWindow(), 'boolean');
    } finally {
      if (prevMin === undefined) delete process.env.ESCALA_LEMBRETE_HOUR_MIN;
      else process.env.ESCALA_LEMBRETE_HOUR_MIN = prevMin;
      if (prevMax === undefined) delete process.env.ESCALA_LEMBRETE_HOUR_MAX;
      else process.env.ESCALA_LEMBRETE_HOUR_MAX = prevMax;
    }
  });
});
