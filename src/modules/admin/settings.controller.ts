import { Request, Response, NextFunction } from "express";
import { SettingsService } from "./settings.service";

export class SettingsController {
    /**
     * Get platform fees (profit configuration)
     * Public or Authenticated (depending on route binding)
     */
    static async getFees(req: Request, res: Response, next: NextFunction) {
        try {
            // We can return all profit configs or specific ones. 
            // For now, let's return all to be transparent.
            // Or typically users want to know "Fees for X".

            // Let's fetch settings directly
            const settings = await SettingsService.getSettings();

            res.status(200).json({
                status: "success",
                data: settings.profitRange || []
            });
        } catch (error) {
            next(error);
        }
    }
}
