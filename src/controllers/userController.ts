import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { convertDate } from "../utils/convertDate";
import { httpClient } from "../utils/httpClient";
import { sha512 } from "js-sha512";
import { UserService, TransactionService } from "../services";
import { ConflictError, UnauthorizedError, NotFoundError } from "../exceptions";
import { encryptPassword } from "../utils";
import { getCurrentTimestamp } from "../utils/convertDate";
import { decodePassword } from "../utils";
import JWT from "jsonwebtoken";
import {
  ACCESS_TOKEN_EXPIRES_IN,
  COOKIE_VALIDITY,
  REFRESH_TOKEN_EXPIRES,
} from "../constants";
import {
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET
} from "../config";
import { ProtectedRequest, User } from "../interfaces";

function isUser(object: any, value: string): object is User {
  return value in object;
}

const { find, findByEmail, create, update } = new UserService();
const { create: createTransaction } = new TransactionService();

export const createClientAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, name, surname, password, phone, bvn, nin, dob } = req.body;

    const duplicateEmail = await findByEmail(email)

    const duplicateNumber = await find({ user_metadata: { phone } }, "one")
    
    if (duplicateEmail)
      throw new ConflictError(`A user already exists with the email ${email}`)
    if (duplicateNumber)
      throw new ConflictError(`A user already exists with the phone number ${phone}`)

    req.body.password = encryptPassword(password);

    const apiUrl = `/wallet2/client/create?bvn=${bvn}&dateOfBirth=${convertDate(dob)}`;

    const response = await httpClient(apiUrl, "POST", { });

    if(response.data && response.data.status === "00") {
      const user: any = await create({ 
        password: req.body.password,
        user_metadata: { email, first_name: name, surname, phone, bvn, nin, dateOfBirth: dob }, 
        role: "user",
        confirmation_sent_at: getCurrentTimestamp(),
        confirmed_at: "",
        email,
        email_confirmed_at: "", 
        is_anonymous: false,
        phone,
        is_super_admin: false
      });

      return res.status(201).json({ status: "success", data: { ...response.data.data, user } });
    }

    return res.status(response.status).json({ status: "failed", message: response.data.message });
  } catch (error: any) {
    next(error)
  }
};

export const createAdminAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, name, surname, password, phone } = req.body;

    const duplicateEmail = await findByEmail(email);

    const duplicateNumber = await find({ user_metadata: { phone } }, "one")
    
    if (duplicateEmail)
      throw new ConflictError(`A user already exists with the email ${email}`)
    if (duplicateNumber)
      throw new ConflictError(`A user already exists with the phone number ${phone}`)

    req.body.password = encryptPassword(password);

    const user: any = await create({ 
      password: req.body.password,
      user_metadata: { email, first_name: name, surname, phone }, 
      role: "admin",
      confirmation_sent_at: getCurrentTimestamp(),
      confirmed_at: "",
      email,
      email_confirmed_at: "", 
      is_anonymous: false,
      phone,
      is_super_admin: false
    });

    return res.status(201).json({ status: "success", data: { user } });
  } catch (error: any) {
    next(error)
  }
};

export const getUser = async (
  req: ProtectedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = req.user;

    if (!user) throw new UnauthorizedError(`Unauthorized! Please log in as user to continue`);

    const foundUser: any = await find({ _id: user._id}, "one");

    if (!foundUser)
      throw new NotFoundError(`No user found`);

    return res.status(200).json({status: "success", data: foundUser});
  } catch (err: any) {
    next(err)
  }
}

export const updateClientAccount = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { user } = req;

    if (!user) throw new UnauthorizedError(`Unauthorized! Please log in as user to continue`);

    const updatedUser = update(user._id, { ...req.body })

    return res.status(201).json({ status: "success", data: { user: updatedUser } });
  } catch (error: any) {
    next(error)
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      email,
      password
    } = req.body;

    let foundUser: any;

    foundUser = await findByEmail(email); 

    if (!foundUser)
      throw new UnauthorizedError(`Invalid credentials`);

    const { password: encrypted } = foundUser;

    // decrypt found user password
    const decrypted = decodePassword(encrypted);

    // compare decrypted password with sent password
    if (password !== decrypted)
      throw new UnauthorizedError(`Invalid credentials`);

    const {
      password: dbPassword, // strip out password so would'nt send back to client
      refreshToken: dbRefreshToken, //Strip out old refreshToken so it wont keep signing old ones
      ..._user
    } = foundUser._doc;

    const userToSign = {
      accountType: foundUser.role,
      id: _user._id
    }

    // create JWTs
    const accessToken = JWT.sign(userToSign, String(ACCESS_TOKEN_SECRET), {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });

    const refreshToken = JWT.sign(userToSign, String(REFRESH_TOKEN_SECRET), {
      expiresIn: REFRESH_TOKEN_EXPIRES,
    });

    // update current user refresh token
    const refreshTokens = foundUser.refresh_tokens
    refreshTokens.push(refreshToken)
    foundUser.refresh_tokens = refreshTokens;
    await foundUser.save();

    return res
      .cookie("jwt", refreshToken, {
        httpOnly: true,
        maxAge: COOKIE_VALIDITY,
      })
      .status(200)
      .json({
        status: 'success',
        data: { ..._user, refreshToken, accessToken },
      });
  } catch (error: any) {
    next(error)
  }
}

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {  
    const cookies = req.cookies;
    if (!cookies?.jwt) return res.sendStatus(204); //no content

    const refreshToken = cookies.jwt;

    const foundUser: any = await find({ refresh_token: refreshToken }, "one");

    if (!foundUser) {
      res.clearCookie("jwt", {
        httpOnly: true,
        maxAge: COOKIE_VALIDITY,
        /* set sameSite: "None" and secure: true if hosted on different tls/ssl secured domain from client */
      });
      return res.sendStatus(204);
    }

    // Delete refreshToken in db
    foundUser.refresh_token = "";
    const result = await foundUser.save();

    return res
      .clearCookie("jwt", { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 })
      .sendStatus(204);
  } catch (error: any) {
    next(error)
  }
}

