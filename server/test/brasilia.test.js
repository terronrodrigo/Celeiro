import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHHMM,
  DIAS_SEMANA,
  escalaDataToYMD,
  weekdayBrasilia,
} from '../lib/brasilia.js';
import { detectTurnoEscala } from '../lib/escala-consolidada.js';

describe('brasilia', () => {
  it('parseHHMM aceita HH:mm válido', () => {
    assert.equal(parseHHMM('10:00'), '10:00');
    assert.equal(parseHHMM('09:05'), '09:05');
    assert.equal(parseHHMM(''), null);
    assert.equal(parseHHMM('invalid'), null);
  });

  it('DIAS_SEMANA tem 7 dias (domingo=0)', () => {
    assert.equal(DIAS_SEMANA.length, 7);
    assert.equal(DIAS_SEMANA[0].value, 0);
    assert.equal(DIAS_SEMANA[0].label, 'Domingo');
  });

  it('escalaDataToYMD retorna YYYY-MM-DD', () => {
    const ymd = escalaDataToYMD('2026-05-17T15:00:00.000Z');
    assert.match(ymd, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('weekdayBrasilia para data fixa', () => {
    assert.equal(weekdayBrasilia('2026-05-17'), 0);
  });
});

describe('detectTurnoEscala', () => {
  it('detecta manhã e tarde no nome da escala', () => {
    assert.equal(detectTurnoEscala('Domingo de Manhã — 17/05'), 'manha');
    assert.equal(detectTurnoEscala('Domingo de Tarde'), 'tarde');
    assert.equal(detectTurnoEscala('Culto Especial'), null);
  });
});
