import { Request, Response, NextFunction } from "express";
import { PaybillsService } from "../services/paybills.service";
import { UserService, TransactionService } from "../services";
import { validateRequiredParams } from "../utils/validateParams";
import { StatusDescriptions, ProtectedRequest, TransactionCategory, StatusCode } from "../interfaces";
import { message } from "./dataController";

const paybillsService = new PaybillsService();
const { update } = new UserService();
const { create: createTransaction } = new TransactionService();

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

    const updatedWallet = Number(user.user_metadata.wallet) - amount;
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
      status: "success",
      session_id: String(response.orderid),
    });

    res.status(200).json({ status: "success", data: { ...response, transaction }, message: StatusDescriptions[response.status as StatusCode] });
  } catch (error) {
    console.log({ error })
    next(error);
  }
};

export const buyAirtime = (req: Request, res: Response, next: NextFunction) => {
  validateRequiredParams(req.body, ["amount", "mobileNumber", "mobileNetwork"]);
  return processTransaction(
    req,
    res,
    next,
    paybillsService.BuyAirtime.bind(paybillsService),
    [req.body.amount, req.body.mobileNumber, req.body.mobileNetwork, req.body.bonusType],
    {
      name: "Airtime Purchase",
      category: "airtime",
      bank: req.body.mobileNetwork,
      account_number: req.body.mobileNumber,
      receiver: req.body.mobileNumber,
    }
  );
};

export const buyData = (req: Request, res: Response, next: NextFunction) => {
  validateRequiredParams(req.body, ["dataPlan", "mobileNumber", "mobileNetwork", "amount"]);
  return processTransaction(
    req,
    res,
    next,
    paybillsService.BuyData.bind(paybillsService),
    [req.body.dataPlan, req.body.mobileNumber, req.body.mobileNetwork],
    {
      name: "Data Purchase",
      category: "data",
      bank: req.body.mobileNetwork,
      account_number: req.body.mobileNumber,
      receiver: req.body.mobileNumber,
    }
  );
};

export const buyWaec = (req: Request, res: Response, next: NextFunction) => {
  validateRequiredParams(req.body, ["examType", "phoneNo", "amount"]);
  return processTransaction(
    req,
    res,
    next,
    paybillsService.BuyWaec.bind(paybillsService),
    [req.body.examType, req.body.phoneNo],
    {
      name: "WAEC PIN Purchase",
      category: "waec",
      bank: req.body.examType,
      account_number: req.body.phoneNo,
      receiver: req.body.phoneNo,
    }
  );
};

export const buyTv = (req: Request, res: Response, next: NextFunction) => {
  validateRequiredParams(req.body, ["cableTV", "pkg", "smartCardNo", "phoneNo", "amount"]);
  return processTransaction(
    req,
    res,
    next,
    paybillsService.BuyTv.bind(paybillsService),
    [req.body.cableTV, req.body.pkg, req.body.smartCardNo, req.body.phoneNo],
    {
      name: "TV Subscription",
      category: "tv",
      bank: req.body.cableTV,
      account_number: req.body.smartCardNo,
      receiver: req.body.phoneNo,
    }
  );
};

export const buyPower = (req: Request, res: Response, next: NextFunction) => {
  validateRequiredParams(req.body, ["electricCompany", "meterType", "meterNo", "amount", "phoneNo"]);
  return processTransaction(
    req,
    res,
    next,
    paybillsService.BuyPower.bind(paybillsService),
    [req.body.electricCompany, req.body.meterType, req.body.meterNo, req.body.amount, req.body.phoneNo],
    {
      name: "Electricity Purchase",
      category: "power",
      bank: req.body.electricCompany,
      account_number: req.body.meterNo,
      receiver: req.body.phoneNo,
    }
  );
};

export const buyBetting = (req: Request, res: Response, next: NextFunction) => {
  validateRequiredParams(req.body, ["bettingCompany", "customerId", "amount"]);
  return processTransaction(
    req,
    res,
    next,
    paybillsService.BuyBetting.bind(paybillsService),
    [req.body.bettingCompany, req.body.customerId, req.body.amount],
    {
      name: "Betting Wallet Top-up",
      category: "betting",
      bank: req.body.bettingCompany,
      account_number: req.body.customerId,
      receiver: req.body.customerId,
    }
  );
};

