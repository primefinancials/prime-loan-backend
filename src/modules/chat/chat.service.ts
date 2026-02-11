import { ChatRoom, ChatMessage } from './chat.model';
import { EscrowTransaction } from '../escrow/escrow.model';
import { SocketService } from '../../shared/sockets';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../exceptions';
import User from '../users/user.model';
import { Types } from 'mongoose';

export class ChatService {

    /**
     * Create or Get existing Chat Room for an Escrow
     */
    static async getOrCreateRoom(escrowId: string, userId: string) {
        let room = await ChatRoom.findOne({ escrowId });

        if (!room) {
            // Validate Escrow and Participants
            const escrow = await EscrowTransaction.findById(escrowId);
            if (!escrow) throw new NotFoundError('Escrow not found');

            // Check if user is participant
            if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
                // Check if admin? 
                const user = await User.findById(userId);
                if (user?.role !== 'admin' && !user?.is_super_admin) {
                    // For now strictly buyer/seller for creation
                    throw new UnauthorizedError('Not a participant');
                }
            }

            // Create Room
            room = await ChatRoom.create({
                escrowId,
                participants: [escrow.buyerId, escrow.sellerId],
                status: 'OPEN'
            });

            // Link back to Escrow
            escrow.chatRoomId = (room._id as any).toString();
            await escrow.save();
        }

        // Verify access logic again if needed (e.g. if room existed but user is not in it - unlikely for 1-1 escrow)
        if (!room.participants.includes(userId)) {
            // Check if Admin
            const user = await User.findById(userId);
            if (user?.role !== 'admin' && !user?.is_super_admin) {
                throw new UnauthorizedError('Access denied');
            }
            // If admin, maybe add to participants? Or just allow view. 
            // Let's add admin to participants if they join?
        }

        return room;
    }

    /**
     * Send a Message
     */
    static async sendMessage(params: {
        escrowId: string,
        senderId: string,
        content: string,
        attachments?: { type: 'image' | 'pdf' | 'video', url: string }[]
    }) {
        const room = await this.getOrCreateRoom(params.escrowId, params.senderId);

        const message = await ChatMessage.create({
            roomId: room._id,
            senderId: params.senderId,
            content: params.content,
            attachments: params.attachments || [],
            readBy: [params.senderId]
        });

        // Broadcast via Socket
        const io = SocketService.getIO();
        const chatNamespace = io.of('/chat');

        chatNamespace.to(params.escrowId).emit('message_received', {
            _id: message._id,
            senderId: message.senderId,
            content: message.content,
            attachments: message.attachments,
            createdAt: message.createdAt
        });

        // Trigger Notification Logic (Email/Push) for offline users
        // TODO: Enqueue Job

        return message;
    }

    /**
     * Get Chat History
     */
    static async getHistory(escrowId: string, userId: string) {
        const room = await ChatRoom.findOne({ escrowId });
        if (!room) return []; // Or throw error?

        // Access Check
        if (!room.participants.includes(userId)) {
            const user = await User.findById(userId);
            if (user?.role !== 'admin' && !user?.is_super_admin) {
                throw new UnauthorizedError('Access denied');
            }
        }

        const messages = await ChatMessage.find({ roomId: room._id }).sort({ createdAt: 1 });
        return messages;
    }
}
