import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { httpClient } from "../utils/httpClient";

export const livenessCheck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { base64Image } = req.body;

    const response = await httpClient("/wallet2/checkliveness", "POST", { base64Image });

    res.status(response.status).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    console.log("Error checking liveness:", error);
    next(error);
  }
};

export const bvnLookup = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { bvn } = req.query;
  
      // Validate required parameters
      validateRequiredParams(
          { bvn }, 
          [ "bvn" ]
      );
  
      const response = await httpClient(`/wallet2/bvn-account-lookup?bvn=${bvn}`, "GET");
  
      res.status(response.status).json({ status: "success", data: response.data.data });
    } catch (error: any) {
      console.log("Error checking bvn:", error);
      next(error);
    }
};

export const ninVerification = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { idNumber } = req.body;
  
      const response = await httpClient("/kyc/verify/nin", "POST", { idNumber });
  
      res.status(response.status).json({ status: "success", data: response.data.data });
    } catch (error: any) {
      console.log("Error verifying nin:", error);
      next(error);
    }
};