export const buyInternet = (req: Request, res: Response, next: NextFunction) => {
  validateRequiredParams(req.body, ["mobileNetwork", "dataPlan", "mobileNumber", "amount"]);
  return processTransaction(
    req,
    res,
    next,
    paybillsService.BuyInternet.bind(paybillsService),
    [req.body.mobileNetwork, req.body.dataPlan, req.body.mobileNumber],
    {
      name: "Internet Purchase",
      category: "internet",
      bank: req.body.mobileNetwork,
      account_number: req.body.mobileNumber,
      receiver: req.body.mobileNumber,
    }
  );
};

export const buyJamb = (req: Request, res: Response, next: NextFunction) => {
  validateRequiredParams(req.body, ["examType", "phoneNo", "amount"]);
  return processTransaction(
    req,
    res,
    next,
    paybillsService.BuyJamb.bind(paybillsService),
    [req.body.examType, req.body.phoneNo],
    {
      name: "JAMB PIN Purchase",
      category: "jamb",
      bank: req.body.examType,
      account_number: req.body.phoneNo,
      receiver: req.body.phoneNo,
    }
  );
};


// Query a Transaction by orderId
export const queryTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    if (!orderId) throw new Error("Missing orderId");

    const response = await paybillsService.QueryTransaction(Number(orderId));

    res.status(200).json({ status: "success", data: response, message: StatusDescriptions[response.status] });
  } catch (error) {
    next(error);
  }
};

// Cancel a Transaction by orderId
export const cancelTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = req.params;
    if (!orderId) throw new Error("Missing orderId");

    const response = await paybillsService.CancelTransaction(Number(orderId));

    res.status(200).json({ status: "success", data: response, message: StatusDescriptions[response.status] });
  } catch (error) {
    next(error);
  }
};

// Verify TV Subscription by Smartcard
export const verifyTvNumber = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cableTV, smartCardNo } = req.query;
    if (!cableTV || !smartCardNo) throw new Error("Missing cableTV or smartCardNo");

    const response = await paybillsService.VerifyTvNumber(cableTV as any, Number(smartCardNo));

    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Verify Power Meter Number
export const verifyPowerNumber = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { electricCompany, meterNo } = req.query;
    if (!electricCompany || !meterNo) throw new Error("Missing electricCompany or meterNo");

    const response = await paybillsService.VerifyPowerNumber(electricCompany as string, Number(meterNo));

    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Verify Betting Customer ID
export const verifyBettingNumber = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bettingCompany, customerId } = req.query;
    if (!bettingCompany || !customerId) throw new Error("Missing bettingCompany or customerId");

    const response = await paybillsService.VerifyBettingNumber(bettingCompany as string, Number(customerId));

    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Verify Smile Number
export const verifySmileNumber = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mobileNumber } = req.query;
    if (!mobileNumber) throw new Error("Missing mobileNumber");

    const response = await paybillsService.VerifySmileNumber(Number(mobileNumber));

    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Verify JAMB Profile ID
export const verifyJambNumber = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { examType, profileId } = req.query;
    if (!examType || !profileId) throw new Error("Missing examType or profileId");

    const response = await paybillsService.VerifyJambNumber(examType as string, Number(profileId));

    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Get available TV packages
export const getTvPackages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await paybillsService.GetTvPackages();
    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Get available mobile data plans
export const getDataPlans = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await paybillsService.GetDataPlans();
    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Get internet plan options for Smile/Spectranet
export const getInternetPlans = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mobileNetwork } = req.query;
    
    // Validate mobileNetwork
    if (typeof mobileNetwork !== "string" || !["smile-direct", "spectranet"].includes(mobileNetwork)) {
      throw new Error("Invalid or missing mobileNetwork. Allowed values: 'smile-direct', 'spectranet'");
    }

    const response = await paybillsService.GetInternetPlans(mobileNetwork as "smile-direct" | "spectranet");
    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Get WAEC PIN types
export const getWaecTypes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await paybillsService.GetWaecTypes();
    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Get JAMB PIN types
export const getJambTypes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await paybillsService.GetJambTypes();
    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Get Betting Platforms
export const getBettingPlatforms = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await paybillsService.GetBettingPlatforms();
    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

// Get Power Subscription Companies
export const getPowerSubscriptions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const response = await paybillsService.GetPowerSubscriptions();
    res.status(200).json({ status: "success", data: response });
  } catch (error) {
    next(error);
  }
};

