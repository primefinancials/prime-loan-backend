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
     * Normalise an inbound attachment so the stored record always carries a
     * usable `type`. Clients occasionally send an attachment with a missing or
     * bare type ("image" instead of "image/png"), which then makes the chat UI
     * fall back to rendering the raw URL. Infer a MIME type from the file
     * extension when needed.
     */
    static normaliseAttachment(att: any): { type: string; url: string; name?: string; size?: number } {
        // Legacy rows / odd clients sometimes store the attachment as a bare URL string.
        if (typeof att === 'string') att = { url: att };
        const url: string = String(att?.url || '');
        let type: string = String(att?.type || '').toLowerCase();

        const ext = (url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'];
        const videoExts = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v'];

        if (!type || type === 'file' || type === 'raw' || type === 'auto') {
            if (imageExts.includes(ext)) type = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
            else if (videoExts.includes(ext)) type = `video/${ext}`;
            else if (ext === 'pdf') type = 'application/pdf';
            else type = 'application/octet-stream';
        } else if (type === 'image' || type === 'video') {
            // bare kind -> pair with the extension when we can
            type = ext ? `${type}/${type === 'image' && ext === 'jpg' ? 'jpeg' : ext}` : `${type}/*`;
        } else if (type === 'pdf') {
            type = 'application/pdf';
        }

        return { type, url, name: att?.name || undefined, size: typeof att?.size === 'number' ? att.size : undefined };
    }

    /**
     * Send a Message
     */
    static async sendMessage(params: {
        escrowId: string,
        senderId: string,
        content: string,
        attachments?: { type?: string, url: string, name?: string, size?: number }[]
    }) {
        console.log(`[ChatService] Sending message for escrow ${params.escrowId} from ${params.senderId}`);
        const room = await this.getOrCreateRoom(params.escrowId, params.senderId);

        // --- NEW: Admin Restriction Logic ---
        const sender = await User.findById(params.senderId);
        if (!sender) throw new UnauthorizedError('User not found');

        const isAdmin = sender.role === 'admin' || sender.is_super_admin;

        // If Admin, STRICTLY check if Escrow is DISPUTED
        if (isAdmin) {
            const escrow = await EscrowTransaction.findById(params.escrowId);
            if (!escrow) throw new NotFoundError('Escrow not found');

            if (escrow.status !== 'DISPUTED') {
                throw new UnauthorizedError('Admins can only send messages in DISPUTED escrows.');
            }
        }
        // ------------------------------------

        const attachments = (params.attachments || [])
            .filter((a) => a && a.url)
            .map((a) => this.normaliseAttachment(a));

        const message = await ChatMessage.create({
            roomId: room._id,
            senderId: params.senderId,
            content: params.content,
            attachments,
            readBy: [params.senderId]
        });

        console.log(`[ChatService] Message saved to DB: ${message._id}`);


        const enrichedMessage = {
            _id: message._id,
            roomId: message.roomId,
            senderId: message.senderId,
            sender: {
                _id: sender._id,
                firstName: sender.user_metadata.first_name,
                lastName: sender.user_metadata.first_name,
                photo: sender.user_metadata.profile_photo,
                email: sender.email
            },
            content: message.content,
            attachments: message.attachments,
            readBy: message.readBy,
            createdAt: message.createdAt
        };

        // Broadcast via Socket
        const io = SocketService.getIO();
        const chatNamespace = io.of('/chat');

        chatNamespace.to(params.escrowId).emit('message_received', enrichedMessage);

        return enrichedMessage;
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

        // Enrich messages with user details
        const enrichedMessages = await Promise.all(messages.map(async (msg) => {
            const sender = await User.findById(msg.senderId);
            return {
                _id: msg._id,
                roomId: msg.roomId,
                senderId: msg.senderId,
                sender: sender ? {
                    _id: sender._id,
                    firstName: sender.user_metadata.first_name,
                    lastName: sender.user_metadata.first_name,
                    photo: sender.user_metadata.profile_photo,
                    email: sender.email
                } : null,
                content: msg.content,
                attachments: (msg.attachments || []).map((a: any) => ChatService.normaliseAttachment(a)),
                readBy: msg.readBy,
                createdAt: msg.createdAt
            };
        }));

        return enrichedMessages;
    }
}
