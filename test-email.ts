import { NotificationService } from './src/modules/notifications/notification.service';
import { VfdProvider } from './src/shared/providers/vfd.provider';

async function run() {
    console.log("Testing NotificationService...");
    try {
        await (NotificationService as any).sendEmail("test@example.com", "Test", "Test body");
        console.log("Email sent successfully!");
    } catch (err: any) {
        console.error("Email Error:", err.message);
    }
}

run().catch(console.error);
