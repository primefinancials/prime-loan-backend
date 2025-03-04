import nodemailer from 'nodemailer';
import { LoanService, UserService, TransactionService } from "../services";
import { EMAIL_USERNAME, EMAIL_PASSWORD } from '../config';
import { generateRandomString } from '../utils/generateRef';
import { httpClient } from '../utils/httpClient';
import { sha512 } from 'js-sha512';

console.log({ EMAIL_USERNAME, EMAIL_PASSWORD })

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
    console.log('Checking overdue loans');

    const overdueLoans = await findLoan({ 
      $expr: {
        $and: [
          {
            $lt: [
              { 
                $dateFromString: { 
                  dateString: "$repayment_date", 
                  format: "%b %d, %Y", // Matches "Mar 02, 2025"
                  timezone: "UTC"      // Optional: Align with your timezone
                } 
              },
              { 
                $dateFromParts: { // Get start of today (midnight)
                  year: { $year: "$$NOW" },
                  month: { $month: "$$NOW" },
                  day: { $dayOfMonth: "$$NOW" },
                  timezone: "UTC" // Match your timezone
                } 
              }
            ]
          },
          { $gt: ["$outstanding", 0] },
          { $eq: ["$status", "accepted"] }
        ]
      }
     }, "many");

     console.log({ overdueLoans });

    if(overdueLoans && Array.isArray(overdueLoans) && overdueLoans.length > 0) {
      console.log("In Overdue Loans");
      for (const loan of overdueLoans) {
          const user = await find({ _id: loan.userId }, "one");

          if(user && !Array.isArray(user)) {
              const account = await httpClient(`/wallet2/account/enquiry?`, "GET");
              console.log({ account, data: account.data.data })
          
              const useraccount = await httpClient(`/wallet2/account/enquiry?accountNumber=${user?.user_metadata.accountNo}`, "GET");
              console.log({ useraccount, data: useraccount.data.data })
              
              if(account.data && useraccount.data) {
                  const { accountNo: userAccountNumber, accountBalance: userAccountBalance, accountId: userAccountId, client: userClient, clientId: userClientId, savingsProductName: userSavingsProductName } = useraccount.data.data;
                  const { accountNo, accountBalance, accountId, client, clientId, savingsProductName } = account.data.data;
                  const ref =`Prime-Finance-${generateRandomString(9)}`;

                  const amount = Number(user.user_metadata.wallet) >= Number(loan.outstanding)? Number(loan.outstanding) : Number(user.user_metadata.wallet);
          
                  const body = {
                      fromAccount: userAccountNumber,
                      uniqueSenderAccountId: userAccountId,
                      fromClientId: userClientId,
                      fromClient: userClient,
                      fromSavingsId: userAccountId,
                      // fromBvn: "Rolandpay-birght 221552585559",
                      toClientId: clientId,
                      toClient: client,
                      toSavingsId: accountId,
                      toSession: accountId,
                      // toBvn: "11111111111",
                      toAccount: accountNo,
                      toBank: "999999",
                      signature: sha512.hex(`${userAccountNumber}${accountNo}`),
                      amount,
                      remark: "Loan Repayment",
                      transferType: "intra",
                      reference: ref
                  }
                  
                  const response = await httpClient("/wallet2/transfer", "POST", body);
          
                  console.log({ response });
          
                  if(response.data) {
                      await updateLoan(loan._id, { 
                          loan_payment_status: (Number(loan.outstanding) - Number(amount)) <= 0? "complete" : "in-progress", 
                          outstanding: Number(loan.outstanding) - Number(amount),
                          repayment_history: [ ...(loan.repayment_history || []), { amount: Number(amount), outstanding: Number(loan.outstanding) - Number(amount), action: "repayment", date: new Date().toLocaleString() }]
                      });
                      
                      await update(
                          user._id,
                          "user_metadata.wallet",
                          String(Number(user?.user_metadata?.wallet) - Number(amount)) 
                      );
          
                      const transactionStatus = response.data.status === "00" ? "success" : "failed";
          
                      // Insert transaction record into database
                      await createTransaction(
                          {
                              name: "Loan Repayment",
                              category: "debit",
                              type: "loan",
                              user: user._id,
                              details: "Loan mandatory repayment",
                              transaction_number: ref,
                              amount,
                              bank: "Prime Finance - VFD",
                              receiver: accountNo,
                              account_number: accountNo,
                              outstanding:  Number(loan.outstanding) - Number(amount),
                              session_id: ref,
                              status: transactionStatus,
                              message: response.data.status,
                          }
                      )
                  }
              }
          }
      }

      console.log({ overdueLoans, todays_date: new Date(new Date().toISOString()) })
    }
  } catch(error: any) {
    console.log({ error })
  }
}

