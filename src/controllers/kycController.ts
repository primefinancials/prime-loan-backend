import { supabase } from "../utils/supabaseClient";
import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { convertDate } from "../utils/convertDate";
import { httpClient } from "../utils/httpClient";

export const livenessCheck = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { base64Image } = req.body;

    // Validate required parameters
    validateRequiredParams(
        { base64Image }, 
        [ "base64Image" ]
    );

    const response = await httpClient("/wallet2/checkliveness", "POST", { base64Image });

    res.status(response.status).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    console.log("Error checking liveness:", error);
    res.status(error.status || 500).json({ status: "error", message: error.message });
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
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};

export const ninVerification = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { idNumber } = req.body;
  
      // Validate required parameters
      validateRequiredParams(
          { idNumber }, 
          [ "idNumber" ]
      );
  
      const response = await httpClient("/kyc/verify/nin", "POST", { idNumber });
  
      res.status(response.status).json({ status: "success", data: response.data.data });
    } catch (error: any) {
      console.log("Error verifying nin:", error);
      res.status(error.status || 500).json({ status: "error", message: error.message });
    }
};