export const changePassword = async (
  req: ProtectedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = req.user;

    if (!user) throw new UnauthorizedError(`Unauthorized! Please log in as user to continue`)

    const foundUser: any = await find({ _id: user._id}, "one");

    if (!foundUser)
      throw new NotFoundError(`No user found`);

    let userPassword = "";

    if (isUser(foundUser, "password") && foundUser.password) userPassword = foundUser.password;

    // Decoding password
    const decrypted = decodePassword(userPassword);

    if (oldPassword !== decrypted) throw new UnauthorizedError(`Invalid credentials`)

    const encrypted = encryptPassword(newPassword);

    foundUser.password = encrypted;
    foundUser.save();

    return res.status(200).json({status: "success", data: foundUser});
  } catch (err: any) {
    next(err)
  }
}

export const accountEnquiry = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { accountNumber } = req.query;

    const response = await httpClient(`/wallet2/account/enquiry${accountNumber? `?accountNumber=${accountNumber}` : "?"}`, "GET");

    res.status(response.status).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    console.log("Error getting account enquiry:", error);
    next(error);
  }
};

export const beneficiaryEnquiry = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
    try {
      const { accountNo, bank, transferType } = req.query;
  
      // Validate required parameters
      validateRequiredParams(
          { accountNo, bank, transferType }, 
          [ "accountNo", "bank", "transferType" ]
      );
  
      const response = await httpClient(`/wallet2/transfer/recipient?accountNo=${accountNo}&bank=${bank}&transfer_type=${transferType}`, "GET");
  
      res.status(response.status).json({ status: "success", data: response.data.data });
    } catch (error: any) {
      console.log("Error getting account enquiry:", error);
      next(error);
    }
};

export const bankListing = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
    try {
      const response = await httpClient(`/wallet2/bank`, "GET");
  
      res.status(response.status).json({ status: "success", data: response.data.data });
    } catch (error: any) {
      console.log("Error getting bank list:", error);
      next(error);
    }
};

export const transfer = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { 
      fromAccount,
      fromClientId,
      fromClient,
      fromSavingsId,
      fromBvn,
      toClient,
      toSession,
      toBvn,
      toKyc,
      bank,
      toAccount,
      toBank,
      toSavingsId,
      amount,
      remark,
      reference,
    } = req.body;

    console.log({ ...req.body });

    const { user } = req;

    if (!user || !user._id) {
      return res.status(404).json({
        status: "User not found.",
        data: null
      });
    }

    if (Number(user.user_metadata.wallet) < Number(amount)) {
      return res.status(409).json({
        status: "Insufficient Funds.",
        data: null
      });
    }

    const apiUrl = `/wallet2/transfer`;

    const response = await httpClient(apiUrl, "POST", {
      fromAccount,
      uniqueSenderAccountId: "",
      fromClientId,
      fromClient,
      fromSavingsId,
      fromBvn,
      toClient,
      toSession,
      toBvn,
      toKyc,
      toAccount,
      toSavingsId,
      toBank,
      signature: sha512.hex(`${fromAccount}${toAccount}`),
      amount,
      remark,
      transferType: "inter",
      reference
    });

    if(response.data && response.data.status === "00") {
      const data = await update(
        user._id,
        { user_metadata: { ...user.user_metadata, wallet: String(Number(user?.user_metadata?.wallet) - Number(amount))  }}
      );

      const transaction = await createTransaction(
          { 
            name: "Withdrawal-" + reference, 
            category: "debit",
            type: "transfer",
            user: user._id,
            details: remark,
            transaction_number: response.data.data.txnId || "no-txnId",
            amount,
            bank,
            receiver: toClient,
            account_number: toAccount, 
            outstanding: 0.0,
            session_id: response.data.data.sessionId || "no-sessionId",
            status: "success"
          },
        )
      ;

      res.status(response.status).json({ status: "success", data: { ...response.data.data, transaction } });
    }

    res.status(400).json({ status: "failed", message: response.data.message });
  } catch (error: any) {
    console.log("Error making withdrawal:", error);
    next(error);
  }
};

// Function to handle wallet alerts
export const walletAlerts = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    
    // retrieve all identites linked to a user
    const user = await find({ user_metadata: { accountNo: body.originator_account_name } }, "one");

    if (!user || Array.isArray(user) || !user._id) {
      return res.status(404).json({
        status: "User not found.",
        data: null
      });
    }

    await update(
      user._id,
      { user_metadata: { ...user.user_metadata, wallet: String(user.user_metadata?.wallet? Number(user?.user_metadata?.wallet) : 0) + Number(body.amount)  }}
    );

    // Insert transaction into database
    const data = await createTransaction(
      {
        name: `Transfer from ${body.originator_account_name}`,
        category: "credit",
        type: "transfer",
        user: user._id,
        details: body.originator_narration,
        transaction_number: String(body.reference),
        amount: Number(Number(body.amount).toFixed(0)),
        account_number: body.originator_account_number,
        bank: body.originator_bank,
        receiver: body.account_number,
        outstanding: 0.0,
        session_id: body.session_id,
        status: "success",
      },
    );

    console.log({ data });

    return res.status(200).json({ status: "Success", data });
  } catch (error: any) {
    console.error("Error handling wallet alerts:", error);
    res.status(400).json({ status: 400, message: error.message });
  }
};



