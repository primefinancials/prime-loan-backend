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
            if (!token) {
                logger.warn(`Socket connection attempt without token: ${socket.id}`);
                return next(new Error("Authentication error"));
            }

            const tokenString = token.startsWith("Bearer ") ? token.slice(7) : token;

            if (!ACCESS_TOKEN_SECRET) {
                logger.error("ACCESS_TOKEN_SECRET not defined");
                return next(new Error("Server error"));
            }

            try {
                const decoded = jwt.verify(tokenString, ACCESS_TOKEN_SECRET);
                (socket as any).user = decoded;
                next();
            } catch (e: any) {
                logger.warn(`Socket auth failed for ${socket.id}: ${e.message}`);
                next(new Error("Authentication error"));
            }
        });

        this.io.on('connection', (socket) => {
            logger.info(`Socket connected: ${socket.id} (User: ${(socket as any).user?.id || 'unknown'})`);

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

            socket.on('send_message', (data) => {
                // For now just broadcast, but in reality we should save to DB via controller/service
                // We'll let the REST API handle saving, or handle it here?
                // The prompt says "Emit via Socket.io" in ChatService.sendMessage.
                // So client sends via REST, server emits? 
                // OR client sends via Socket?
                // Frontend Walkthrough says: Emit Events (Client -> Server): send_message.
                // So client sends via socket.
                // We need to call ChatService.saveMessage here. 
                // I will implement that integration later when ChatService exists.
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
                // TODO: Check if user is admin
                // if (decoded.role !== 'admin') return next(new Error("Forbidden"));
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
}
