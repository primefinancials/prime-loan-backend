import { Request, Response, NextFunction } from "express";
import { validateRequiredParams } from "../utils/validateParams";
import { convertDate } from "../utils/convertDate";
import { httpClient } from "../utils/httpClient";
import { sha512 } from "js-sha512";
import { UserService, TransactionService } from "../services";
import { ConflictError, UnauthorizedError, NotFoundError, BadRequestError } from "../exceptions";
import { encryptPassword } from "../utils";
import { getCurrentTimestamp } from "../utils/convertDate";
import { decodePassword } from "../utils";
import JWT from "jsonwebtoken";
import axios, { AxiosRequestConfig } from "axios";
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
import { sendEmail } from "../jobs/loanReminder";
import { generateRandomString } from "../utils/generateRef";
import CounterService from "../services/counter.service";

function isUser(object: any, value: string): object is User {
  return value in object;
}

const { find, findByEmail, create, update } = new UserService();
const { create: createTransaction } = new TransactionService();
const counterService = new CounterService();

const signupBonus = async ({
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
      fromAccount: adminAccountData.accountNo,
      uniqueSenderAccountId: "",
      fromClientId: adminAccountData.clientId,
      fromClient: adminAccountData.client,
      fromSavingsId: adminAccountData.accountId,
      toClientId: userAccountData.clientId,
      toClient: userAccountData.client,
      toSavingsId: userAccountData.accountId,
      toSession: userAccountData.accountId,
      toAccount: userAccountData.accountNo,
      toBank: "999999",
      signature: sha512.hex(
        `${adminAccountData.accountNo}${userAccountData.accountNo}`
      ),
      amount: amount,
      remark: "Signup Bonus",
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

export const createClientAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, name, surname, password, phone, bvn, nin, dob, pin } = req.body;

    const duplicateEmail = await findByEmail(email)

    const duplicateNumber = await find({ user_metadata: { phone } }, "one")

    const duplicateNIN = await find({ user_metadata: { nin } }, "one")
    
    if (duplicateEmail)
      throw new ConflictError(`A user already exists with the email: ${email}`)
    if (duplicateNumber)
      throw new ConflictError(`A user already exists with the phone number: ${phone}`)
    if (duplicateNIN)
      throw new ConflictError(`A user already exists with the NIN: ${nin}`)

    req.body.password = encryptPassword(password);

    const apiUrl = `/wallet2/client/create?bvn=${bvn}&dateOfBirth=${convertDate(dob)}`;

    const response = await httpClient(apiUrl, "POST", { });

    if(response.data && response.data.status === "00") {
      const user = await create({ 
        password: req.body.password,
        user_metadata: { email, first_name: name, surname, phone, bvn, nin, dateOfBirth: dob, accountNo: response.data.data.accountNo, pin }, 
        role: "user",
        confirmation_sent_at: getCurrentTimestamp(),
        confirmed_at: "",
        email,
        email_confirmed_at: "", 
        is_anonymous: false,
        phone,
        is_super_admin: false,
        status: "active"
      });

      const counter = await counterService.findOneAndUpdate(
        { name: 'signupBonus' },
        { $inc: { count: 1 } }
      );

      if (counter.count <= 100) {
        await signupBonus({ userId: user._id, amount: "50" });
        await update(user._id, "user_metadata.signupBonusReceived", true);
      }

      await sendEmail(
        user.email,
        'Registration Successful',
        `Dear ${user.user_metadata.first_name}, \n Welcome to Prime Finance, Your registration was successful. \n Thank you for using Prime Finance!`
      );

      await sendEmail(
        "info@primefinance.live, primefinancials68@gmail.com",
        'New User Registered',
        `New user ${user.user_metadata.first_name} ${user.user_metadata.surname}, just registered!`
      );

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
      is_super_admin: false,
      status: "active"
    });

    return res.status(201).json({ status: "success", data: { user } });
  } catch (error: any) {
    next(error)
  }
};

export const createSuperAdminAccount = async (req: Request, res: Response, next: NextFunction) => {
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
      is_super_admin: true,
      status: "active"
    });

    return res.status(201).json({ status: "success", data: { user } });
  } catch (error: any) {
    next(error)
  }
};

export const getAdmin = async (
  req: ProtectedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const admin = req.admin;

    if (!admin) throw new UnauthorizedError(`Unauthorized! Please log in as admin to continue`);

    const foundAdmin: any = await find({ _id: admin._id}, "one");

    if(foundAdmin.status !== "active") 
      throw new UnauthorizedError(`Account has been suspended! Contact super admin for revert action.`);

    if (!foundAdmin)
      throw new NotFoundError(`No admin found`);

    return res.status(200).json({status: "success", data: foundAdmin});
  } catch (err: any) {
    next(err)
  }
}

