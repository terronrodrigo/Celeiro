import { isMongo, isPostgres } from './connection.js';
import {
  pgFindUsersByEmail,
  pgFindIgrejaBySlug,
  pgFindIgrejaById,
  pgFindMinisteriosByIds,
  pgUpdateUserUltimoAcesso,
} from './postgres/repos.js';

export const GLOBAL_LOGIN_SLUG = '_global';

export async function collectActiveUsersMatchingPasswordPg(User, emailLower, senhaPlain) {
  if (isMongo()) {
    const candidates = await User.find({ email: emailLower });
    const out = [];
    for (const u of candidates) {
      if (!u.ativo) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await u.compararSenha(senhaPlain)) out.push(u);
    }
    return out;
  }
  if (isPostgres()) {
    const candidates = await pgFindUsersByEmail(emailLower);
    const out = [];
    for (const u of candidates) {
      if (!u.ativo) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await u.compararSenha(senhaPlain)) out.push(u);
    }
    return out;
  }
  return [];
}

export async function choicesForMultiTenantLoginPg(Igreja, users) {
  const igrejas = [];
  for (const u of users) {
    if (!u.igrejaId) {
      igrejas.push({ igrejaSlug: GLOBAL_LOGIN_SLUG, igrejaNome: 'Admin global (acesso a todas as igrejas)' });
      continue;
    }
    let ig;
    if (isMongo()) {
      // eslint-disable-next-line no-await-in-loop
      ig = await Igreja.findById(u.igrejaId).select('nome slug').lean();
    } else {
      // eslint-disable-next-line no-await-in-loop
      ig = await pgFindIgrejaById(u.igrejaId);
    }
    igrejas.push({
      igrejaSlug: ig?.slug || String(u.igrejaId),
      igrejaNome: ig?.nome || 'Igreja',
    });
  }
  return igrejas;
}

export async function resolveUserForEmailPasswordLoginPg(Igreja, User, emailLower, senhaPlain, igrejaSlugRaw) {
  const matches = await collectActiveUsersMatchingPasswordPg(User, emailLower, senhaPlain);
  if (matches.length === 0) {
    return { ok: false, status: 401, body: { error: 'Usuário ou senha inválidos.' } };
  }

  const slugOpt = (igrejaSlugRaw || '').toString().trim();
  const slugLower = slugOpt.toLowerCase();

  if (matches.length === 1) {
    return { ok: true, user: matches[0] };
  }

  if (!slugOpt) {
    const igrejas = await choicesForMultiTenantLoginPg(Igreja, matches);
    return {
      ok: false,
      status: 409,
      body: {
        error: 'Este email está cadastrado em mais de uma igreja. Escolha em qual deseja entrar.',
        needIgrejaChoice: true,
        igrejas,
      },
    };
  }

  let pool;
  if (slugLower === GLOBAL_LOGIN_SLUG || slugLower === 'global') {
    pool = matches.filter((u) => !u.igrejaId);
  } else {
    let ig;
    if (isMongo()) {
      ig = await Igreja.findOne({ slug: slugOpt }).lean();
    } else {
      ig = await pgFindIgrejaBySlug(slugOpt);
    }
    if (!ig) {
      return { ok: false, status: 400, body: { error: 'Igreja não encontrada para este slug.' } };
    }
    const igId = String(ig._id);
    pool = matches.filter((u) => u.igrejaId && String(u.igrejaId) === igId);
  }

  if (pool.length === 1) return { ok: true, user: pool[0] };
  if (pool.length === 0) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Não há conta com este email nesta igreja. Verifique a senha ou a igreja.' },
    };
  }
  const igrejas = await choicesForMultiTenantLoginPg(Igreja, matches);
  return {
    ok: false,
    status: 409,
    body: {
      error: 'Este email está cadastrado em mais de uma igreja. Escolha em qual deseja entrar.',
      needIgrejaChoice: true,
      igrejas,
    },
  };
}

export async function loadMinisterioNomesForUserPg(Ministerio, user) {
  let ministerioIds = Array.isArray(user.ministerioIds) ? user.ministerioIds : [];
  if (ministerioIds.length === 0 && user.ministerioId) ministerioIds = [user.ministerioId];
  const ministerioNomes = [];
  if (ministerioIds.length > 0 && user.igrejaId) {
    if (isMongo()) {
      const minQ = { _id: { $in: ministerioIds }, igrejaId: user.igrejaId };
      const mins = await Ministerio.find(minQ).select('nome').lean();
      mins.forEach((m) => { if (m?.nome) ministerioNomes.push(m.nome); });
    } else {
      const mins = await pgFindMinisteriosByIds(ministerioIds, user.igrejaId);
      mins.forEach((m) => { if (m?.nome) ministerioNomes.push(m.nome); });
    }
  }
  return { ministerioIds, ministerioNomes, ministerioId: ministerioIds[0] || null, ministerioNome: ministerioNomes[0] || null };
}

export async function touchUserOnLoginPg(user, ministerioIds) {
  if (isMongo()) {
    user.ultimoAcesso = new Date();
    if (ministerioIds?.length) user.ministerioIds = ministerioIds;
    await user.save();
    return;
  }
  await pgUpdateUserUltimoAcesso(user._id, ministerioIds);
}
