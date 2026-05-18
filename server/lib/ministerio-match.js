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

/** Lista normalizada de ministérios do voluntário (JSON `ministerios`, legado `ministerio` ou CSV). */
export function splitVoluntarioMinisterios(vol) {
  if (!vol) return [];
  if (Array.isArray(vol.ministerios) && vol.ministerios.length) {
    return [...new Set(vol.ministerios.map((x) => String(x ?? '').trim()).filter(Boolean))];
  }
  const csv = String(vol.ministerio ?? '').trim();
  if (!csv) return [];
  return [...new Set(csv.split(',').map((x) => x.trim()).filter(Boolean))];
}

/** Voluntário aparece para o líder se algum ministério dele casa com a lista do líder (mesma regra das candidaturas). */
export function voluntarioMatchesLiderMinisterios(vol, liderNomes) {
  if (!liderNomes?.length) return false;
  const mins = splitVoluntarioMinisterios(vol);
  if (!mins.length) return false;
  return mins.some((m) => candidaturaMatchesLiderMinisterios(m, liderNomes));
}

/**
 * PUT /api/me/perfil: alinha `ministerios` e `ministerio` (CSV) no body antes de gravar.
 */
export function normalizeVoluntarioMinisteriosPatch(body) {
  if (!body || typeof body !== 'object') return;
  if (Array.isArray(body.ministerios)) {
    const arr = [...new Set(body.ministerios.map((x) => String(x ?? '').trim()).filter(Boolean))];
    body.ministerios = arr;
    body.ministerio = arr.join(', ');
    return;
  }
  if (body.ministerio !== undefined) {
    const arr = [...new Set(String(body.ministerio || '').split(',').map((s) => s.trim()).filter(Boolean))];
    body.ministerios = arr;
    body.ministerio = arr.join(', ');
  }
}