export const getUser = async (
  req: ProtectedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = req.user;

    if (!user) throw new UnauthorizedError(`Unauthorized! Please log in as user to continue`);

    const foundUser: any = await find({ _id: user._id}, "one");

    if(foundUser.status !== "active") 
      throw new UnauthorizedError(`Account has been suspended! Contact admin for revert action.`);

    if (!foundUser)
      throw new NotFoundError(`No user found`);

    return res.status(200).json({status: "success", data: foundUser});
  } catch (err: any) {
    next(err)
  }
}

export const getUsers = async (
  req: ProtectedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const admin = req.admin;

    if (!admin) throw new UnauthorizedError(`Unauthorized! Please log in as an admin to continue`);

    const foundUser: any = await find({ }, "many");

    return res.status(200).json({status: "success", data: foundUser});
  } catch (err: any) {
    next(err)
  }
}

export const ActivateAndDeactivateUser = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { admin } = req;

    if (!admin) {
      throw new UnauthorizedError("Unauthorized! Please log in as a admin to continue");
    }

    const { status, userId } = req.body; // Extract update field and data from request body

    const updatedUser = await update(userId, "status", status);

    console.log({ updatedUser });

    return res.status(200).json({ status: "success", data: { user: updatedUser } });
  } catch (error: any) {
    next(error);
  }
};

export const ActivateAndDeactivateAdmin = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { admin } = req;

    if (!admin) {
      throw new UnauthorizedError("Unauthorized! Please log in as a admin to continue");
    }

    const { status, adminId } = req.body; // Extract update field and data from request body

    const updatedAdmin = await update(adminId, "status", status);

    console.log({ updatedAdmin });

    return res.status(200).json({ status: "success", data: { user: updatedAdmin } });
  } catch (error: any) {
    next(error);
  }
};

export const updateClientAccount = async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { user } = req;

    if (!user) {
      throw new UnauthorizedError("Unauthorized! Please log in as a user to continue");
    }

    const { updateField, data } = req.body; // Extract update field and data from request body

    const updatedUser = await update(user._id, updateField, data);

    console.log({ updatedUser });

    return res.status(200).json({ status: "success", data: { user: updatedUser } });
  } catch (error: any) {
    next(error);
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
      throw new UnauthorizedError(`Invalid Email Address!`);
    
    if(foundUser?.status && foundUser.status !== "active") 
      throw new UnauthorizedError(`Account has been suspended! Contact admin for revert action.`);

    const { password: encrypted } = foundUser;

    // decrypt found user password
    const decrypted = decodePassword(encrypted);

    // compare decrypted password with sent password
    if (password !== decrypted)
      throw new UnauthorizedError(`Incorrect Password!`);

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

    await sendEmail(
      foundUser.email,
      'Login Successful', 
      `Dear ${foundUser.user_metadata.first_name}, There has been a new login on your account, if this wasn't you contact contact support at info@primefinance.live else you should ignore this mail. \n Thank you for using Prime Finance!`
    );

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

export const initiateReset = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, type } = req.body;

    if (!email) throw new BadRequestError("Provide a valid email");
    if (!type) throw new BadRequestError("Provide a valid type");

    const foundUser: any = await find({ email }, "one");
    if (!foundUser) throw new NotFoundError("No user found");

    const pin = Math.floor(100000 + Math.random() * 900000);

    // Initialize updates array if it doesn't exist
    const updates = [
      ...(foundUser.updates || []), // Handle undefined updates array
      {
        pin,
        type,
        status: "awaiting_validation",
        created_at: new Date().toISOString() // Include full timestamp
      }
    ];

    await sendEmail(
      email,
      "Reset Your Password – OTP Verification Code",
      `
      Dear ${foundUser.user_metadata.first_name},

      We received a request to reset your password. Use the One-Time Password (OTP) below to proceed:

      🔐 Your OTP Code: [${pin}]

      This code is valid for the next 10 minutes. If you did not request a password reset, please ignore this email or contact our support team immediately.

      Stay secure,
      Prime Finance Support Team
      support@primefinance.live | primefinance.live
      `
    );

    await update(foundUser._id, "updates", updates);

    return res.status(200).json({
      status: "success",
      message: "OTP initiated successfully",
      data: true
    });
  } catch (err: any) {
    next(err);
  }
};

