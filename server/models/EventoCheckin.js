import mongoose from 'mongoose';

const eventoCheckinSchema = new mongoose.Schema({
  data: { type: Date, required: true },
  label: { type: String, trim: true, default: '' },
  criadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ativo: { type: Boolean, default: true },
}, { timestamps: true });

eventoCheckinSchema.index({ data: 1 });
eventoCheckinSchema.index({ ativo: 1, data: 1 });

export default mongoose.model('EventoCheckin', eventoCheckinSchema);
