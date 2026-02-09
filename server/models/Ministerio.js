import mongoose from 'mongoose';

const ministerioSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true },
  slug: { type: String, trim: true, lowercase: true },
  ativo: { type: Boolean, default: true },
  criadoEm: { type: Date, default: Date.now },
}, { timestamps: true });

ministerioSchema.index({ slug: 1 });
ministerioSchema.index({ ativo: 1 });

export default mongoose.model('Ministerio', ministerioSchema);