export async function addOnePercentToOverdueLoan() {
  try {
    console.log('Checking loans and adding percentage...');
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const formatDate = (date: Date) => {
      // Format the date as "DD MMM YYYY"
      const options: Intl.DateTimeFormatOptions = {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
      };

      return date.toLocaleDateString('en-US', options);
    };

    const todayStr = formatDate(today);
    const tomorrowStr = formatDate(tomorrow);

    const overdueLoans = await findLoan(
      {
        $expr: {
          $and: [
            {
              $lt: [
                { 
                  $dateFromString: { 
                    dateString: "$repayment_date", 
                    format: "%b %d, %Y", // Matches "Mar 02, 2025"
                    timezone: "UTC"      // Optional: Align with your timezone
                  } 
                },
                { 
                  $dateFromParts: { // Get start of today (midnight)
                    year: { $year: "$$NOW" },
                    month: { $month: "$$NOW" },
                    day: { $dayOfMonth: "$$NOW" },
                    timezone: "UTC" // Match your timezone
                  } 
                }
              ]
            },
            { $gt: ["$outstanding", 0] },
            { $eq: ["$status", "accepted"] }
          ]
        }
      },
      "many"
    );

    const dueLoans = await findLoan(
      {
        repayment_date: todayStr,
        outstanding: { $gt: 0 }, // Condition for outstanding > 0
        status: "accepted"
      },
      "many"
    );

    const upcomingLoans = await findLoan(
      {
        repayment_date: tomorrowStr,
        outstanding: { $gt: 0 }, // Condition for outstanding > 0
        status: "accepted"
      },
      "many"
    );   

    if(dueLoans && Array.isArray(dueLoans) && dueLoans.length > 0) {
      console.log("In Upcoming Loans");
      for (const loan of dueLoans) {
          const user = await find({ _id: loan.userId }, "one");
          if(user && !Array.isArray(user))
            await sendEmail(user.email, 'Loan is Due Today', `Your loan is due on Today. Please make your payment.`);
      }
    }

    if(upcomingLoans && Array.isArray(upcomingLoans) && upcomingLoans.length > 0) {
      console.log("In Upcoming Loans");
      for (const loan of upcomingLoans) {
          const user = await find({ _id: loan.userId }, "one");
          if(user && !Array.isArray(user))
            await sendEmail(user.email, 'Loan Due Soon', `Your loan is due on ${loan.repayment_date}. Please make your payment.`);
      }
    }

    if(overdueLoans && Array.isArray(overdueLoans) && overdueLoans.length > 0) {
      console.log("In Overdue Loans");
      for (const loan of overdueLoans) {
        await updateLoan(loan._id, { 
          outstanding: Number(loan.outstanding) + (Number(loan.amount) * 0.01)
        });

        const user = await find({ _id: loan.userId }, "one");

        if(user && !Array.isArray(user))
          await sendEmail(user.email, 'Loan Overdue', `Your loan was due on ${loan.repayment_date}. Please make the repayment immediately.`);
      }
    }
  } catch(error: any) {
    console.log({ error })
  }
}

export async function sendEmail(to: string, subject: string, text: string) {
  try {
    const info = await transporter.sendMail({
      from: "primefinance@primefinance.live", // Must match Mailgun's verified domain
      to,
      subject,
      text,
    });
    console.log(`✅ Email sent to ${to}: ${subject}`, info.messageId);
  } catch (error: any) {
    console.error(`❌ Email sending failed:`, error.message);
  }
}


