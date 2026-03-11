/**
 * Bill Payment Orchestrator (Flutterwave-backed)
 *
 * - Uses Flutterwave Bill Payment endpoints to initiate purchases.
 * - Uses TransferService + VfdProvider for ledger/transfer prefunding.
 * - Orchestrates via processTransaction(...) so the general flow is:
 *     1) Create PENDING transfer (ledger)
 *     2) Send transfer to VFD
 *     3) Call provider (Flutterwave) to perform the bill purchase
 *     4) Let processTransaction handle finalization and error flows
 *
 * NOTES:
 *  - Expect these params:
 *      req.serviceId -> Flutterwave biller_code (e.g. BIL108)
 *      req.extras.itemCode | productCode | pkg -> Flutterwave item/product code (e.g. MD142)
 *      req.customerReference -> account/meter/smartcard/phone (string/number)
 *      req.idempotencyKey -> external idempotency (tx_ref)
 *  - Make sure FLUTTERWAVE_SECRET_KEY is available via process.env or your config.
 */

import axios from "axios";
import { sha512 } from "js-sha512";
import { TransferService } from "../transfers/transfer.service";
import { VfdProvider, TransferRequest } from "../../shared/providers/vfd.provider";
import { processTransaction } from "../../shared/transactions/BillPaymentTransactionProcessor";
import User from "../users/user.model";
import { BillPayment } from "./bill-payment.model";
import { InitiateBillPaymentRequest, ServiceType } from "./bill-payment.interface";

type FlutterwaveResponse<T = any> = {
  status: string; // "success" | "error"
  message?: string;
  data?: T;
};

function requireExtra<T>(
  value: T | undefined,
  name: string,
  service: ServiceType
): T {
  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  ) {
    throw new Error(`Missing required '${name}' for serviceType='${service}'`);
  }
  return value;
}

