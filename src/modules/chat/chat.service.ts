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
        console.log(`[ChatService] Sending message for escrow ${params.escrowId} from ${params.senderId}`);
        const room = await this.getOrCreateRoom(params.escrowId, params.senderId);

        const message = await ChatMessage.create({
            roomId: room._id,
            senderId: params.senderId,
            content: params.content,
            attachments: params.attachments || [],
            readBy: [params.senderId]
        });

        console.log(`[ChatService] Message saved to DB: ${message._id}`);

        // Broadcast via Socket
        const io = SocketService.getIO();
        const chatNamespace = io.of('/chat');

        // Check if room exists in socket adapter logic (optional, but good for debug)
        // const roomSize = chatNamespace.adapter.rooms.get(params.escrowId)?.size || 0;
        // console.log(`[ChatService] Broadcasting to room ${params.escrowId} (start size: ${roomSize})`);

        chatNamespace.to(params.escrowId).emit('message_received', {
            _id: message._id,
            senderId: message.senderId,
            content: message.content,
            attachments: message.attachments,
            createdAt: message.createdAt
        });

        return message;
    }

    /**
     * Get Chat History
     */
    static async getHistory(escrowId: string, userId: string) {
        console.log(`[ChatService] Fetching history for escrow ${escrowId} by user ${userId}`);
        const room = await ChatRoom.findOne({ escrowId });

        if (!room) {
            console.log(`[ChatService] Room not found for escrow ${escrowId}`);
            return [];
        }

        // Access Check
        if (!room.participants.includes(userId)) {
            const user = await User.findById(userId);
            if (user?.role !== 'admin' && !user?.is_super_admin) {
                console.warn(`[ChatService] Access denied for user ${userId} in room ${room._id}`);
                throw new UnauthorizedError('Access denied');
            }
        }

        const messages = await ChatMessage.find({ roomId: room._id }).sort({ createdAt: 1 });
        console.log(`[ChatService] Found ${messages.length} messages`);
        return messages;
    }
}
