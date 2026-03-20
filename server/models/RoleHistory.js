import mongoose from 'mongoose';

const roleHistorySchema = new mongoose.Schema({
  igrejaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Igreja', default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fromRole: { type: String, trim: true },
  toRole: { type: String, required: true, trim: true },
  ministerioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ministerio' },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

roleHistorySchema.index({ igrejaId: 1, userId: 1, createdAt: -1 });
roleHistorySchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('RoleHistory', roleHistorySchema);
