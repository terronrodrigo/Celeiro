import mongoose from 'mongoose';
import Igreja from './models/Igreja.js';

export const DEFAULT_IGREJA_SLUG = (process.env.DEFAULT_IGREJA_SLUG || 'celeiro-sp').trim().toLowerCase();

export async function findIgrejaBySlugOrId(slugRaw, idRaw) {
  const id = (idRaw || '').toString().trim();
  if (id && mongoose.Types.ObjectId.isValid(id)) {
    const g = await Igreja.findById(id).lean();
    if (g) return g;
  }
  const slug = (slugRaw || '').toString().trim().toLowerCase() || DEFAULT_IGREJA_SLUG;
  return Igreja.findOne({ slug }).lean();
}

/** Middleware após requireAuth: define req.tenantIgrejaId (ObjectId) para filtrar dados da igreja. */
export async function resolveTenant(req, res, next) {
  try {
    const role = String(req.userRole || '').toLowerCase();
    const isGlobalAdmin = req.authIsGlobalAdmin === true;

    if (role === 'admin' && isGlobalAdmin) {
      const slug = (req.headers['x-igreja-slug'] || req.query.igreja || '').toString().trim().toLowerCase();
      const idHeader = (req.headers['x-igreja-id'] || '').toString().trim();
      let igreja = await findIgrejaBySlugOrId(slug || null, idHeader || null);
      if (!igreja) {
        igreja = await Igreja.findOne({ slug: DEFAULT_IGREJA_SLUG }).lean();
      }
      if (!igreja) {
        return res.status(503).json({
          error: 'Nenhuma igreja cadastrada. Execute no servidor: node scripts/migrate-multi-igreja.js',
        });
      }
      req.tenantIgrejaId = igreja._id;
      req.tenantIgrejaSlug = igreja.slug;
      req.tenantIgrejaNome = igreja.nome;
      return next();
    }

    if (role === 'admin' && !isGlobalAdmin) {
      const idStr = req.authIgrejaIdStr;
      if (!idStr || !mongoose.Types.ObjectId.isValid(idStr)) {
        return res.status(403).json({ error: 'Admin sem igreja vinculada.' });
      }
      const igreja = await Igreja.findById(idStr).lean();
      if (!igreja) return res.status(403).json({ error: 'Igreja não encontrada.' });
      req.tenantIgrejaId = igreja._id;
      req.tenantIgrejaSlug = igreja.slug;
      req.tenantIgrejaNome = igreja.nome;
      return next();
    }

    const idStr = req.authIgrejaIdStr;
    if (!idStr || !mongoose.Types.ObjectId.isValid(idStr)) {
      return res.status(403).json({ error: 'Conta sem igreja vinculada. Contate o administrador.' });
    }
    const igreja = await Igreja.findById(idStr).lean();
    if (!igreja) return res.status(403).json({ error: 'Igreja não encontrada.' });
    req.tenantIgrejaId = igreja._id;
    req.tenantIgrejaSlug = igreja.slug;
    req.tenantIgrejaNome = igreja.nome;
    return next();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erro ao resolver igreja.' });
  }
}

export function tQ(req) {
  if (!req.tenantIgrejaId) return {};
  return { igrejaId: req.tenantIgrejaId };
}

/** Rotas públicas: ?igreja=slug, body.igrejaSlug ou body.tenant (default celeiro-sp).
 * Não usa body.igreja — em /api/cadastro esse campo é texto livre (“qual igreja frequenta”). */
export async function publicIgrejaFromRequest(req) {
  const slug = (
    req.query?.igreja ||
    req.body?.igrejaSlug ||
    req.body?.tenant ||
    ''
  ).toString().trim().toLowerCase() || DEFAULT_IGREJA_SLUG;
  const igreja = await Igreja.findOne({ slug }).lean();
  return igreja;
}
