// src/models/Profit.ts
import { Schema, model, Document } from "mongoose";

export interface Profit extends Document {
  reference: string; // transaction or trade ID
  userId: string;
  source: "transaction" | "bill-payment" | "loan" | "savings" | "escrow";
  amount: number;
  percentage: number;
  type: "realized" | "unrealized";
  isRealized: boolean;
  realizedAt?: Date;
  date: Date;
  description?: string;
}

const ProfitSchema = new Schema<Profit>(
  {
    reference: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    source: { type: String, enum: ["transaction", "bill-payment", "loan", "savings", "escrow"], required: true },
    amount: { type: Number, required: true },
    percentage: { type: Number, default: 0 },
    type: { type: String, enum: ["realized", "unrealized"], required: true },
    isRealized: { type: Boolean, required: true },
    realizedAt: { type: Date },
    date: { type: Date, default: Date.now },
    description: { type: String },
  },
  { timestamps: true }
);

export default model<Profit>("Profit", ProfitSchema);