export const validateReset = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, pin } = req.body;

    if (!email) throw new BadRequestError('Email is required');
    if (!pin) throw new BadRequestError('PIN is required');

    const foundUser: any = await find({ email }, "one");
    
    if (!foundUser) throw new NotFoundError('User not found with provided email');

    const updates = foundUser.updates;
    const lastUpdate = updates[updates.length - 1];
    
    if (!lastUpdate) throw new BadRequestError('No reset request found');

    const currentTime = new Date();
    const createdAt = new Date(lastUpdate.created_at);
    
    // Calculate time difference in milliseconds
    const timeDiff = currentTime.getTime() - createdAt.getTime();
    console.log(`Time difference: timeDiff: ${timeDiff}, 10min: ${10 * 60 * 1000}`);

    // Check if PIN is correct and within 10-minute window
    if (lastUpdate.pin !== pin || timeDiff > 10 * 60 * 1000) { // 10 minutes in milliseconds
      lastUpdate.status = "invalid";
      await update(foundUser._id, "updates", updates);
      throw new BadRequestError('Invalid or expired OTP');
    }

    lastUpdate.status = "validated";
    await update(foundUser._id, "updates", updates);

    return res.status(200).json({
      status: "success",
      message: "OTP validated successfully",
      data: true
    });
  } catch (err) {
    next(err);
  }
};

export const updatePasswordOrPin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, newPassword, newPin } = req.body;

    if (!email)
      throw new BadRequestError(`Provide a valid email`);

    const foundUser: any = await find({ email }, "one");

    if (!foundUser)
      throw new NotFoundError(`No user found`);

    // Get the last update from the updates array
    const lastUpdate = foundUser.updates[foundUser.updates.length - 1];

    // Check if last update exists and is validated
    if (!lastUpdate || lastUpdate.status !== "validated") {
      throw new BadRequestError(`Password or PIN update is not validated`);
    }

    // Hash the new password if provided
    if (newPassword) {
      const hashedPassword = await encryptPassword(newPassword); // Hashing the password with salt rounds
      await update(foundUser._id, "password", hashedPassword); // Save password
      return res.status(200).json({ status: "success", message: "Password updated successfully", data: true });
    }

    // Update the new PIN if provided
    if (newPin) {
      await update(foundUser._id, "user_metadata.pin", newPin); // Save PIN (if you have a separate update mechanism)
      return res.status(200).json({ status: "success", message: "PIN updated successfully", data: true });
    }

    return res.status(400).json({ status: "failed", message: "Missing Parameters" });
  } catch (err: any) {
    next(err);
  }
};

export const forgotPassword = async (
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
      toClientId,
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
      uniqueSenderAccountId: toBank == '999999'? fromSavingsId : "",
      fromClientId,
      fromClient,
      fromSavingsId,
      ...(toBank == '999999'? { toClientId } : { fromBvn, toBvn, toKyc }),
      toClient,
      toSession,
      toAccount,
      toSavingsId,
      toBank,
      signature: sha512.hex(`${fromAccount}${toAccount}`),
      amount,
      remark,
      transferType: toBank == '999999'? "intra" : "inter",
      reference
    });

    if(response.data && response.data.status === "00") {
      await update(
        user._id,
        "user_metadata.wallet",
        String(Number(user?.user_metadata?.wallet) - Number(amount))
      );

      if (toBank == '999999') {
        const beneficairy = await find({ "user_metadata.accountNo": toAccount }, "one"); 

        if(beneficairy && !Array.isArray(beneficairy) && beneficairy._id) {
          await update(
            beneficairy._id,
            "user_metadata.wallet",
            String(Number(beneficairy?.user_metadata?.wallet) + Number(amount))
          ); 

          await createTransaction(
            { 
              name: "Deposit-" + reference, 
              category: "credit",
              type: "transfer",
              user: beneficairy._id,
              details: remark,
              transaction_number: `${response.data.data.txnId}-recieved` || "no-txnId",
              amount,
              bank,
              receiver: toClient,
              account_number: toAccount, 
              outstanding: 0.0,
              session_id: `${response.data.data.sessionId}-recieved` || "no-sessionId",
              status: "success"
            },
          );

          await sendEmail(
            user.email,
            'Wallet Alert – Funds Credited',
            `Dear ${beneficairy.user_metadata.first_name},\n\nYour wallet has been credited with ${amount} from ${user?.user_metadata?.first_name}.\n\nTransaction Details:\n- Amount: ${amount}\n- Reference: ${reference}\n- Originator Account Name: ${fromClient}\n- Originator Account Number: ${fromAccount}\n\nThank you for using Prime Finance!`
          )
        }      
      }

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
      );

      await sendEmail(
        user.email,
        'Withdrawal Successful',
        `Dear ${user.user_metadata.first_name},\n\nYour withdrawal of ${amount} has been successfully processed.\n\nTransaction Details:\n- Amount: ${amount}\n- Reference: ${reference}\n- To Account: ${toAccount}\n- Bank: ${bank}\n\nThank you for using Prime Finance!`
      )

      res.status(response.status).json({ status: "success", data: { ...response.data.data, transaction } });
    } else {
      await sendEmail(
        user.email,
        'Withdrawal Failed',
        `Dear ${user.user_metadata.first_name},\n\nYour withdrawal of ${amount} has failed.\n\nReason: ${response.data.message} \n\nPlease try again or contact support if the issue persists.\n\nThank you for using Prime Finance!`
      )
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
    const user = await find({ "user_metadata.accountNo": body.account_number }, "one");

    console.log({ user, account_number: body.account_number });

    if (!user || Array.isArray(user) || !user._id) {
      return res.status(404).json({
        status: "User not found.",
        data: null
      });
    }

    await update(
      user._id,
      "user_metadata.wallet",
      String((user.user_metadata?.wallet? Number(user?.user_metadata?.wallet) : 0) + Number(body.amount))
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

    await sendEmail(
      user.email,
      'Wallet Alert – Funds Credited',
      `Dear ${user.user_metadata.first_name},\n\nYour wallet has been credited with ${body.amount} from ${body.originator_account_name}.\n\nTransaction Details:\n- Amount: ${body.amount}\n- Reference: ${body.reference}\n- Originator Account Name: ${body.originator_account_name}\n- Originator Account Number: ${body.originator_account_number}\n\nThank you for using Prime Finance!`
    )

    return res.status(200).json({ status: "Success", data });
  } catch (error: any) {
    console.error("Error handling wallet alerts:", error);
    res.status(400).json({ status: "error", message: error.message });
  }
};

