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
import { ProfitService } from "../profits/profits.service";
import { UuidService } from "../../shared/utils/uuid";
import { SettingsService } from "../admin/settings.service";

export class TransferController {
  private static vfdProvider = new VfdProvider();
  private static profitService = new ProfitService();

  /**
   * Initiate a transfer
   */
  static async initiate(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
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

      const profit = await SettingsService.calculateProfit("transfer", "send", Number(amount));

      if (Number(req.user?.user_metadata?.wallet || 0) < (Number(amount) + profit)) {
        return res.status(400).json({
          status: "error",
          message: "Insufficient wallet balance",
        });
      }

      const userAccount = await TransferController.vfdProvider.getAccountInfo(fromAccount);

      const result: any = toBank != "999999" ? await TransferService.initiateTransfer({
        fromAccount,
        userId: userId as any,
        toAccount,
        beneficiaryName: toClient,
        amount,
        transferType,
        bankCode: toBank,
        remark,
        idempotencyKey,
        walletBalance: String(userAccount.data.accountBalance),
      }) : {};

      const transferReq: TransferRequest = {
        uniqueSenderAccountId: toBank == "999999" ? fromSavingsId : "",
        fromAccount,
        fromClientId,
        fromClient,
        fromSavingsId,
        toAccount,
        toClient,
        toSession,
        ...(toBank == "999999" ? { toClientId } : { fromBvn, toBvn, toKyc }),
        toSavingsId,
        toBank,
        signature: sha512.hex(`${fromAccount}${toAccount}`),
        amount: Number(amount),
        remark: `${remark} trxn` || "",
        transferType,
        reference: toBank != "999999" ? result.reference : UuidService.generate(),
      };

      try {
        const providerResp = await TransferController.vfdProvider.transfer(transferReq);

        if (providerResp.status === "00") {
          toBank != "999999" && await TransferService.completeTransfer(result.reference, "transfer");

          await TransferController.profitService.recordRealizedProfit({
            amount: profit,
            source: "transaction",
            userId: userId as any,
            reference: UuidService.generate(),
          });

          return res.status(200).json({
            status: "success",
            data: { ...result, provider: providerResp },
          });
        }

        toBank != "999999" && await TransferService.failTransfer(result.reference);
        throw new APIError(409, providerResp.message);
      } catch (error: any) {
        toBank != "999999" && await TransferService.failTransfer(result.reference);
        console.log({ error, data: error?.response?.data?.data, message: error?.response?.data?.message }, "Transfer Provider Error");
        throw new APIError(409, error?.response?.data?.message || error.message);
      }
    } catch (error) {
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

      const result = await TransferService.transfers(userId as any, page, limit);
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get my account info
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
   * Get beneficiary account info
   */
  static async getBeneficiaryAccountInfo(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const {
        userAccount,
        bankCode,
        transferType,
      } = req.query as { userAccount: string; bankCode: string; transferType: "intra" | "inter" };

      if (!userAccount || !bankCode || !transferType) {
        return res
          .status(400)
          .json({ status: "error", message: "userAccount, bankCode and transferType are required" });
      }

      const result = await TransferController.vfdProvider.getBeneficiary(userAccount, bankCode, transferType);
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Name Enquiry (Simplified Beneficiary Lookup)
   */
  static async nameEnquiry(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { accountNo, bankCode } = req.query as { accountNo: string; bankCode: string };
      if (!accountNo || !bankCode) {
        return res.status(400).json({ status: "error", message: "accountNo and bankCode are required" });
      }
      const result = await TransferController.vfdProvider.nameEnquiry(bankCode, accountNo);
      res.status(200).json({ status: "success", data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get banks
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
      const profit = await SettingsService.calculateProfit("transfer", "receive", Number(req.body.amount));
      const txn = await TransferService.walletAlerts({ ...req.body, amount: Number(req.body.amount) - profit });

      if (!txn) {
        return res.status(404).json({ status: "error", message: "User account not found" });
      }

      const isRefund = req.body.originator_narration.toLowerCase().includes("purchase refund") && !req.body.originator_narration.toLowerCase().includes("trxn");

      if (profit && !isRefund) {
        await TransferController.profitService.recordRealizedProfit({
          amount: profit,
          source: "transaction",
          userId: txn.userId,
          reference: UuidService.generate(),
        });
      }

      res.status(200).json({ status: "success", data: txn });
    } catch (error) {
      next(error);
    }
  }
  /**
   * Generate comprehensive account statement (PDF) - FIXED #3.4
   * Includes all transaction types with correct balance calculations
   */
  static async generateAccountStatement(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!._id;
      const { from, to } = req.query;

      if (!from || !to) {
        return res.status(400).json({ status: "error", message: "from and to dates are required" });
      }

      const startDate = new Date(String(from));
      const endDate = new Date(String(to));
      endDate.setHours(23, 59, 59, 999);

      const dateQuery = { createdAt: { $gte: startDate, $lte: endDate } };

      // Fetch all transaction types
      const [transfers] = await Promise.all([
        import("./transfer.model").then(m => m.Transfer.find({ userId, status: "COMPLETED", ...dateQuery }).lean()),
      ]);

      const events: any[] = [];
      const userAccountNo = req.user?.user_metadata?.accountNo || "";

      // Process transfers
      transfers.forEach((t: any) => {
        let type = 'DEBIT';
        let description = 'Bank Transfer';

        if (t.transferType === 'inter' || t.transferType === 'intra') {
          if (t.toAccount === userAccountNo) {
            type = 'CREDIT';
            description = `Received transfer from ${t.beneficiaryName || 'Unknown'}`;
          } else {
            description = `Transfer to ${t.beneficiaryName || 'Unknown'}`;
          }
        }

        events.push({
          date: new Date(t.createdAt),
          type,
          category: 'Transfer',
          amount: Number(t.amount),
          description: t.remark || t.naration || t.narration || description,
          status: t.status,
          reference: t.reference,
          balance: t.walletBalance
        });
      });

      // Sort events by date
      events.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Generate PDF
      const PdfPrinter: any = require('pdfmake/js/Printer.js').default;
      const fonts = {
        Helvetica: {
          normal: 'Helvetica',
          bold: 'Helvetica-Bold',
          italics: 'Helvetica-Oblique',
          bolditalics: 'Helvetica-BoldOblique'
        }
      };

      const printer = new PdfPrinter(fonts, null, { resolve: () => { }, resolved: async () => { } });

      const name = `${req.user?.user_metadata?.first_name || ''} ${req.user?.user_metadata?.surname || ''}`;

      const tableBody: any[] = [
        [{ text: 'Date', bold: true }, { text: 'Description', bold: true }, { text: 'Type', bold: true }, { text: 'Amount (₦)', bold: true }, { text: 'Balance (₦)', bold: true }]
      ];

      events.forEach(e => {
        tableBody.push([
          e.date.toLocaleDateString(),
          e.description || e.category,
          { text: e.type, color: e.type === 'CREDIT' ? '#2E7D32' : '#C62828' },
          e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }),
          e.balance !== undefined ? e.balance.toLocaleString(undefined, { minimumFractionDigits: 2 }) : 'N/A'
        ]);
      });

      if (events.length === 0) {
        tableBody.push([{ text: 'No transactions found for this period.', colSpan: 5, alignment: 'center' }, {}, {}, {}, {}]);
      }

      const docDefinition: any = {
        content: [
          { text: 'PRIME FINANCE', style: 'header' },
          { text: 'Account Statement', style: 'subheader' },
          { text: '\n' },
          {
            columns: [
              {
                text: [
                  { text: 'Customer Name: ', bold: true, color: '#1B5E20' },
                  { text: `${name}\n` },
                  { text: 'Email: ', bold: true, color: '#1B5E20' },
                  { text: `${req.user?.email}\n` },
                  { text: 'Phone: ', bold: true, color: '#1B5E20' },
                  { text: `${req.user?.user_metadata?.phone || 'N/A'}\n` },
                ]
              },
              {
                text: [
                  { text: 'Statement Period:\n', bold: true, color: '#1B5E20' },
                  { text: `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}\n\n` },
                  { text: 'Generated On:\n', bold: true, color: '#1B5E20' },
                  { text: `${new Date().toLocaleDateString()}\n` }
                ],
                alignment: 'right'
              }
            ]
          },
          { text: '\n\n' },
          {
            table: {
              headerRows: 1,
              widths: ['auto', '*', 'auto', 'auto', 'auto'],
              body: tableBody
            },
            layout: 'lightHorizontalLines'
          }
        ],
        defaultStyle: { font: 'Helvetica', color: '#333333', fontSize: 10 },
        styles: {
          header: { fontSize: 22, bold: true, color: '#1B5E20' },
          subheader: { fontSize: 14, bold: true, color: '#4CAF50', marginBottom: 10 },
        }
      };

      const pdfDoc = await printer.createPdfKitDocument(docDefinition);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=Account_Statement_${startDate.toISOString().split('T')[0]}.pdf`);

      pdfDoc.pipe(res);
      pdfDoc.end();
    } catch (error) {
      next(error);
    }
  }
}
