import test from 'node:test';
import assert from 'node:assert/strict';
import { computePerfilVoluntarioGaps, isVoluntarioPerfilCompleto } from '../db/postgres/operational-data.js';
import { isVoluntarioPerfilIncompletoEmailWindow } from '../lib/voluntario-perfil-incompleto-email.js';
import { weekdayBrasilia } from '../lib/brasilia.js';

test('computePerfilVoluntarioGaps — perfil completo', () => {
  const gaps = computePerfilVoluntarioGaps({
    nome: 'Ana',
    nascimento: '1990-01-01',
    whatsapp: '11999999999',
    pais: 'Brasil',
    estado: 'SP',
    cidade: 'São Paulo',
    endereco: 'Rua A, 1',
    evangelico: 'Sim',
    igreja: 'Celeiro',
    tempoIgreja: '1 a 3 anos',
    ministerios: ['Louvor'],
    disponibilidade: 'Domingo',
    horasSemana: '2 a 4 horas',
    batizado: true,
  });
  assert.equal(gaps.completo, true);
  assert.equal(gaps.missing.length, 0);
});

test('computePerfilVoluntarioGaps — faltam campos', () => {
  const gaps = computePerfilVoluntarioGaps({ nome: 'Ana', batizado: null });
  assert.equal(gaps.completo, false);
  assert.ok(gaps.missing.includes('nascimento'));
  assert.ok(gaps.missing.includes('batizado'));
});

test('isVoluntarioPerfilCompleto', () => {
  assert.equal(isVoluntarioPerfilCompleto({ nome: 'X' }), false);
});

test('isVoluntarioPerfilIncompletoEmailWindow — terça 13h', () => {
  const terca13 = new Date('2026-06-09T16:00:00.000Z'); // terça 13h BRT
  assert.equal(weekdayBrasilia('2026-06-09'), 2);
  assert.equal(isVoluntarioPerfilIncompletoEmailWindow(terca13), true);
  const terca10 = new Date('2026-06-09T13:00:00.000Z'); // terça 10h BRT
  assert.equal(isVoluntarioPerfilIncompletoEmailWindow(terca10), false);
});
