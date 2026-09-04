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
      const { from, to } = req.query;

      if (!from || !to) {
        return res.status(400).json({ status: "error", message: "from and to dates are required" });
      }

      const startDate = new Date(String(from));
      const endDate = new Date(String(to));
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ status: "error", message: "Invalid from/to date" });
      }
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      const userAccountNo = req.user?.user_metadata?.accountNo || "";
      if (!userAccountNo) {
        return res.status(400).json({ status: "error", message: "No wallet account found for this user" });
      }

      // 1. Anchor to the user's CURRENT wallet balance. Use the live VFD balance
      //    and fall back to the last-synced value. Every figure below is derived
      //    from this anchor, so opening/closing are real numbers, not the
      //    unreliable per-row snapshot the old statement printed.
      let currentBalance = Number(req.user?.user_metadata?.wallet || 0);
      try {
        const live = await TransferController.vfdProvider.getAccountInfo(userAccountNo);
        const liveBal = Number(live?.data?.accountBalance);
        if (!isNaN(liveBal)) currentBalance = liveBal;
      } catch (e) {
        // keep the synced fallback
      }

      // 2. transfers_v2 is the unified wallet cash-flow log: P2P transfers,
      //    bill payments, savings, loan disbursement/repayment, escrow and
      //    influencer payouts all write a record here. Filter by ACCOUNT
      //    NUMBER, not userId - an incoming intra-bank transfer stores the
      //    SENDER's userId, so the old { userId } filter dropped money received.
      //    Pull from the period start with NO upper bound so post-period rows
      //    can be used to roll the balance back to the period close.
      const { Transfer } = await import("./transfer.model");
      const rows: any[] = await Transfer.find({
        status: "COMPLETED",
        $or: [{ fromAccount: userAccountNo }, { toAccount: userAccountNo }],
        createdAt: { $gte: startDate },
      })
        .sort({ createdAt: 1 })
        .limit(10000)
        .lean();

      const signed = (t: any): number => {
        const credit = t.toAccount === userAccountNo;
        const debit = t.fromAccount === userAccountNo;
        if (credit && !debit) return Number(t.amount) || 0;
        if (debit && !credit) return -(Number(t.amount) || 0);
        return 0; // self-transfer / unknown - no net wallet effect
      };

      const inPeriod = rows.filter((t) => {
        const d = new Date(t.createdAt).getTime();
        return d >= startDate.getTime() && d <= endDate.getTime();
      });
      const afterPeriod = rows.filter((t) => new Date(t.createdAt).getTime() > endDate.getTime());

      // 3. Roll the live balance back to the end of the statement period.
      const closingBalance = currentBalance - afterPeriod.reduce((s, t) => s + signed(t), 0);

      // 4. Walk the in-period rows backwards for a running balance per line,
      //    landing on the opening balance.
      let running = closingBalance;
      for (let i = inPeriod.length - 1; i >= 0; i--) {
        inPeriod[i].__balanceAfter = running;
        running -= signed(inPeriod[i]);
      }
      const openingBalance = running;

      const events = inPeriod.map((t) => {
        const amt = signed(t);
        const isCredit = amt > 0;
        const counterparty = t.beneficiaryName || (isCredit ? t.fromAccount : t.toAccount) || "Unknown";
        return {
          date: new Date(t.createdAt),
          type: isCredit ? "CREDIT" : amt < 0 ? "DEBIT" : "INFO",
          amount: Math.abs(amt),
          description:
            t.remark ||
            t.naration ||
            (t as any).narration ||
            (isCredit ? `Received from ${counterparty}` : `Transfer to ${counterparty}`),
          reference: t.reference,
          balanceAfter: t.__balanceAfter as number,
        };
      });

      const totalCredit = events.filter((e) => e.type === "CREDIT").reduce((s, e) => s + e.amount, 0);
      const totalDebit = events.filter((e) => e.type === "DEBIT").reduce((s, e) => s + e.amount, 0);

      const fmt = (n: number) =>
        Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      // 5. Generate PDF
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

      const name = `${req.user?.user_metadata?.first_name || ''} ${req.user?.user_metadata?.surname || ''}`.trim();

      const tableBody: any[] = [
        [
          { text: 'Date', bold: true },
          { text: 'Description', bold: true },
          { text: 'Type', bold: true },
          { text: 'Amount (NGN)', bold: true, alignment: 'right' },
          { text: 'Balance (NGN)', bold: true, alignment: 'right' },
        ],
        [
          { text: startDate.toLocaleDateString(), color: '#555555' },
          { text: 'Opening Balance', italics: true },
          '',
          '',
          { text: fmt(openingBalance), alignment: 'right', bold: true },
        ],
      ];

      events.forEach(e => {
        tableBody.push([
          e.date.toLocaleDateString(),
          e.description,
          { text: e.type, color: e.type === 'CREDIT' ? '#2E7D32' : e.type === 'DEBIT' ? '#C62828' : '#555555' },
          { text: `${e.type === 'CREDIT' ? '+' : e.type === 'DEBIT' ? '-' : ''}${fmt(e.amount)}`, alignment: 'right' },
          { text: fmt(e.balanceAfter), alignment: 'right' }
        ]);
      });

      if (events.length === 0) {
        tableBody.push([{ text: 'No transactions for this period.', colSpan: 5, alignment: 'center', italics: true }, {}, {}, {}, {}]);
      }

      tableBody.push([
        { text: endDate.toLocaleDateString(), color: '#555555' },
        { text: 'Closing Balance', italics: true },
        '',
        '',
        { text: fmt(closingBalance), alignment: 'right', bold: true },
      ]);

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
                  { text: 'Account Number: ', bold: true, color: '#1B5E20' },
                  { text: `${userAccountNo}\n` },
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
          { text: '\n' },
          {
            columns: [
              { text: [{ text: 'Total Credits: ', bold: true, color: '#2E7D32' }, { text: `NGN ${fmt(totalCredit)}` }] },
              { text: [{ text: 'Total Debits: ', bold: true, color: '#C62828' }, { text: `NGN ${fmt(totalDebit)}` }] },
              { text: [{ text: 'Net Change: ', bold: true }, { text: `NGN ${fmt(totalCredit - totalDebit)}` }], alignment: 'right' },
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
          },
          { text: '\n\n' },
          { text: 'This statement is generated from your Prime Finance wallet activity and is reconciled to your current wallet balance. Contact support@primefinance.live for any discrepancies.', fontSize: 8, italics: true, color: '#777777' },
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
