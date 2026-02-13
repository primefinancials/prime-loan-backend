import cloudinary from '../config/cloudinary';
import fs from 'fs';

export class UploadService {
    /**
     * Upload a file to Cloudinary
     * @param filePath Local path to the file
     * @param folder Cloudinary folder name
     * @returns Promise<string> Secure URL of the uploaded file
     */
    static async uploadFile(filePath: string, folder: string = 'prime-finance/chat'): Promise<string> {
        try {
            const result = await cloudinary.uploader.upload(filePath, {
                folder: folder,
                resource_type: "auto" // Auto-detect image/video/raw
            });

            // Remove file from local filesystem after upload
            fs.unlink(filePath, (err) => {
                if (err) console.error("Failed to delete local file:", err);
            });

            return result.secure_url;
        } catch (error) {
            // Ensure local file is deleted even on error
            fs.unlink(filePath, (err) => { if (err) console.error("Failed to delete local file:", err); });
            throw error;
        }
    }
}
