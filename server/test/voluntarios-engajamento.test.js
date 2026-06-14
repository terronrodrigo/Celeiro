import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBatizadoIntoPerfilDados } from '../db/postgres/repos.js';
import {
  isVoluntarioPerfilMembroCompleto,
  resolveBatizadoVoluntario,
} from '../db/postgres/voluntarios-engajamento.js';

test('mergeBatizadoIntoPerfilDados — check-in sim sempre grava no perfil', () => {
  const d = mergeBatizadoIntoPerfilDados({ batizado: false }, true, { fromCheckin: true });
  assert.equal(d.batizado, true);
});

test('mergeBatizadoIntoPerfilDados — check-in nao grava se perfil ja batizado', () => {
  const d = mergeBatizadoIntoPerfilDados({ batizado: true }, false, { fromCheckin: true });
  assert.equal(d.batizado, true);
});

test('mergeBatizadoIntoPerfilDados — check-in nao preenche perfil vazio', () => {
  const d = mergeBatizadoIntoPerfilDados({}, false, { fromCheckin: true });
  assert.equal(d.batizado, false);
});

test('mergeBatizadoIntoPerfilDados — cadastro so preenche vazio', () => {
  assert.equal(mergeBatizadoIntoPerfilDados({}, true).batizado, true);
  assert.equal(mergeBatizadoIntoPerfilDados({ batizado: false }, true).batizado, false);
});

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

test('resolveBatizadoVoluntario — usa check-in sim quando perfil vazio', () => {
  const r = resolveBatizadoVoluntario(null, { hasSim: true, latest: 'sim' });
  assert.equal(r.batizado, true);
  assert.equal(r.fonte, 'checkin');
});

test('resolveBatizadoVoluntario — check-in nao sem perfil', () => {
  const r = resolveBatizadoVoluntario(null, { hasSim: false, latest: 'nao' });
  assert.equal(r.batizado, false);
  assert.equal(r.fonte, 'checkin');
});

test('resolveBatizadoVoluntario — sim em algum check-in prevalece sobre nao recente', () => {
  const r = resolveBatizadoVoluntario(null, { hasSim: true, latest: 'nao' });
  assert.equal(r.batizado, true);
  assert.equal(r.fonte, 'checkin');
});

test('resolveBatizadoVoluntario — perfil e check-in', () => {
  assert.equal(resolveBatizadoVoluntario(true, { hasSim: false, latest: 'nao' }).batizado, true);
  // check-in "sim" prevalece sobre perfil "não" desatualizado
  assert.equal(resolveBatizadoVoluntario(false, { hasSim: true, latest: 'sim' }).batizado, true);
  assert.equal(resolveBatizadoVoluntario(false, { hasSim: false, latest: 'nao' }).batizado, false);
});
