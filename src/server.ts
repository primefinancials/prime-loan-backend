import createApp from "./app";
import express from "express";
import http from "http";
import { connectToDB } from "./utils";
import { PORT } from "./config";

const startApp = async () => {
  const app = express();

  await connectToDB();

  await createApp(app);

  const server = http.createServer(app);

  server
    .listen(PORT, (): void => {
      console.log(`initiated User Service`);
    })
    .on("listening", () =>
      console.log(`User Service listening on port ${PORT}`)
    )
    .on("error", (err: any) => {
      console.log(err);
      process.exit();
    })
    .on("close", () => {
      
    });
};

startApp();
