import mongoose from 'mongoose';

const formularioBatismoSchema = new mongoose.Schema({
  eventoId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventoFormulario', required: true },
  nomeCompleto: { type: String, trim: true, default: '' },
  dataNascimento: { type: Date },
  email: { type: String, trim: true, lowercase: true, default: '' },
  telefoneWhatsapp: { type: String, trim: true, default: '' },
  reconheceJesus: { type: String, trim: true, default: '' }, // sim, não
  querMembroCeleiro: { type: String, trim: true, default: '' }, // sim, não
  batizarProximo: { type: String, trim: true, default: '' }, // sim, não
  cursoBatismo: { type: String, trim: true, default: '' }, // sim, não
}, { timestamps: true });

formularioBatismoSchema.index({ eventoId: 1 });
formularioBatismoSchema.index({ email: 1, eventoId: 1 });

export default mongoose.model('FormularioBatismo', formularioBatismoSchema);
