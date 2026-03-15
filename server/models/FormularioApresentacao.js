import mongoose from 'mongoose';

const criancaSchema = new mongoose.Schema({
  nomeCompleto: { type: String, trim: true, default: '' },
  dataNascimento: { type: Date },
}, { _id: false });

const formularioApresentacaoSchema = new mongoose.Schema({
  eventoId: { type: mongoose.Schema.Types.ObjectId, ref: 'EventoFormulario', required: true },
  nomeMae: { type: String, trim: true, default: '' },
  nomePai: { type: String, trim: true, default: '' },
  quantidadeCriancas: { type: Number, default: 0 },
  criancas: [criancaSchema],
  endereco: { type: String, trim: true, default: '' },
  paisMembrosCeleiro: { type: String, trim: true, default: '' }, // sim, não, ainda não
  emailContato: { type: String, trim: true, lowercase: true, default: '' },
  whatsappContato: { type: String, trim: true, default: '' },
  compromissoEducar: { type: String, trim: true, default: '' }, // sim, não
}, { timestamps: true });

formularioApresentacaoSchema.index({ eventoId: 1 });
formularioApresentacaoSchema.index({ emailContato: 1, eventoId: 1 });

export default mongoose.model('FormularioApresentacao', formularioApresentacaoSchema);
