import { Request, Response } from "express";
import { httpClient } from "../utils/httpClient";
import { supabase } from "../utils/supabaseClient";
import { validateRequiredParams } from "../utils/validateParams";

export const getBillerCategories = async (_req: Request, res: Response) => {
  try {
    const response = await httpClient("/billspaymentstore/billercategory", "GET");

    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const getBillerList = async (req: Request, res: Response) => {
  try {
    const { categoryName } = req.query;
    
    validateRequiredParams(
      { categoryName }, 
      [ "categoryName" ]
    );

    const response = await httpClient(`/billspaymentstore/billerlist?categoryName=${categoryName}`, "GET");
    
    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const getBillerItems = async (req: Request, res: Response) => {
  try {
    const { billerId, divisionId, productId } = req.query;
    
    validateRequiredParams(
      { billerId, divisionId, productId }, 
      [ "billerId", "divisionId", "productId" ]
    );

    const response = await httpClient(`/billspaymentstore/billerItems?billerId=${billerId}&divisionId=${divisionId}&productId=${productId}`, "GET");
    
    res.status(response.status || 200 ).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const validateCustomer = async (req: Request, res: Response) => {
  try {
    const { customerId, divisionId, paymentItem, billerId } = req.query;
    
    validateRequiredParams(
      { customerId, divisionId, paymentItem, billerId }, 
      [ "customerId", "divisionId", "paymentItem", "billerId" ]
    );

    const response = await httpClient(`/billspaymentstore/customervalidate?divisionId=${divisionId}&paymentItem=${paymentItem}&customerId=${customerId}&billerId=${billerId}`, "GET");
    
    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};

export const payBill = async (req: Request, res: Response) => {
  try {
    const {
      userId,
      name,
      category,
      details,
      customerId,
      amount,
      reference,
      division,
      paymentItem,
      productId,
      billerId,
      phoneNumber
    } = req.body;

    // Validate required parameters
    validateRequiredParams(
      { ...req.body },
      [
        "userId",
        "name",
        "category",
        "amount",
        "reference",
        "customerId",
        "division",
        "paymentItem",
        "productId",
        "billerId"
      ]
    );

    // Call the payment API
    const payResponse = await httpClient("/billspaymentstore/pay", "POST", req.body);

    if (payResponse.data) {
      const transactionStatus = payResponse.data.status === "00" ? "success" : "failed";

      // Insert transaction record into Supabase
      const { data, error } = await supabase
        .from("transactions")
        .insert([
          {
            name,
            category,
            type: "paybills",
            user: userId,
            details,
            transaction_number: customerId,
            amount,
            outstanding: 0.0,
            session_id: reference,
            status: transactionStatus,
            ...(phoneNumber && { phoneNumber }),
          },
        ])
        .select();

      if (error) {
        throw new Error(`Failed to log transaction: ${error.message}`);
      }

      // Respond with cleaned-up data
      res.status(payResponse.status || 200).json({
        status: payResponse.data.message,
        data: {
          ...payResponse.data.data, // Only include essential data
          transaction: data[0], // Transaction data from Supabase
        }
      });
    }
  } catch (error: any) {
    console.error({ error });
    res.status(error.status || 500).json({
      status: "error",
      message: error.message || "An error occurred",
    });
  }
};

export const transactionStatus = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.query;
    
    validateRequiredParams(
      { transactionId }, 
      [ "transactionId" ]
    );

    const response = await httpClient(`/billspaymentstore/transactionStatus?transactionId=${transactionId}`, "GET");
    
    res.status(response.status || 200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    res.status(error.status || 500).json({ status: "error", message: error.message });
  }
};
