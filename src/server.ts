import createApp from "./app";
import express from "express";
import http from "http";
import { connectToDB } from "./utils";
import { PORT } from "./config";
import { checkLoansAndSendEmails, sendMessageForLoan } from "./jobs/loanReminder";
import cron from 'node-cron';

let lastRun = Date.now();

cron.schedule('*/9 * * * *', async () => {
  console.log('Running loan check...');
  await checkLoansAndSendEmails();
});

cron.schedule('0 * * * *', async () => {
  const now = Date.now();
  const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);

  if (hoursSinceLastRun >= 23) {
    console.log('Running send email...');
    await sendMessageForLoan();
    lastRun = now; // Update the last run time
  }
});

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
