import app from "./app";
import { connectToDB } from "./utils";
import { PORT } from "./config";

const startApp = async () => {
  await connectToDB();

  // const server = http.createServer(app);

  app.listen(3000, (): void => {
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
