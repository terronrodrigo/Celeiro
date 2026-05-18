/**
 * Payloads vazios para rotas ainda não portadas ao PostgreSQL.
 * Rotas críticas (escalas, check-in público, cultos recorrentes, voluntários, candidaturas) usam PG diretamente.
 */

export const EMPTY_VOLUNTARIOS = {
  voluntarios: [],
  resumo: { total: 0, ministerios: [], disponibilidade: [], estados: [], cidades: [] },
};

export const EMPTY_CHECKINS = {
  checkins: [],
  resumo: { total: 0, ministerios: [] },
};

export const EMPTY_ARRAY = [];

export function emptyCheckinsPayload() {
  return { ...EMPTY_CHECKINS };
}
