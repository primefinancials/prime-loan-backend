import { supabase } from "../utils/supabaseClient";
import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { generateBearerToken } from "../utils/generateBearerToken";
import { validateRequiredParams } from "../utils/validateParams";
import { convertDate } from "../utils/convertDate";
import { customerKey, customerSecret } from "../config";

export const createClientAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, name, surname, password, phone, bvn, nin, dob } = req.body;

    // Validate required parameters
    validateRequiredParams(
        { bvn, dateOfBirth: dob, password, surname, email, name, phone, nin }, 
        [ "bvn", "dateOfBirth", "password", "phone", "nin", "email", "name", "surname" ]
    );

    const accessToken = await generateBearerToken(customerKey, customerSecret);

    const apiUrl = `https://api-apps.vfdbank.systems/vtech-wallet/api/v1/wallet2/client/create`;

    const response = await axios.post(
      `${apiUrl}?bvn=${bvn}&dateOfBirth=${convertDate(dob)}`,
      { },
      {
        headers: {
          "Content-Type": "application/json",
          AccessToken: accessToken,
        },
      }
    );

    if (![200, 202].includes(response.status)) {
      throw new Error(`Client creation failed: ${response.data.message}`);
    }

    if(response.data) {
        const { data: { user }, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { first_name: name, surname, phone, bvn, nin, dob: convertDate(dob), accountNo: response.data.data.accountNo },
          },
        });

        if (error) {
            throw new Error(`Error storing to supabase: ${error.message}`);
        } 

        res.status(200).json({ status: "success", data: { ...response.data.data, user } });
    }

    res.status(400).json({ status: "error", message: response.data.message });
  } catch (error: any) {
    console.error("Error creating client account:", error.message || error);
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from("users").select("*");
    if (error) throw error;

    res.status(200).json({ status: "success", data });
  } catch (error: any) {
    res.status(500).json({ status: "error", message: error.message });
  }
};
