import { UserService } from "../users/user.service";
import Profit, { Profit as ProfitDoc } from "./profits.model";
import { VfdProvider } from "../../shared/providers/vfd.provider";
import { NotFoundError, APIError } from "../../exceptions";
import { TransferRequest } from "../../shared/providers/vfd.provider";
import { sha512 } from "js-sha512";

export class ProfitService {
  private static vfd = new VfdProvider();

  /**
   * Record a new realized profit
   */
  async recordRealizedProfit(params: {
    reference: string;
    userId: string;
    source: "transaction" | "savings" | "loan" | "bill-payment" | "escrow";
    amount: number;
    percentage?: number;
    description?: string;
  }): Promise<ProfitDoc> {
    const user = await UserService.getUser(params.userId);
    if (!user || Array.isArray(user) || !user._id) throw new NotFoundError("User not found");

    const primeInfo = (await ProfitService.vfd.getPrimeAccountInfo()).data;
    const userAcc = (await ProfitService.vfd.getAccountInfo(user.user_metadata.accountNo)).data;

    if (!primeInfo?.accountNo || !userAcc?.accountNo) {
      throw new Error("Could not fetch account info to perform repayment");
    }

    const transferRequest: TransferRequest = {
      fromAccount: userAcc.accountNo,
      uniqueSenderAccountId: userAcc.accountId,
      fromClientId: userAcc.clientId,
      fromClient: userAcc.client,
      fromSavingsId: userAcc.accountId,
      toClientId: primeInfo.clientId,
      toClient: primeInfo.client,
      toSavingsId: primeInfo.accountId,
      toSession: primeInfo.accountId,
      toAccount: primeInfo.accountNo,
      toBank: "999999",
      amount: String(params.amount),
      signature: sha512.hex(`${userAcc.accountNo}${primeInfo.accountNo}`),
      remark: `${params.source} Profit`,
      transferType: "intra",
      reference: params.reference
    } as any;

    let providerResponse: any;
    try {
      providerResponse = await ProfitService.vfd.transfer(transferRequest);
    } catch (err: any) {
      console.log((`Failed to send profit: ${String(err.response.data.message || err.message)}`));
      throw new Error(`Failed to send profit: ${String(err)}`);
    }

    const ok = providerResponse && providerResponse.status === "00";
    if (!ok) {
      throw new APIError(providerResponse.message);
    }

    const profit = new Profit({
      ...params,
      type: "realized",
      isRealized: true
    });

    return await profit.save();
  }

  /**
   * Record a new unrealized or realized profit
   */
  async recordProfit(params: {
    reference: string;
    userId: string;
    source: "transaction" | "savings" | "loan" | "bill-payment" | "escrow";
    amount: number;
    percentage?: number;
    type: "realized" | "unrealized";
    description?: string;
  }): Promise<ProfitDoc> {
    const user = await UserService.getUser(params.userId);
    if (!user || Array.isArray(user) || !user._id) throw new NotFoundError("User not found");

    const profit = new Profit({
      ...params,
      isRealized: params.type === "realized"
    });
    return await profit.save();
  }

  /**
   * Convert unrealized profit to realized
   */
  async markAsRealized(reference: string): Promise<ProfitDoc | null> {
    const profit = await Profit.findOne({ reference });
    if (!profit) return null;

    if (profit.isRealized) return profit;

    profit.isRealized = true;
    profit.type = "realized";
    profit.realizedAt = new Date();

    await profit.save();
    return profit;
  }

  /**
   * Fetch a profit by reference
   */
  async getProfitByReference(reference: string) {
    return await Profit.findOne({ reference });
  }

  /**
   * Fetch profits by type (paginated)
   */
  async getProfitByType(
    type: "realized" | "unrealized",
    page = 1,
    limit = 10
  ) {
    const skip = (page - 1) * limit;
    const query = { type };
    const [data, total] = await Promise.all([
      Profit.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Profit.countDocuments(query),
    ]);
    return {
      status: "success",
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Fetch all profits for a user (paginated)
   */
  async getUserProfits(
    userId: string,
    type?: "realized" | "unrealized",
    page = 1,
    limit = 10
  ) {
    const skip = (page - 1) * limit;
    const query: any = { userId };
    if (type) query.type = type;

    const [data, total] = await Promise.all([
      Profit.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Profit.countDocuments(query),
    ]);

    return {
      status: "success",
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get total profits (optionally filtered)
   */
  async getTotalProfits(filter?: {
    source?: string;
    userId?: string;
    type?: "realized" | "unrealized";
  }) {
    const query: any = {};
    if (filter?.source) query.source = filter.source;
    if (filter?.userId) query.userId = filter.userId;
    if (filter?.type) query.type = filter.type;

    const result = await Profit.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    return {
      status: "success",
      total: result[0]?.total || 0,
    };
  }

  /**
   * Delete a profit
   */
  async deleteProfit(reference: string) {
    const result = await Profit.deleteOne({ reference });
    return {
      status: result.deletedCount ? "success" : "failure",
    };
  }
}

export const profitService = new ProfitService();
