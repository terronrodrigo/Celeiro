import test from 'node:test';
import assert from 'node:assert/strict';
import { isVoluntarioPerfilMembroCompleto } from '../db/postgres/voluntarios-engajamento.js';

test('isVoluntarioPerfilMembroCompleto — perfil completo e batizado', () => {
  assert.equal(isVoluntarioPerfilMembroCompleto({
    nome: 'Maria',
    telefone: '11999999999',
    nascimento: '1990-01-01',
    evangelico: 'Sim',
    igreja: 'Celeiro',
    batizado: true,
  }), true);
});

test('isVoluntarioPerfilMembroCompleto — falta batismo', () => {
  assert.equal(isVoluntarioPerfilMembroCompleto({
    nome: 'Maria',
    telefone: '11999999999',
    nascimento: '1990-01-01',
    evangelico: 'Sim',
    igreja: 'Celeiro',
    batizado: false,
  }), false);
});

test('isVoluntarioPerfilMembroCompleto — campos obrigatórios ausentes', () => {
  assert.equal(isVoluntarioPerfilMembroCompleto({
    nome: 'Maria',
    batizado: true,
  }), false);
});
