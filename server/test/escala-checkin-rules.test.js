import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getProximaOcorrenciaYmd,
  isEscalaAbertaParaCandidatura,
  isCheckinEventAberto,
  isWithinCheckinWindow,
  buildReativacaoInscricaoPatch,
} from '../lib/escala-checkin-rules.js';

describe('escala-checkin-rules', () => {
  it('próxima ocorrência a partir de uma segunda encontra quarta da mesma semana', () => {
    const prox = getProximaOcorrenciaYmd(3, '2026-05-11'); // segunda
    assert.equal(prox, '2026-05-13');
  });

  it('escala recorrente: só aberta na próxima data futura', () => {
    const culto = { diaSemana: 0 };
    const escalaProxima = {
      ativo: true,
      data: '2026-05-17T03:00:00.000Z',
      cultoRecorrenteId: 'c1',
    };
    const escalaSemanaSeguinte = {
      ativo: true,
      data: '2026-05-24T03:00:00.000Z',
      cultoRecorrenteId: 'c1',
    };
    assert.equal(isEscalaAbertaParaCandidatura(escalaProxima, culto, '2026-05-11'), true);
    assert.equal(isEscalaAbertaParaCandidatura(escalaSemanaSeguinte, culto, '2026-05-11'), false);
  });

  it('escala fecha no dia do culto', () => {
    const escala = { ativo: true, data: '2026-05-17T03:00:00.000Z' };
    assert.equal(isEscalaAbertaParaCandidatura(escala, null, '2026-05-17'), false);
  });

  it('buildReativacaoInscricaoPatch define prazo no dia do culto', () => {
    const escala = { ativo: true, data: '2026-05-17T03:00:00.000Z' };
    const patch = buildReativacaoInscricaoPatch(escala, null, '2026-05-17');
    assert.equal(patch.inscricaoAte, '2026-05-17');
    assert.equal(patch.inscricaoAteHora, null);
    assert.equal(isEscalaAbertaParaCandidatura({ ...escala, ...patch }, null, '2026-05-17'), true);
  });

  it('prazo estendido reabre inscrições no dia do culto', () => {
    const escala = {
      ativo: true,
      data: '2026-05-17T03:00:00.000Z',
      inscricaoAte: '2026-05-17',
    };
    assert.equal(isEscalaAbertaParaCandidatura(escala, null, '2026-05-17'), true);
    const expirada = { ...escala, inscricaoAte: '2026-05-16' };
    assert.equal(isEscalaAbertaParaCandidatura(expirada, null, '2026-05-17'), false);
  });

  it('check-in respeita ativo e dia do evento', () => {
    const evento = {
      ativo: true,
      data: '2026-05-17T03:00:00.000Z',
      horarioInicio: '',
      horarioFim: '',
    };
    assert.equal(isCheckinEventAberto(evento, '2026-05-16'), false);
    assert.equal(isWithinCheckinWindow(evento, '2026-05-17'), true);
    const fechado = { ...evento, ativo: false };
    assert.equal(isCheckinEventAberto(fechado, '2026-05-17'), false);
  });

  it('evento criado em YMD não muda de dia ao ler/formatar (regressão TZ)', () => {
    // Simula o que pgCreateEventoCheckin grava e pgFindEventoCheckinById devolve
    // depois que o parser global de DATE retorna string. Garante que isCheckinEventAberto
    // valida o dia correto em Brasília, sem voltar 1 dia.
    const eventoFromPg = {
      ativo: true,
      data: new Date('2026-05-17T03:00:00.000Z'),
      horarioInicio: '08:00',
      horarioFim: '23:00',
    };
    assert.equal(isWithinCheckinWindow(
      eventoFromPg,
      '2026-05-17',
    ), true);
    assert.equal(isWithinCheckinWindow(
      eventoFromPg,
      '2026-05-16',
    ), false);
  });
});
