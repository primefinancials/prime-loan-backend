/**
 * Admin Transfer Controller - Facilitates actual money transfers from admin panel
 * - Company transfers (Prime Account)
 * - User transfers (Admin-initiated from user account)
 */
import { Request, Response, NextFunction } from "express";
import { TransferService } from "../transfers/transfer.service";
import { VfdProvider } from "../../shared/providers/vfd.provider";
import User from "../users/user.model";
import { sha512 } from "js-sha512";
import { logger } from "../../shared/utils/logger";
import { ProtectedRequest } from "../../interfaces";
import { randomUUID } from "crypto";

export class AdminTransferController {
  private static vfdProvider = new VfdProvider();

  /**
   * POST /backoffice/transfers/company
   * Orchestrates transfer from Prime (Company) account to any destination
   */
  static async transferFromCompany(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { toAccount, bankCode, amount, remark, beneficiaryName } = req.body;
      if (!toAccount || !amount || !bankCode) {
        return res.status(400).json({ status: "failed", message: "toAccount, amount, and bankCode are required" });
      }

      const admin = req.admin;
      logger.info({ adminId: admin?._id, toAccount, amount }, "Admin initiated company transfer");

      // 1. Get Prime Account Info
      const primeAccount = await AdminTransferController.vfdProvider.getPrimeAccountInfo();
      if (!primeAccount.data) throw new Error("Could not retrieve Prime account info from VFD");

      const fromAccountData = primeAccount.data;
      const transferType = bankCode === "999999" ? "intra" : "inter";

      let ref = randomUUID();

      // 3. Execute VFD Transfer
      const transferReq = {
        fromAccount: fromAccountData.accountNo,
        uniqueSenderAccountId: "",
        fromClientId: fromAccountData.clientId,
        fromClient: fromAccountData.client,
        fromSavingsId: fromAccountData.accountId,
        toAccount,
        toBank: bankCode,
        signature: sha512.hex(`${fromAccountData.accountNo}${toAccount}`),
        amount: amount,
        remark: remark || "Company Transfer",
        transferType: transferType as "intra" | "inter",
        reference: ref
      };

      const vfdResponse = await AdminTransferController.vfdProvider.transfer(transferReq);

      if (vfdResponse.status === "00") {
        return res.status(200).json({ status: "success", data: { reference: ref, vfd: vfdResponse.data } });
      } else {
        return res.status(400).json({ status: "failed", message: vfdResponse.message || "VFD Transfer failed", data: vfdResponse });
      }

    } catch (error: any) {
      logger.error({ error: error.message }, "Company transfer failed");
      next(error);
    }
  }

  /**
   * POST /backoffice/transfers/user
   * Orchestrates transfer from a specific user's account (found by email)
   */
  static async transferFromUser(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { userEmail, toAccount, bankCode, amount, remark, beneficiaryName } = req.body;
      if (!userEmail || !toAccount || !amount || !bankCode) {
        return res.status(400).json({ status: "failed", message: "userEmail, toAccount, amount, and bankCode are required" });
      }

      const admin = req.admin;
      logger.info({ adminId: admin?._id, userEmail, toAccount, amount }, "Admin initiated user-delegated transfer");

      // 1. Find User
      const user = await User.findOne({ email: userEmail.toLowerCase() });
      if (!user) return res.status(404).json({ status: "failed", message: "User not found" });

      const fromAccountNo = user.user_metadata?.accountNo;
      if (!fromAccountNo) return res.status(400).json({ status: "failed", message: "User has no VFD account" });

      // 2. Get User Account Info from VFD
      const userInfo = await AdminTransferController.vfdProvider.getAccountInfo(fromAccountNo);
      if (!userInfo.data) throw new Error("Could not retrieve user account info from VFD");

      const fromAccountData = userInfo.data;
      const transferType = bankCode === "999999" ? "intra" : "inter";

      // 3. Initiate Transfer Record
      const initResult = await TransferService.initiateTransfer({
        fromAccount: fromAccountData.accountNo,
        toAccount,
        amount,
        bankCode,
        beneficiaryName: beneficiaryName || "Unknown",
        remark: remark || `Admin-initiated: ${user.email}`,
        transferType,
        walletBalance: fromAccountData.accountBalance,
        userId: String(user._id),
        skipBalanceCheck: true // Admin override
      }, "transfer");

      // 4. Execute VFD Transfer
      const transferReq = {
        fromAccount: fromAccountData.accountNo,
        uniqueSenderAccountId: fromAccountData.accountId,
        fromClientId: fromAccountData.clientId,
        fromClient: fromAccountData.client,
        fromSavingsId: fromAccountData.accountId,
        toAccount,
        toBank: bankCode,
        signature: sha512.hex(`${fromAccountData.accountNo}${toAccount}`),
        amount: amount,
        remark: remark || `Admin-initiated: ${user.email}`,
        transferType: transferType as "intra" | "inter",
        reference: initResult.reference,
      };

      const vfdResponse = await AdminTransferController.vfdProvider.transfer(transferReq);

      if (vfdResponse.status === "00") {
        return res.status(200).json({ status: "success", data: { reference: initResult.reference, vfd: vfdResponse.data } });
      } else {
        return res.status(400).json({ status: "failed", message: vfdResponse.message || "VFD Transfer failed", data: vfdResponse });
      }

    } catch (error: any) {
      logger.error({ error: error.message }, "User-delegated transfer failed");
      next(error);
    }
  }
}
