import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IWorkerStatus extends Document {
  workerName: string;
  status: 'running' | 'stopped' | 'error';
  lastActivity: Date;
  lastRunAt: Date;
  lastError?: string;
  metadata?: any;
}

const WorkerStatusSchema: Schema = new Schema({
  workerName: { type: String, required: true, unique: true },
  status: { type: String, enum: ['running', 'stopped', 'error'], default: 'stopped' },
  lastActivity: { type: Date, default: Date.now },
  lastRunAt: { type: Date },
  lastError: { type: String },
  metadata: { type: Schema.Types.Mixed }
}, {
  timestamps: true,
  collection: getCollectionName('worker_statuses')
});

export default mongoose.model<IWorkerStatus>('WorkerStatus', WorkerStatusSchema);