function fwHeaders() {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing FLUTTERWAVE_SECRET_KEY in environment");
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function flutterwaveGet<T = any>(path: string, params?: Record<string, any>) {
  const url = `https://api.flutterwave.com${path}`;
  const res = await axios.get<FlutterwaveResponse<T>>(url, {
    headers: fwHeaders(),
    params,
  });
  return res.data;
}

async function flutterwavePost<T = any>(path: string, body: any = {}) {
  const url = `https://api.flutterwave.com${path}`;
  const res = await axios.post<FlutterwaveResponse<T>>(url, body, {
    headers: fwHeaders(),
  });
  return res.data;
}

import NodeCache from "node-cache";

const billCache = new NodeCache({ stdTTL: 24 * 60 * 60 }); // 24 hours TTL

export default class BillPaymentService {
  /**
   * Fetch high-level categories (Airtime, Mobile Data Service, Power, TV, Internet etc.)
   * GET /v3/top-bill-categories?country=NG
   * Cached for 24h
   */
  static async getSupportedCategories(country = "NG") {
    const cacheKey = `categories_${country}`;
    const cached = billCache.get(cacheKey);
    if (cached) return cached;

    const resp = await flutterwaveGet("/v3/top-bill-categories", { country });
    billCache.set(cacheKey, resp.data);
    return resp.data;
  }

  /**
   * Get billers for a category
   * GET /v3/bills/{category}/billers
   * - category is usually the category code you got from top-bill-categories
   * Cached for 24h
   */
  static async getBillersByCategory(categoryCode: string, country = "NG") {
    const cacheKey = `billers_${categoryCode}_${country}`;
    const cached = billCache.get(cacheKey);
    if (cached) return cached;

    const resp = await flutterwaveGet(`/v3/bills/${encodeURIComponent(categoryCode)}/billers`, { country });
    billCache.set(cacheKey, resp.data);
    return resp.data;
  }

  /**
   * Get items/products for a biller (packages, plans etc.)
   * GET /v3/billers/{biller_code}/items
   * Cached for 24h
   */
  static async getBillItems(billerCode: string) {
    const cacheKey = `items_${billerCode}`;
    const cached = billCache.get(cacheKey);
    if (cached) return cached;

    const resp = await flutterwaveGet(`/v3/billers/${encodeURIComponent(billerCode)}/items`);
    billCache.set(cacheKey, resp.data);
    return resp.data;
  }

  /**
   * Validate a customer (meter no, smartcard no, etc.)
   * GET /v3/bill-items/{item_code}/validate?customer={customer}
   */
  static async validateServiceAccount(itemCode: string, customerReference: string | number) {
    const resp = await flutterwaveGet(`/v3/bill-items/${encodeURIComponent(itemCode)}/validate`, {
      customer: customerReference,
    });
    return resp.data;
  }

  /**
   * Initiate a bill payment using Flutterwave's bill payment endpoints
   *
   * IMPORTANT:
   *  - serviceId should map to a biller_code (e.g. BIL108)
   *  - extras.itemCode or extras.productCode or extras.pkg should contain the item/product code for many billers
   */
  static async initiateBillPayment(req: InitiateBillPaymentRequest) {
    // load user + prefunding accounts
    const vfdProvider = new VfdProvider();

    const userId = req.userId;
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    const from = (await vfdProvider.getAccountInfo(user ? user.user_metadata?.accountNo : "trx-user")).data;
    const to = (await vfdProvider.getPrimeAccountInfo()).data;

    // friendly helpers for Flutterwave bill requests
    const billerCode = req.serviceId; // expected biller_code like BIL108
    const itemCode = req.itemCode;

    // idempotency tx reference used with Flutterwave (and also used for ledger)
    const idempotencyKey = req.idempotencyKey || cryptoRandom();

    return await processTransaction({
      userId: req.userId,
      amount: req.amount,
      serviceType: req.serviceType,
      serviceId: req.serviceId,
      customerReference: req.customerReference,
      idempotencyKey,
      providerFn: async () => {
        // Build path + payload for Flutterwave create-payment
        // Flutterwave requires different payload keys for some billers.
        // We'll assemble a general payload, and pass extras into an "extra" property
        // so Flutterwave gets all custom keys it expects.
        if (!billerCode || typeof billerCode !== "string") {
          throw new Error("serviceId (biller_code) is required and must be a string");
        }

        switch (req.serviceType) {
          case "airtime": {
            // For airtime, Flutterwave expects you to call the biller-item payment.
            // Require itemCode (many deployments use item codes for networks / denominations)
            const item = requireExtra(itemCode, "extras.itemCode (airtime item/product code)", "airtime");
            const payload: any = {
              amount: String(req.amount),
              customer_id: String(req.customerReference),
              reference: idempotencyKey,
              currency: "NGN",
              phone: String(req.customerReference),
              country: "NG"
            };
            // POST /v3/billers/{biller_code}/items/{item_code}/payment
            const resp = await flutterwavePost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(item)}/payment`, payload);
            return resp;
          }

          case "data": {
            // Data bundles require item codes and often a `type` value (see Flutterwave docs)
            const item = requireExtra(itemCode, "extras.itemCode (data item/product code)", "data");
            const payload: any = {
              amount: String(req.amount),
              customer_id: String(req.customerReference),
              reference: idempotencyKey,
              currency: "NGN",
              phone: String(req.customerReference),
              // include any data-specific type flag if present in extras (biller specific)
              type: req.serviceType,
              country: "NG"
            };
            const resp = await flutterwavePost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(item)}/payment`, payload);
            return resp;
          }

          case "tv": {
            // TV: serviceId -> biller_code (e.g. DSTV biller). extras.pkg or productCode -> package code item
            const pkg = requireExtra(itemCode, "extras.pkg / extras.itemCode (TV package code)", "tv");
            const payload: any = {
              amount: String(req.amount),
              customer_id: String(req.customerReference), // smartcard number
              reference: idempotencyKey,
              currency: "NGN",
              country: "NG",
              phone: String(req.customerReference)
            };

            const resp = await flutterwavePost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(pkg)}/payment`, payload);
            return resp;
          }

          case "power": {
            // Electricity: serviceId = biller_code (electric company)
            // extras.meterType required (01 prepaid | 02 postpaid), itemCode often required
            // const meterType = requireExtra(req.meterType, "extras.meterType (01 | 02)", "power");
            const item = itemCode; // item may be optional for some providers, but usually present
            const payload: any = {
              amount: String(req.amount),
              customer_id: String(req.customerReference), // meter number
              reference: idempotencyKey,
              currency: "NGN",
              meter_type: String(req.meterType),
              phone: String(req.customerReference),
              country: "NG"
            };

            if (!item) {
              // call product orders endpoint if product code isn't available in itemCode
              const resp = await flutterwavePost(`/v3/billers/${encodeURIComponent(billerCode)}/items/payment`, payload);
              return resp;
            }

            const resp = await flutterwavePost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(item)}/payment`, payload);
            return resp;
          }

          case "betting": {
            // Betting: serviceId is the betting provider/biller code; use item/product as required
            const item = itemCode || undefined;
            const payload: any = {
              amount: String(req.amount),
              customer_id: String(req.customerReference), // customer id on betting platform
              reference: idempotencyKey,
              currency: "NGN",
              country: "NG"
            };

            // If item specified, call item payment route; otherwise try product order
            if (item) {
              const resp = await flutterwavePost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(item)}/payment`, payload);
              return resp;
            } else {
              const resp = await flutterwavePost(`/v3/billers/${encodeURIComponent(billerCode)}/items/payment`, payload);
              return resp;
            }
          }

          case "internet": {
            // Internet: extras.internetNetwork expected (e.g. 'smile-direct' | 'spectranet'), itemCode is plan id
            const item = requireExtra(itemCode, "extras.itemCode (internet plan code)", "internet");
            const payload: any = {
              amount: String(req.amount),
              customer_id: String(req.customerReference),
              reference: idempotencyKey,
              currency: "NGN"
            };
            const resp = await flutterwavePost(`/v3/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(item)}/payment`, payload);
            return resp;
          }

          default:
            throw new Error(`Unsupported serviceType: ${String(req.serviceType)}`);
        }
      },
      txnProvider: async () => {
        // 1) Create transfer record + ledger entry (PENDING)
        const result = await TransferService.initiateTransfer({
          fromAccount: from.accountNo,
          userId,
          toAccount: to.accountNo,
          beneficiaryName: to.client,
          amount: req.amount,
          transferType: "intra",
          bankCode: "999999",
          remark: `${req.serviceType} purchase`,
          walletBalance: String(from.accountBalance),
          idempotencyKey
        }, "bill-payment"); // Fix: pass "bill-payment" type

        // 2) Send transfer to VFD (the banking provider)
        const transferReq: TransferRequest = {
          uniqueSenderAccountId: from.accountId,
          fromAccount: from.accountNo,
          fromClientId: from.clientId,
          fromClient: from.client,
          fromSavingsId: from.accountId,
          toAccount: to.accountNo,
          toClient: to.client,
          toSession: to.accountId,
          toClientId: to.clientId,
          toSavingsId: to.accountId,
          toBank: "999999",
          signature: sha512.hex(`${from.accountNo}${to.accountNo}`),
          amount: req.amount,
          remark: `${req.serviceType} purchase`,
          transferType: "intra",
          reference: result.reference,
        };

        const vfdResult = await vfdProvider.transfer(transferReq);
        return { ...vfdResult, reference: result.reference };
      },
      refundProvider: async () => {
        // 1) Create transfer record + ledger entry (PENDING)
        const result = await TransferService.initiateTransfer({
          fromAccount: to.accountNo,
          userId,
          toAccount: from.accountNo,
          beneficiaryName: from.client,
          amount: req.amount,
          transferType: "intra",
          bankCode: "999999",
          remark: `${req.serviceType} purchase refund`,
          walletBalance: String(to.accountBalance),
          idempotencyKey
        }, "bill-payment"); // Fix: pass "bill-payment" type

        // 2) Send transfer to VFD (the banking provider)
        const transferReq: TransferRequest = {
          uniqueSenderAccountId: "",
          fromAccount: to.accountNo,
          fromClientId: to.clientId,
          fromClient: to.client,
          fromSavingsId: to.accountId,
          toAccount: from.accountNo,
          toClient: from.client,
          toSession: from.accountId,
          toClientId: from.clientId,
          toSavingsId: from.accountId,
          toBank: "999999",
          signature: sha512.hex(`${to.accountNo}${from.accountNo}`),
          amount: req.amount,
          remark: `${req.serviceType} purchase refund`,
          transferType: "intra",
          reference: result.reference,
        };

        const vfdResult = await vfdProvider.transfer(transferReq);
        return { ...vfdResult, reference: result.reference };
      }
    });
  }

  /**
   * Check if a biller (billerCode) has downtime within stored Bill entries
   */
  static async checkServiceDowntime(billerCode: string): Promise<boolean> {
    const bill = await BillPayment.findOne({ billerCode }).lean();
    if (!bill) return false;

    return true;
    // return !!(bill.hasDowntime && bill.downtimeStart && bill.downtimeEnd &&
    //   new Date() >= bill.downtimeStart && new Date() <= bill.downtimeEnd);
  }

  /**
   * Retrieve bill payments for a user (pagination + optional filters)
   */
  static async getUserBillPayments(userId: string, page = 1, limit = 20, status?: string, type?: string, search?: string) {
    const skip = (page - 1) * limit;
    const query: any = { userId };
    if (status) query.status = status;
    if (type) query.serviceType = type;
    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [
        { traceId: regex },
        { providerRef: regex },
        { customerReference: regex },
      ];
    }

    const billPayments = await BillPayment.find(query)
      .populate('userId', 'email user_metadata.first_name user_metadata.surname')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    const total = await BillPayment.countDocuments(query);
    return {
      billPayments,
      page,
      pages: Math.ceil(total / limit),
      total,
    };
  }

  /**
   * Retrieve all bill payments (admin)
   */
  static async getBillPayments(page = 1, limit = 20, status?: string, type?: string, search?: string) {
    const skip = (page - 1) * limit;
    const query: any = {};
    if (status) query.status = status;
    if (type) query.serviceType = type;
    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [
        { traceId: regex },
        { providerRef: regex },
        { customerReference: regex },
      ];
    }

    const billPayments = await BillPayment.find(query)
      .populate('userId', 'email user_metadata.first_name user_metadata.surname')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    const total = await BillPayment.countDocuments(query);
    return {
      billPayments,
      page,
      pages: Math.ceil(total / limit),
      total,
    };
  }
}

/* Helper: secure-ish uuid fallback for idempotency when not provided */
function cryptoRandom() {
  // Node: crypto available, fallback to random UUID-ish
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomUUID } = require("crypto");
    return randomUUID();
  } catch (e) {
    return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}
