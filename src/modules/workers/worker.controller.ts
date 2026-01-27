import { Request, Response } from 'express';
import { WorkerControlService } from './worker-control.service';

export class WorkerController {

    static async listWorkers(req: Request, res: Response) {
        try {
            const statuses = await WorkerControlService.getStatuses();
            res.status(200).json({
                status: 'success',
                message: "Worker statuses retrieved",
                data: statuses
            });
        } catch (error: any) {
            res.status(500).json({
                status: 'error',
                message: error.message
            });
        }
    }

    static async startWorker(req: Request, res: Response) {
        const { name } = req.params;
        try {
            await WorkerControlService.start(name);
            res.status(200).json({
                status: 'success',
                message: `Worker ${name} started`
            });
        } catch (error: any) {
            res.status(400).json({
                status: 'error',
                message: `Failed to start worker: ${error.message}`
            });
        }
    }

    static async stopWorker(req: Request, res: Response) {
        const { name } = req.params;
        try {
            await WorkerControlService.stop(name);
            res.status(200).json({
                status: 'success',
                message: `Worker ${name} stopped`
            });
        } catch (error: any) {
            res.status(400).json({
                status: 'error',
                message: `Failed to stop worker: ${error.message}`
            });
        }
    }

    static async restartWorker(req: Request, res: Response) {
        const { name } = req.params;
        try {
            await WorkerControlService.restart(name);
            res.status(200).json({
                status: 'success',
                message: `Worker ${name} restarted`
            });
        } catch (error: any) {
            res.status(400).json({
                status: 'error',
                message: `Failed to restart worker: ${error.message}`
            });
        }
    }
}
