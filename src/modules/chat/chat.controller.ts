import { Request, Response } from 'express';
import { ProtectedRequest } from '../../interfaces';
import { ChatService } from './chat.service';

export class ChatController {

    static async getHistory(req: Request, res: Response) {
        try {
            const { escrowId } = req.params;
            const user = (req as ProtectedRequest).user || (req as ProtectedRequest).admin;
            const messages = await ChatService.getHistory(escrowId, user!._id.toString());
            res.status(200).json({
                status: 'success',
                data: messages
            });
        } catch (error: any) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    }

    static async sendMessage(req: Request, res: Response) {
        try {
            const { escrowId } = req.params;
            const { content, attachments } = req.body;

            const user = (req as ProtectedRequest).user || (req as ProtectedRequest).admin;

            const message = await ChatService.sendMessage({
                escrowId,
                senderId: user!._id.toString(),
                content,
                // Clients upload via POST /chat/:id/upload first, then send the
                // returned { url, type, name, size } objects here.
                attachments: Array.isArray(attachments) ? attachments : []
            });

            res.status(200).json({
                status: 'success',
                data: message
            });
        } catch (error: any) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    }

    static async upload(req: Request, res: Response) {
        try {
            if (!req.file) {
                return res.status(400).json({ status: 'error', message: 'No file uploaded' });
            }

            // Dynamically import UploadService to avoid circular dependencies if any, or just standard import
            const { UploadService } = await import('../../shared/upload.service');

            const url = await UploadService.uploadFile(req.file.path, 'prime-finance/chat');

            res.status(200).json({
                status: 'success',
                data: {
                    url: url,
                    type: req.file.mimetype,
                    name: req.file.originalname,
                    size: req.file.size
                }
            });
        } catch (error: any) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    }
}
