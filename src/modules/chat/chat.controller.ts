import { Request, Response } from 'express';
import { ProtectedRequest } from '../../interfaces';
import { ChatService } from './chat.service';

export class ChatController {

    static async getHistory(req: Request, res: Response) {
        try {
            const { escrowId } = req.params;
            const messages = await ChatService.getHistory(escrowId, (req as ProtectedRequest).user!._id.toString());
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
            const { content } = req.body;
            // Attachments handling (Multer middleware should populate req.files)

            const message = await ChatService.sendMessage({
                escrowId,
                senderId: (req as ProtectedRequest).user!._id.toString(),
                content,
                attachments: [] // TODO: Process files from req.files
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
        // TODO: Implement actual S3/Local upload
        // const file = req.file;
        // const url = await S3Service.upload(file);

        // Mock response
        res.status(200).json({
            status: 'success',
            data: {
                url: "https://via.placeholder.com/150",
                type: "image/png"
            }
        });
    }
}
