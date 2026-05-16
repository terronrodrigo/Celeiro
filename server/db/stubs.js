/** Respostas vazias quando só Postgres está ativo (Mongo suspenso / migração pendente). */

export const EMPTY_VOLUNTARIOS = {
  voluntarios: [],
  resumo: { total: 0, areas: [], disponibilidade: [], estados: [], cidades: [] },
};

export const EMPTY_CHECKINS = {
  checkins: [],
  resumo: { total: 0, ministerios: [] },
};

export const EMPTY_ARRAY = [];

export function emptyCheckinsPayload() {
  return { ...EMPTY_CHECKINS };
}
