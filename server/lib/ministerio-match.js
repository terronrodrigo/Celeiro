/** Filtros de ministério para líderes (nome exato ou parcial). */

export function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeMinisterioName(n) {
  return String(n || '').trim().toLowerCase();
}

/** Candidatura pertence a um dos ministérios do líder? */
export function candidaturaMatchesLiderMinisterios(candidaturaMinisterio, liderNomes) {
  const cand = normalizeMinisterioName(candidaturaMinisterio);
  if (!cand || !liderNomes?.length) return false;
  return liderNomes.some((n) => {
    const ln = normalizeMinisterioName(n);
    if (!ln) return false;
    if (cand === ln) return true;
    if (cand.includes(ln) || ln.includes(cand)) return true;
    const parts = ln.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
    return parts.some((p) => cand === p || cand.includes(p));
  });
}

/** Filtra lista em memória (Postgres). */
export function filterCandidaturasForLider(candidaturas, liderNomes) {
  if (!liderNomes?.length) return [];
  return (candidaturas || []).filter((c) =>
    candidaturaMatchesLiderMinisterios(c.ministerio, liderNomes),
  );
}
