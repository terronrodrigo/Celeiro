import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMinisterioKey,
  buildVisaoConsolidada,
  formatVisaoConsolidadaTexto,
  pickDayFromVisao,
} from '../lib/escala-consolidada.js';

describe('escala-consolidada', () => {
  it('normaliza aliases de ministério', () => {
    assert.equal(normalizeMinisterioKey('Parking / Estacionamento'), 'PARKING');
    assert.equal(normalizeMinisterioKey('Kids / Min. Infantil'), 'KIDS');
    assert.equal(normalizeMinisterioKey('Intercessão Presencial'), 'INTERCESSÃO');
  });

  it('conta manhã, tarde e almoço (2 cultos)', () => {
    const dataRef = '2026-05-17T15:00:00.000Z';
    const escalas = [
      { _id: 'e1', nome: 'Domingo de Manhã', data: dataRef },
      { _id: 'e2', nome: 'Domingo de Tarde', data: dataRef },
    ];
    const candidaturas = [
      { escalaId: 'e1', email: 'a@test.com', ministerio: 'Kids', status: 'aprovado', nome: 'Ana' },
      { escalaId: 'e2', email: 'a@test.com', ministerio: 'Kids', status: 'aprovado', nome: 'Ana' },
      { escalaId: 'e1', email: 'b@test.com', ministerio: 'Parking', status: 'aprovado', nome: 'Bob' },
    ];
    const visao = buildVisaoConsolidada({ escalas, candidaturas, statusIn: ['aprovado'] });
    const ymd = [...visao.byDate.keys()][0];
    assert.ok(ymd, 'deve haver um dia na visão');
    const day = visao.byDate.get(ymd);
    assert.ok(day);
    const kids = day.ministerios.get('KIDS');
    assert.equal(kids.manha, 1);
    assert.equal(kids.tarde, 1);
    assert.equal(kids.almoco, 1);
    const parking = day.ministerios.get('PARKING');
    assert.equal(parking.manha, 1);
    assert.equal(parking.almoco, 0);
    assert.equal(day.totalAlmoco, 1);
  });

  it('formatVisaoConsolidadaTexto inclui ministérios', () => {
    const escalas = [{ _id: 'e1', nome: 'Domingo de Manhã', data: '2026-05-17T15:00:00.000Z' }];
    const candidaturas = [
      { escalaId: 'e1', email: 'x@test.com', ministerio: 'Store', status: 'aprovado' },
    ];
    const visao = buildVisaoConsolidada({ escalas, candidaturas, statusIn: ['aprovado'] });
    const day = pickDayFromVisao(visao, [...visao.byDate.keys()][0]);
    const texto = formatVisaoConsolidadaTexto(day);
    assert.match(texto, /STORE/);
    assert.match(texto, /Manhã:/);
  });
});
