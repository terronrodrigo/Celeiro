import mongoose from 'mongoose';

const ministerioSchema = new mongoose.Schema({
  igrejaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Igreja', required: true },
  nome: { type: String, required: true, trim: true },
  slug: { type: String, trim: true, lowercase: true },
  ativo: { type: Boolean, default: true },
  criadoEm: { type: Date, default: Date.now },
}, { timestamps: true });

ministerioSchema.index({ igrejaId: 1, slug: 1 });
ministerioSchema.index({ igrejaId: 1, nome: 1 });
ministerioSchema.index({ igrejaId: 1, ativo: 1 });
ministerioSchema.index({ slug: 1 });
ministerioSchema.index({ ativo: 1 });

export default mongoose.model('Ministerio', ministerioSchema);
