import createApp from "./app";
import express from "express";
import http from "http";
import { connectToDB } from "./utils";
import { PORT } from "./config";
import { checkLoansAndSendEmails } from "./jobs/loanReminder";
import cron from 'node-cron';
import { sendEmail } from "./jobs/loanReminder";

cron.schedule('0 */6 * * *', async () => {
  console.log('Running loan check every 6 hours...');
  await checkLoansAndSendEmails();
});

// cron.schedule('*/1 * * * *', async () => {
//   console.log('Running loan check every minute...');
//   await sendEmail("primefinancials68@gmail.com", 'Loan Overdue', `Test Email For Loan`);
// });

console.log('Cron job scheduled to check loans daily at midnight.');

const startApp = async () => {
  const app = express();

  await connectToDB();

  await createApp(app);

  const server = http.createServer(app);

  server.listen(PORT, (): void => {
    console.log(`initiated User Service`);
  }).on("listening", () =>
    console.log(`User Service listening on port ${PORT}`)
  ).on("error", (err: any) => {
    console.log(err);
    process.exit();
  }).on("close", () => {
    
  });
};

startApp();
