import { Request, Response, NextFunction } from "express";
import { PaybillsService } from "../services/paybills.service";
import { UserService, TransactionService } from "../services";
import { validateRequiredParams } from "../utils/validateParams";
import { StatusDescriptions, ProtectedRequest, TransactionCategory, StatusCode, TransactionStatus } from "../interfaces";
import { message } from "./dataController";
import { generateRandomString } from "../utils/generateRef";
import {
    OAuthClient,
    InterswitchAuthClient
} from "../utils/interswitch.auth";

const oauthClient = new OAuthClient(
  'YOUR_CLIENT_ID',
  'YOUR_SECRET_KEY',
  'https://passport.k8.isw.la/passport/oauth/token',
  'https://api.interswitchng.com'
);

const paybillsService = new PaybillsService(oauthClient, '3PBL0001');
const { update, find } = new UserService();
const { create: createTransaction, find: findTransaction } = new TransactionService();

const bankTransfer = async ({
  userId,
  amount,
}: {
  userId: string;
  amount: string;
}) => {
  try {
    // 1. Find user
    const user = await find({ _id: userId }, "one");
    if (!user || Array.isArray(user)) throw new Error(`User not found`);

    // 2. Enquire user account
    const userAccountRes = await httpClient(
      `/wallet2/account/enquiry?accountNumber=${user?.user_metadata.accountNo}`,
      "GET"
    );
    if (!userAccountRes.data) throw new Error(`User account not found`);

    const userAccountData = userAccountRes.data.data;
    const userBalance = Number(userAccountData.accountBalance);

    // 3. Enquire prime account (admin)
    const adminAccountRes = await httpClient(`/wallet2/account/enquiry?`, "GET");
    if (!adminAccountRes.data) throw new Error("Prime account not found");

    const adminAccountData = adminAccountRes.data.data;

    // 4. Construct transfer payload
    const ref = `Prime-Finance-${generateRandomString(9)}`;
    const transferBody = {
      fromAccount: userAccountData.accountNo,
      uniqueSenderAccountId: userAccountData.accountId,
      fromClientId: userAccountData.clientId,
      fromClient: userAccountData.client,
      fromSavingsId: userAccountData.accountId,
      toClientId: adminAccountData.clientId,
      toClient: adminAccountData.client,
      toSavingsId: adminAccountData.accountId,
      toSession: adminAccountData.accountId,
      toAccount: adminAccountData.accountNo,
      toBank: "999999",
      signature: sha512.hex(
        `${userAccountData.accountNo}${adminAccountData.accountNo}`
      ),
      amount: amount,
      remark: "Paybills Payment",
      transferType: "intra",
      reference: ref,
    };

    // 5. Attempt transfer
    const transferRes = await httpClient(
      "/wallet2/transfer",
      "POST",
      transferBody
    );

    return {
      status: "success",
      message: "Transfer completed successfully",
      userBalance,
      data: transferRes.data,
    };
  } catch (error: any) {
    // Extract error details
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      "An unknown error occurred";

    const statusCode = error?.response?.status || 500;
    const errorData = error?.response?.data || null;

    // Optional: log for debugging
    console.error("Bank Transfer Error:", {
      message,
      statusCode,
      errorData,
    });

    // Return structured error
    throw {
      status: "error",
      message,
      code: statusCode,
      userBalance: null,
      data: errorData,
    };
  }
};

const checkSufficientBalance = async (user: any, amount: number) => {
  const userWallet = Number(user.user_metadata.wallet);
  if (userWallet < amount) {
    throw new Error("Insufficient Funds.");
  }

  const walletBalance = await paybillsService.CheckWalletBalance();
  if (Number(walletBalance.balance) < Number(amount)) {
    throw new Error("System currently busy. Try again later.");
  }

  return walletBalance;
};

