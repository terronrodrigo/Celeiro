import mongoose from 'mongoose';

const escalaInscricoesPorMinisterioSchema = new mongoose.Schema({
  escalaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Escala', required: true },
  /** Nome canônico do ministério (como em `Ministerio.nome`). */
  ministerio: { type: String, required: true, trim: true },
  /** Se false, bloqueia novas candidaturas para este ministério nesta escala (mesmo se a escala estiver ativa). */
  ativo: { type: Boolean, default: true },
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

escalaInscricoesPorMinisterioSchema.index({ escalaId: 1, ministerio: 1 }, { unique: true });
escalaInscricoesPorMinisterioSchema.index({ ativo: 1, escalaId: 1, ministerio: 1 });

export default mongoose.model('EscalaInscricoesPorMinisterio', escalaInscricoesPorMinisterioSchema);

