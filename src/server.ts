import app from "./app";
import { connectToDB } from "./utils";
import { PORT } from "./config";

app.listen(PORT, async () => {
  await connectToDB();
  console.log(`initiated User Service`);
}).on("listening", () =>
  console.log(`User Service listening on port ${PORT}`)
).on("error", (err: any) => {
  console.log(err);
  process.exit();
}).on("close", () => {
  
});