const processTransaction = async (
  req: ProtectedRequest,
  res: Response,
  next: NextFunction,
  serviceFn: (...args: any[]) => Promise<any>,
  serviceArgs: any[],
  transactionDetails: {
    name: string;
    category: string;
    bank: string;
    account_number: string;
    receiver: string;
  }
) => {
  try {
    const { amount } = req.body;
    const { user } = req;
    if (!user || !user._id) throw new Error("Invalid user");

    await checkSufficientBalance(user, amount);

    

    const response = await serviceFn(...serviceArgs);

    const updatedWallet = userBalance != null? userBalance - amount : Number(user.user_metadata.wallet) - amount;
    await update(user._id, "user_metadata.wallet", String(updatedWallet));

    const transaction = await createTransaction({
      name: transactionDetails.name,
      category: transactionDetails.category as TransactionCategory,
      type: "paybills",
      user: user._id,
      details: StatusDescriptions[response.status as StatusCode],
      transaction_number: String(response.orderid),
      amount,
      outstanding: 0,
      bank: transactionDetails.bank,
      account_number: transactionDetails.account_number,
      receiver: transactionDetails.receiver,
      status: status as "success" || "error",
      session_id: String(response.orderid),
    });

    res.status(200).json({ status: "success", data: { ...response, transaction }, message: StatusDescriptions[response.status as StatusCode] });
  } catch (error) {
    console.log({ error })
    next(error);
  }
};

const validateAmount = (
    userAmount: number,
    validatedAmount: number,
    amountType: number
): void => {
    switch(amountType) {
        case 0: // Any amount
            break;
        case 1: // Minimum
            if (userAmount < validatedAmount) {
                throw new Error(`Amount must be at least ${validatedAmount}`);
            }
            break;
        case 2: // Greater than Minimum
            if (userAmount <= validatedAmount) {
                throw new Error(`Amount must be greater than ${validatedAmount}`);
            }
            break;
        case 3: // Maximum
            if (userAmount > validatedAmount) {
                throw new Error(`Amount must not exceed ${validatedAmount}`);
            }
            break;
        case 4: // Less than Maximum
            if (userAmount >= validatedAmount) {
                throw new Error(`Amount must be less than ${validatedAmount}`);
            }
            break;
        case 5: // Exact
            if (userAmount !== validatedAmount) {
                throw new Error(`Amount must be exactly ${validatedAmount}`);
            }
            break;
        default:
            throw new Error("Invalid amount validation type");
    }
};

// Updated processBillPaymentFlow controller
const processBillPaymentFlow = async (
    req: ProtectedRequest,
    res: Response,
    next: NextFunction,
    transactionDetails: {
        name: string;
        category: TransactionCategory;
    }
) => {
    try {
        const { billerId, paymentCode, customerId, amount, customerEmail, customerMobile } = req.body;
        const { user } = req;
        
        if (!user || !user._id) throw new Error("Invalid user");
        validateRequiredParams(req.body, ["billerId", "paymentCode", "customerId", "amount"]);

        // Step 1: Validate Customer
        const validationResponse = await paybillsService.validateCustomer({
            customers: [{ PaymentCode: paymentCode, CustomerId: customerId }],
            TerminalId: '3PBL0001'
        });

        const validationResult = validationResponse.Customers[0];
        if (validationResult.ResponseCode !== "90000") {
            throw new Error("Customer validation failed");
        }

        // Step 2: Validate amount against amountType rules
        validateAmount(
            Number(amount),
            validationResult.Amount,
            validationResult.AmountType
        );

        // Step 3: Calculate total amount with surcharge
        const totalAmount = Number(amount) + validationResult.Surcharge;
        
        // Step 4: Make Payment
        const requestReference = `PBL-${generateRandomString(12)}`;
        const paymentResponse = await paybillsService.makePayment({
            paymentCode,
            customerId,
            amount: totalAmount.toString(),
            customerEmail,
            customerMobile,
            requestReference
        });

        // Step 5: Create transaction record
        const transaction = await createTransaction({
            name: transactionDetails.name,
            category: transactionDetails.category,
            type: "paybills",
            user: user._id,
            details: StatusDescriptions[paymentResponse.responseCode as StatusCode],
            transaction_number: paymentResponse.transactionRef,
            amount: totalAmount,
            bank: "Interswitch",
            account_number: customerId,
            receiver: paymentCode,
            status: paymentResponse.status as TransactionStatus,
            session_id: requestReference,
            outstanding: 0.0
        });

        res.status(200).json({
            status: "success",
            data: { 
                ...paymentResponse, 
                transaction,
                validationDetails: validationResult
            },
            message: StatusDescriptions[paymentResponse.responseCode as StatusCode]
        });
    } catch (error) {
        next(error);
    }
};

