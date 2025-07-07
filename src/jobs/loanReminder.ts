import nodemailer from 'nodemailer';
import { LoanService, UserService, TransactionService } from "../services";
import { EMAIL_USERNAME, EMAIL_PASSWORD } from '../config';
import { generateRandomString } from '../utils/generateRef';
import { httpClient } from '../utils/httpClient';
import { sha512 } from 'js-sha512';
import { LoanApplication } from '../interfaces';
import mongoose from 'mongoose';

const transporter = nodemailer.createTransport({
  host: "smtp.mailgun.org",
  port: 465, // Use 587 for STARTTLS, 465 for SSL/TLS
  secure: true, // Set to `true` for port 465, `false` for 587
  auth: {
    user: EMAIL_USERNAME, // Example: brad@primefinance.live
    pass: EMAIL_PASSWORD, // Your Mailgun SMTP password
  },
});

const { create: createTransaction } = new TransactionService();
const { find, update } = new UserService();
const { find: findLoan, update: updateLoan } = new LoanService();

export async function checkLoansAndSendEmails() { 
  try {
    const overdueLoans = await findLoan({ 
      outstanding: { $gt: 0 },
      status: "accepted",
      repayment_date: { $lt: new Date().toISOString() } 
    }, "many");

    console.log({ overdueLoans });

    if (!overdueLoans || !Array.isArray(overdueLoans) || overdueLoans.length <= 0) {
      return;
    }

    for (const loan of overdueLoans) {
      try {
        const user = await find({ _id: loan.userId }, "one");
        if (!user || Array.isArray(user)) throw new Error(`User not found for loan ${loan._id}`);

        const userAccountRes = await httpClient(`/wallet2/account/enquiry?accountNumber=${user?.user_metadata.accountNo}`, "GET");
        if (!userAccountRes.data) throw new Error(`User account not found for loan ${loan._id}`);

        const userAccountData = userAccountRes.data.data;
        const userBalance = Number(userAccountData.accountBalance);

        const adminAccountRes = await httpClient(`/wallet2/account/enquiry?`, "GET");
        if (!adminAccountRes.data) throw new Error("Admin account not found");

        const adminAccountData = adminAccountRes.data.data;
        const ref = `Prime-Finance-${generateRandomString(9)}`;

        // Add overdue fee before repayment attempt
        await addOnePercentToOverdueLoan(loan);

        const deductionAmount = userBalance >= loan.outstanding ? loan.outstanding : userBalance;
        const remainingOutstanding = loan.outstanding - deductionAmount;

        if (deductionAmount > 0) {
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
            signature: sha512.hex(`${userAccountData.accountNo}${adminAccountData.accountNo}`),
            amount: deductionAmount,
            remark: "Loan Repayment",
            transferType: "intra",
            reference: ref
          };

          const transferRes = await httpClient("/wallet2/transfer", "POST", transferBody);
          const transactionStatus = transferRes.data?.status === "00" ? "success" : "failed";

          if (transferRes.data) {
            await updateLoan(loan._id, { 
              loan_payment_status: remainingOutstanding <= 0 ? "complete" : "in-progress", 
              outstanding: remainingOutstanding,
              repayment_history: [
                ...(loan.repayment_history || []), 
                { amount: deductionAmount, outstanding: remainingOutstanding, action: "repayment", date: new Date().toISOString() }
              ]
            });

            await update(user._id, "user_metadata.wallet", String(userBalance - deductionAmount));

            await createTransaction({
              name: "Loan Repayment",
              category: "debit",
              type: "loan",
              user: user._id,
              details: "Loan mandatory repayment",
              transaction_number: ref,
              amount: deductionAmount,
              bank: "Prime Finance - VFD",
              receiver: adminAccountData.accountNo,
              account_number: adminAccountData.accountNo,
              outstanding: remainingOutstanding,
              session_id: ref,
              status: transactionStatus,
              message: transferRes.data?.status || "Unknown",
            });
          }
        } 
      } catch (loanError) {
        console.error(`Loan ${loan._id}: Skipping due to error -`, loanError);
      }
    }
  } catch (error) {
    console.error("Error checking overdue loans:", error);
  }
}

async function addOnePercentToOverdueLoan(loan: LoanApplication) {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const today = new Date().toISOString().split("T")[0]; // Get YYYY-MM-DD format
      const lastInterestDate = loan.lastInterestAdded ? loan.lastInterestAdded.split("T")[0] : null;

      if (lastInterestDate === today) {
        return;
      }

      const overdueFee = Number(loan.amount) * 0.01;
      const newOutstanding = Number(loan.outstanding) + overdueFee;

      await updateLoan(loan._id, { 
        outstanding: newOutstanding,
        lastInterestAdded: today, // Update last interest added date
        repayment_history: [
          ...(loan.repayment_history || []), 
          { amount: overdueFee, outstanding: newOutstanding, action: "overdue_fee", date: new Date().toISOString() }
        ]
      });

      const user = await find({ _id: loan.userId }, "one");
  
      if(user && !Array.isArray(user))
        await sendEmail(user.email, 'Your Loan is Overdue', `Dear ${user.user_metadata.first_name}, Your loan payment of ${loan.outstanding} was due on ${loan.repayment_date}. Please make the payment immediately to avoid any futher late fees and penalties.`);
    })
  } catch (error) {
    console.error(`Loan ${loan._id}: Error adding overdue fee -`, error);
  } finally {
    await session.endSession();
  }
}

export const sendMessageForLoan = async () => {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const dueLoans = await findLoan(
    {
      repayment_date: new Date().toISOString(),
      outstanding: { $gt: 0 },
      status: "accepted"
    },
    "many"
  );

  console.log({ dueLoans });

  if (Array.isArray(dueLoans) && dueLoans.length > 0) {
    for (const loan of dueLoans) {
      const user = await find({ _id: loan.userId }, "one");
      if (user && !Array.isArray(user)) {
        await sendEmail(
          user.email,
          'Your Loan is Due Today',
          `Dear ${user.user_metadata.first_name}, Your loan payment of ${loan.outstanding} is due Today. Please make the payment immediately to avoid any further late fees and penalties.`
        );
      }
    }
  }

  const upcomingLoans = await findLoan(
    {
      repayment_date: tomorrow.toISOString(),
      outstanding: { $gt: 0 },
      status: "accepted"
    },
    "many"
  );

  console.log({ upcomingLoans });

  if (Array.isArray(upcomingLoans) && upcomingLoans.length > 0) {
    for (const loan of upcomingLoans) {
      const user = await find({ _id: loan.userId }, "one");
      if (user && !Array.isArray(user)) {
        await sendEmail(
          user.email,
          'Your Loan will be Due Tomorrow',
          `Dear ${user.user_metadata.first_name}, Your loan payment of ${loan.outstanding} will be due tomorrow. Please make the payment immediately to avoid any further late fees and penalties.`
        );
      }
    }
  }
};

export async function sendEmail(to: string, subject: string, text: string) {
  try {
    const info = await transporter.sendMail({
      from: "info@primefinance.live", // Must match Mailgun's verified domain
      to,
      subject,
      text,
    });
  } catch (error: any) {
    console.error(`❌ Email sending failed:`, error.message);
  }
}