export const initializeLinking =  async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  const url = `https://api.withmono.com/v2/accounts/initiate`;

  const headers = {
    "accept": "application/json",
    "content-type": "application/json",
    "mono-sec-key": "live_sk_axio44pdonk6lb6rdhxa",
  };

  const options: AxiosRequestConfig = {
    url,
    method: "POST",
    headers,
    data: { ...req.body }
  };

  try {
    const response = await axios(options);

    if (![200, 202].includes(response.status)) {
        throw new Error(`initialize link: ${response.data.message}`);
    }

    res.status(200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    console.log({ error });
    next(error);
  }
}

export const confirmLinking =  async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  const url = `https://api.withmono.com/v2/accounts/auth`;

  const headers = {
    "accept": "application/json",
    "content-type": "application/json",
    "mono-sec-key": "live_sk_axio44pdonk6lb6rdhxa",
  };

  const options: AxiosRequestConfig = {
    url,
    method: "POST",
    headers,
    data: { ...req.body }
  };

  try {
    const response = await axios(options);

    if (![200, 202].includes(response.status)) {
        throw new Error(`confirm link: ${response.data.message}`);
    }

    res.status(200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    console.log({ error });
    next(error);
  }
}

export const accountDetails =  async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: "Account ID is required" });
  }

  const url = `https://api.withmono.com/v2/accounts/${id}`;

  const headers = {
    "accept": "application/json",
    "content-type": "application/json",
    "mono-sec-key": "live_sk_axio44pdonk6lb6rdhxa",
  };

  const options: AxiosRequestConfig = {
    url,
    method: "GET",
    headers,
  };

  try {
    const response = await axios(options);

    if (![200, 202].includes(response.status)) {
        throw new Error(`account details: ${response.data.message}`);
    }

    res.status(200).json({ status: "success", data: response.data.data });
  } catch (error: any) {
    console.log({ error });
    next(error);
  }
}

export const linkAccount =  async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  try {
    const { user } = req;

    if (!user) {
      throw new UnauthorizedError("Unauthorized! Please log in as a user to continue");
    }

    const updatedUser = await update(user._id, "linked_accounts", [...(user?.linked_accounts || []), ...req.body]);

    console.log({ updatedUser });

    return res.status(200).json({ status: "success", data: { user: updatedUser } });
  } catch (error: any) {
    console.log({ error });
    next(error);
  }
}

export const unlinkAccount =  async (req: ProtectedRequest, res: Response, next: NextFunction) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: "Account ID is required" });
  }

  const url = `https://api.withmono.com/v2/accounts/${id}/unlink`;

  const headers = {
    "accept": "application/json",
    "content-type": "application/json",
    "mono-sec-key": "live_sk_axio44pdonk6lb6rdhxa",
  };

  const options: AxiosRequestConfig = {
    url,
    method: "POST",
    headers,
  };

  try {
    const response = await axios(options);

    if (![200, 202].includes(response.status)) {
        throw new Error(`unlinking account: ${response.data.message}`);
    }

    const { user } = req;

    if (!user) {
      throw new UnauthorizedError("Unauthorized! Please log in as a user to continue");
    }

    const linked_accounts = (user?.linked_accounts || []).map((la) => la.id !== req.params.id)

    const updatedUser = await update(user._id, "linked_accounts", linked_accounts);

    console.log({ updatedUser });

    return res.status(200).json({ status: "success", data: { user: updatedUser } });
  } catch (error: any) {
    console.log({ error });
    next(error);
  }
}