// Biller Management Endpoints
export const getBillers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const response = await paybillsService.getBillers();
        res.status(200).json({ status: "success", data: response });
    } catch (error) {
        next(error);
    }
};

export const getBillerCategories = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const response = await paybillsService.getBillerCategories();
        res.status(200).json({ status: "success", data: response });
    } catch (error) {
        next(error);
    }
};

export const getBillerPaymentItems = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { billerId } = req.params;
        if (!billerId) throw new Error("Missing billerId parameter");
        
        const response = await paybillsService.getBillerPaymentItems(billerId);
        res.status(200).json({ status: "success", data: response });
    } catch (error) {
        next(error);
    }
};

// Generic Bill Payment Endpoint
export const processBillPayment = (req: Request, res: Response, next: NextFunction) => {
    return processBillPaymentFlow(
        req,
        res,
        next,
        {
            name: "Bill Payment",
            category: "bill-payment" as TransactionCategory
        }
    );
};

// Category-Specific Payment Endpoints
export const payCableTV = (req: Request, res: Response, next: NextFunction) => {
    validateRequiredParams(req.body, ["smartCardNo"]);
    return processBillPaymentFlow(
        req,
        res,
        next,
        {
            name: "Cable TV Payment",
            category: "cable-tv" as TransactionCategory
        }
    );
};

export const payElectricity = (req: Request, res: Response, next: NextFunction) => {
    validateRequiredParams(req.body, ["meterNumber"]);
    return processBillPaymentFlow(
        req,
        res,
        next,
        {
            name: "Electricity Payment",
            category: "electricity" as TransactionCategory
        }
    );
};

export const payInternet = (req: Request, res: Response, next: NextFunction) => {
    validateRequiredParams(req.body, ["accountNumber"]);
    return processBillPaymentFlow(
        req,
        res,
        next,
        {
            name: "Internet Payment",
            category: "internet" as TransactionCategory
        }
    );
};

// Transaction Management
export const getTransactionStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { transactionRef } = req.params;
        if (!transactionRef) throw new Error("Missing transactionRef");
        
        const response = await paybillsService.getTransactionStatus(transactionRef);
        res.status(200).json({ status: "success", data: response });
    } catch (error) {
        next(error);
    }
};

// Enhanced validateCustomer controller
export const validateCustomer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { paymentCode, customerId } = req.body;
        validateRequiredParams(req.body, ["paymentCode", "customerId"]);
        
        const response = await paybillsService.validateCustomer({
            customers: [{ PaymentCode: paymentCode, CustomerId: customerId }],
            TerminalId: '3PBL0001'
        });
        
        // Extract and enhance validation result
        const result = response.Customers[0];
        const validationInfo = {
            isValid: result.ResponseCode === "90000",
            customerName: result.FullName,
            requiredAmount: result.Amount,
            amountType: result.AmountTypeDescription,
            surcharge: result.Surcharge,
            totalAmount: result.Amount + result.Surcharge
        };

        res.status(200).json({ 
            status: "success", 
            data: validationInfo,
            message: validationInfo.isValid ? 
                "Customer validation successful" : 
                "Customer validation failed"
        });
    } catch (error) {
        next(error);
    }
};

// Additional Service Endpoints
export const getPopularBillers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const billers = await paybillsService.getBillers();
        const popularCategories = [2, 9, 12]; // Cable TV, Subscriptions, Tax Payments
        const popular = billers.filter(b => popularCategories.includes(b.CategoryId));
        res.status(200).json({ status: "success", data: popular });
    } catch (error) {
        next(error);
    }
};

export const getRecentTransactions = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
    try {
        const { user } = req;
        if (!user?._id) throw new Error("Invalid user");
        
        // Implementation would depend on your transaction storage
        const transactions = await findTransaction({ user: user._id }, "many");
        res.status(200).json({ status: "success", data: transactions });
    } catch (error) {
        next(error);
    }
};