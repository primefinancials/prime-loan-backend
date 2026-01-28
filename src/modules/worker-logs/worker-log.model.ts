import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IWorkerLog extends Document {
    workerName: string;
    level: 'info' | 'error' | 'warn';
    message: string;
    metadata?: any;
    timestamp: Date;
}

const WorkerLogSchema: Schema = new Schema({
    workerName: { type: String, required: true, index: true },
    level: { type: String, enum: ['info', 'error', 'warn'], required: true },
    message: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now, index: true }
}, {
    timestamps: true, // adds createdAt and updatedAt
    collection: getCollectionName('worker_logs')
});

// Create compound index for querying logs by worker and time
WorkerLogSchema.index({ workerName: 1, timestamp: -1 });

export default mongoose.model<IWorkerLog>('WorkerLog', WorkerLogSchema);
