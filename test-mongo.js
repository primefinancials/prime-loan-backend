const mongoose = require('mongoose');

const uri = "mongodb+srv://prime_loan_backend:0cO0noV1rlbB1QvF@cluster0.9ohvk.mongodb.net/prime-loan?retryWrites=true&w=majority&appName=Cluster0";

async function run() {
  try {
    console.log("Connecting...");
    await mongoose.connect(uri);
    console.log("Connected successfully!");
  } catch (error) {
    console.error("Connection error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected.");
  }
}

run();
