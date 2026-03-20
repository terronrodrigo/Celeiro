import mongoose from 'mongoose';

/**
 * Tenant: cada igreja/organização com dados isolados (ministérios, escalas, check-ins, etc.).
 * Dados legados devem ser associados à igreja "Celeiro São Paulo" após migração.
 */
const igrejaSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true },
  /** Identificador estável para URLs e APIs (ex.: celeiro-sp, inc-sp). Único. */
  slug: { type: String, required: true, trim: true, lowercase: true },
  ativo: { type: Boolean, default: true },
}, { timestamps: true });

igrejaSchema.index({ slug: 1 }, { unique: true });
igrejaSchema.index({ ativo: 1 });

export default mongoose.model('Igreja', igrejaSchema);
