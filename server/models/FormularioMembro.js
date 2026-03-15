import mongoose from 'mongoose';

const formularioMembroSchema = new mongoose.Schema({
  nomeCompleto: { type: String, trim: true, default: '' },
  dataNascimento: { type: Date },
  email: { type: String, required: true, lowercase: true, trim: true },
  enderecoCompleto: { type: String, trim: true, default: '' },
  telefoneWhatsapp: { type: String, trim: true, default: '' },
  batizado: { type: String, trim: true, default: '' }, // sim, não
  voluntario: { type: String, trim: true, default: '' }, // sim, não
  grupoOracao: { type: String, trim: true, default: '' }, // sim, não
  querMembroCeleiro: { type: String, trim: true, default: '' }, // sim, não
  compromissoRespeitar: { type: String, trim: true, default: '' }, // sim, não
  testemunho: { type: String, trim: true, default: '' },
}, { timestamps: true });

formularioMembroSchema.index({ email: 1 });
formularioMembroSchema.index({ createdAt: -1 });

export default mongoose.model('FormularioMembro', formularioMembroSchema);
