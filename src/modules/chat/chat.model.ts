import mongoose, { Schema, Document } from 'mongoose';
import { getCollectionName } from '../../shared/utils/collection.utils';

export interface IChatRoom extends Document {
    escrowId: string;
    participants: string[]; // User IDs (Buyer, Seller, Admin)
    status: 'OPEN' | 'RESOLVED';
    createdAt: Date;
    updatedAt: Date;
}

export interface IChatMessage extends Document {
    roomId: string; // Reference to ChatRoom
    senderId: string;
    content: string;
    attachments: {
        type: 'image' | 'pdf' | 'video';
        url: string
    }[];
    readBy: string[];
    createdAt: Date;
}

const ChatRoomSchema = new Schema<IChatRoom>({
    escrowId: { type: String, required: true, unique: true, index: true },
    participants: [{ type: String, required: true }],
    status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN' }
}, {
    timestamps: true,
    collection: getCollectionName('chat_rooms')
});

const ChatMessageSchema = new Schema<IChatMessage>({
    roomId: { type: String, required: true, index: true },
    senderId: { type: String, required: true },
    content: { type: String },
    attachments: [{
        type: { type: String, enum: ['image', 'pdf', 'video'] },
        url: { type: String }
    }],
    readBy: [{ type: String }]
}, {
    timestamps: true,
    collection: getCollectionName('chat_messages')
});

export const ChatRoom = mongoose.model<IChatRoom>('ChatRoom', ChatRoomSchema);
export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);
