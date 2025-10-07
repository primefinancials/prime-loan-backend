/**
 * Transfer Controller - V2 transfer endpoints
 * Handles transfer initiation with ledger + VFD integration
 */
import { Response, NextFunction } from "express";
import { ProtectedRequest } from "../../interfaces";
import { TransferService } from "./transfer.service";
import { VfdProvider, TransferRequest } from "../../shared/providers/vfd.provider";
import { sha512 } from "js-sha512";
import { APIError } from "../../exceptions";

export class TransferController {
  private static vfdProvider = new VfdProvider();

  /**
   * Initiate a transfer
   */
  static async initiate(req: ProtectedRequest, res: Response, next: NextFunction) {
    const { 
      fromAccount, 
      fromClientId, 
      fromClient, 
      fromSavingsId,
      fromBvn,
      toClient,
      toClientId,
      toSession,
      toAccount,
      toSavingsId,
      toBvn,
      toBank,
      toKyc,
      amount, 
      transferType,
      remark, 
    } = req.body;
    const userId = req.user!._id;
    const idempotencyKey = req.idempotencyKey!;

    if (Number(req.user?.user_metadata?.wallet || 0) < amount) throw new APIError(409, "Insufficient wallet balance");

    const result = await TransferService.initiateTransfer({
      fromAccount,
      userId,
      toAccount,
      amount,
      transferType,
      bankCode: toBank,
      remark,
      idempotencyKey,
    });

    try {
      const transferReq: TransferRequest = {
        uniqueSenderAccountId: toBank == '999999'? fromSavingsId : "",
        fromAccount,
        fromClientId,
        fromClient,
        fromSavingsId,
        toAccount,
        toClient,
        toSession,
        ...(toBank == '999999'? { toClientId } : { fromBvn, toBvn, toKyc }),
        toSavingsId,
        toBank,
        signature: sha512.hex(`${fromAccount}${toAccount}`),
        amount: amount,
        remark: remark || "",
        transferType,
        reference: result.reference,
      };

      const providerResp = await TransferController.vfdProvider.transfer(transferReq);

      if(providerResp.status === "00") {
        await TransferService.completeTransfer(result.reference);
        return res.status(200).json({
          status: "success",
          data: { ...result, provider: providerResp },
        });
      }

      await TransferService.failTransfer(result.reference);
      throw new APIError(409, providerResp.message);
    } catch (error) {
      await TransferService.failTransfer(result.reference);
      next(error);
    }
  }

  /**
   * Get transfer status (via provider query)
   */
  static async getStatus(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { reference, sessionId } = req.query as { reference?: string; sessionId?: string };

      if (!reference && !sessionId) {
        return res.status(400).json({
          status: "error",
          message: "reference or sessionId is required",
        });
      }

      const statusResp = await TransferController.vfdProvider.queryTransaction(reference, sessionId);

      res.status(200).json({ status: "success", data: statusResp });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get transfer by transactionId
   */
  static async getTransfer(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const transfer = await TransferService.transfer(id);
      if (!transfer) {
        return res.status(404).json({ status: "error", message: "Transfer not found" });
      }
      res.status(200).json({ status: "success", data: transfer });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get paginated transfers for authenticated user
   */
  static async getTransfers(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id;
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;

      const result = await TransferService.transfers(userId, page, limit);
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get paginated transfers for authenticated user
   */
  static async getMyAccountInfo(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const userAccount = req.user!.user_metadata.accountNo;

      const result = await TransferController.vfdProvider.getAccountInfo(userAccount);
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get paginated transfers for authenticated user
   */
  static async getBeneficiaryAccountInfo(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const {
        userAccount,
        bankCode,
        transferType
      } = req.query as { userAccount: string; bankCode: string; transferType: 'intra' | 'inter' };

      if(!userAccount || !bankCode || !transferType) {
        return res.status(400).json({ status: "error", message: "userAccount, bankCode and transferType are required" });
      }

      const result = await TransferController.vfdProvider.getBeneficiary(userAccount, bankCode, transferType);
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }
  
  /**
   * Get paginated transfers for authenticated user
   */
  static async getBanks(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const result = await TransferController.vfdProvider.getBanks();

      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle incoming wallet credit alerts (webhook from VFD)
   */
  static async walletAlert(req: any, res: Response, next: NextFunction) {
    try {
      const txn = await TransferService.walletAlerts(req.body);
      if (!txn) {
        return res.status(404).json({ status: "error", message: "User account not found" });
      }
      res.status(200).json({ status: "success", data: txn });
    } catch (error) {
      next(error);
    }
  }
}
