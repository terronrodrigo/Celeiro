import { escalaDataToYMD } from './brasilia.js';
import { candidaturaMatchesLiderMinisterios } from './ministerio-match.js';

export function enrichCandidaturasForPanel(candidaturas, {
  escala,
  statsMap,
  checkinsMap,
  liderMinisterios = [],
}) {
  const result = candidaturas.map((c) => {
    const emailKey = (c.email || '').toLowerCase();
    const stats = statsMap.get(emailKey) || {};
    const ci = checkinsMap.get(emailKey) || { total: 0, ministerios: [] };
    const jaServiuMinLider = liderMinisterios.length > 0
      && ci.ministerios.some((m) => candidaturaMatchesLiderMinisterios(m, liderMinisterios));
    const totalPart = Number(stats.totalParticipacoes || 0);
    const totalCi = Number(ci.total || 0);
    return {
      ...c,
      escalaNome: escala?.nome,
      escalaData: escala?.data != null ? escalaDataToYMD(escala.data) : null,
      escalaId: escala?._id,
      totalCheckins: totalCi,
      totalParticipacoes: totalPart,
      totalDesistencias: Number(stats.totalDesistencias || 0),
      totalFaltas: Number(stats.totalFaltas || 0),
      jaServiuAlgum: totalCi + totalPart > 0,
      jaServiuMinLider,
    };
  });

  result.sort((a, b) => {
    const aAprovado = a.status === 'aprovado' ? 1 : 0;
    const bAprovado = b.status === 'aprovado' ? 1 : 0;
    if (bAprovado !== aAprovado) return bAprovado - aAprovado;
    const aCheckins = a.totalCheckins || 0;
    const bCheckins = b.totalCheckins || 0;
    if (bCheckins !== aCheckins) return bCheckins - aCheckins;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  return result;
}
