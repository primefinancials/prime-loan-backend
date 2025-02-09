import createApp from "./app";
import express from "express";
import http from "http";
import { connectToDB } from "./utils";
import { PORT } from "./config";
import { checkLoansAndSendEmails } from "./jobs/loanReminder";
import cron from 'node-cron';

cron.schedule('0 0 * * *', async () => {
  console.log('Running daily loan check...');
  await checkLoansAndSendEmails();
});

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
