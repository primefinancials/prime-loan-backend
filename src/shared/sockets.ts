import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ACCESS_TOKEN_SECRET } from '../config';
import pino from 'pino';

const logger = pino({ name: 'socket-service' });

export class SocketService {
    private static io: Server;

    static init(httpServer: HttpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        // Middleware for Auth
        this.io.use((socket, next) => {
            const token = socket.handshake.auth.token;

            // DEBUG LOGGING
            logger.info({
                socketId: socket.id,
                auth: socket.handshake.auth,
                headers: socket.handshake.headers['authorization'] ? 'Present' : 'Missing'
            }, "Incoming socket connection attempt");

            if (!token) {
                logger.warn(`Socket connection attempt without token: ${socket.id}`);
                const error = new Error("Authentication error: No token provided");
                (error as any).data = { content: "Please provide a valid JWT token in the auth object." };
                return next(error);
            }

            const tokenString = token.startsWith("Bearer ") ? token.slice(7) : token;

            if (!ACCESS_TOKEN_SECRET) {
                logger.error("ACCESS_TOKEN_SECRET not defined in environment variables");
                return next(new Error("Server error: Configuration missing"));
            }

            try {
                const decoded = jwt.verify(tokenString, ACCESS_TOKEN_SECRET);
                (socket as any).user = decoded;
                next();
            } catch (e: any) {
                logger.warn(`Socket auth failed for ${socket.id}: ${e.message}`);
                const error = new Error("Authentication error: Invalid token");
                (error as any).data = { content: e.message };
                next(error);
            }
        });

        this.io.on('connection', (socket) => {
            const userId = (socket as any).user?.id || (socket as any).user?._id;
            logger.info(`Socket connected: ${socket.id} (User: ${userId || 'unknown'})`);

            if (userId) {
                socket.join(`user_${userId}`);
                logger.info(`Socket ${socket.id} joined room user_${userId}`);
            }

            socket.on('disconnect', () => {
                logger.info(`Socket disconnected: ${socket.id}`);
            });
        });

        // Initialize Namespaces
        this.initChatNamespace();
        this.initAdminNamespace();

        logger.info('Socket.io initialized');
    }

    private static initChatNamespace() {
        const chatNamespace = this.io.of('/chat');
        logger.info("Chat namespace registered: /chat");

        // Middleware for /chat namespace (re-uses main auth, but can add specifics)
        // Note: Global middleware applies to default namespace, for custom namespaces we might need separate middleware if not inherited?
        // Actually socket.io middlewares are per namespace. The global io.use applies to the default namespace "/"
        // We should apply auth to these namespaces too if they don't inherit.
        // Let's attach the auth middleware to the namespaces specifically or just rely on the main connect if the client connects to main first?
        // Usually clients connect to a namespace directly.

        // Let's create a reusable auth function
        const authMiddleware = (socket: Socket, next: (err?: Error) => void) => {
            const token = socket.handshake.auth.token;
            if (!token) return next(new Error("Authentication error"));
            const tokenString = token.startsWith("Bearer ") ? token.slice(7) : token;
            if (!ACCESS_TOKEN_SECRET) return next(new Error("Server error"));
            try {
                const decoded = jwt.verify(tokenString, ACCESS_TOKEN_SECRET);
                (socket as any).user = decoded;
                next();
            } catch (e) {
                next(new Error("Authentication error"));
            }
        };

        chatNamespace.use(authMiddleware);
        chatNamespace.on('connection', (socket) => {
            socket.on('join_room', (data) => {
                logger.info(`Socket ${socket.id} joining room ${data.escrowId}`);
                socket.join(data.escrowId);
            });

            socket.on('typing', (data) => {
                socket.to(data.escrowId).emit('user_typing', {
                    userId: (socket as any).user.id,
                    isTyping: data.isTyping
                });
            });

            socket.on('send_message', async (data) => {
                try {
                    logger.info(`Socket ${socket.id} sending message to room ${data.escrowId}`);

                    // Import dynamically to avoid circular dependency if any
                    const { ChatService } = await import('../modules/chat/chat.service');

                    await ChatService.sendMessage({
                        escrowId: data.escrowId,
                        senderId: (socket as any).user.id,
                        content: data.content,
                        attachments: data.attachments || []
                    });

                    // Helper response to sender (optional, as broadcast covers it)
                    // socket.emit('message_sent', { status: 'success' });
                } catch (err: any) {
                    logger.error(`Error processing send_message: ${err.message}`);
                    socket.emit('error', { message: 'Failed to send message', details: err.message });
                }
            });
        });
    }

    private static initAdminNamespace() {
        const adminNamespace = this.io.of('/admin');

        const authMiddleware = (socket: Socket, next: (err?: Error) => void) => {
            const token = socket.handshake.auth.token;
            if (!token) return next(new Error("Authentication error"));
            const tokenString = token.startsWith("Bearer ") ? token.slice(7) : token;
            if (!ACCESS_TOKEN_SECRET) return next(new Error("Server error"));
            try {
                const decoded = jwt.verify(tokenString, ACCESS_TOKEN_SECRET) as any;
                (socket as any).user = decoded;
                next();
            } catch (e) {
                next(new Error("Authentication error"));
            }
        };

        adminNamespace.use(authMiddleware);

        adminNamespace.on('connection', (socket) => {
            logger.info(`Admin connected: ${socket.id}`);
        });
    }

    static getIO() {
        if (!this.io) throw new Error("Socket.io not initialized!");
        return this.io;
    }

    /**
     * Broadcasts a live VFD balance update to a specific user's private socket room.
     */
    static async broadcastBalanceUpdate(userId: string, accountNo?: string) {
        if (!this.io) return;
        try {
            const { default: User } = await import('../modules/users/user.model');
            const { VfdProvider } = await import('./providers/vfd.provider');

            let targetAccountNo = accountNo;

            // Fetch account number if not provided
            if (!targetAccountNo) {
                const user = await User.findById(userId).select('user_metadata.accountNo');
                if (user && user.user_metadata?.accountNo) {
                    targetAccountNo = user.user_metadata.accountNo;
                }
            }

            if (!targetAccountNo) {
                logger.warn(`Cannot broadcast balance update for user ${userId}: No account number found.`);
                return;
            }

            // Sync with VFD Live
            const vfdInfo = await new VfdProvider().getAccountInfo(targetAccountNo);
            const liveBalance = Number(vfdInfo?.data?.accountBalance) || 0;

            // Emit to private user room
            this.io.to(`user_${userId}`).emit('balance_updated', {
                event: 'balance_updated',
                data: { newBalance: liveBalance }
            });
            logger.info(`Broadcasted live balance (₦${liveBalance}) to user_${userId}`);

        } catch (error: any) {
            logger.error({ error: error.message }, `Failed to broadcast balance update to user ${userId}`);
        }
    }
}
