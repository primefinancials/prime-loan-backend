import { Schema, model, Document } from "mongoose";

/**
 * Profit Range Definition
 * Each range specifies how profit is computed per category
 */
export interface ProfitRange {
  maxAmount: number;
  minAmount: number;
  category: "bill-payment" | "transfer" | "loan" | "savings" | "escrow";
  type: "percentage" | "amount";
  amount: number;
  action: "send" | "receive"
  description: string;
}

/**
 * System Settings Interface
 * Singleton collection for all global platform configurations.
 */
export interface ISettings extends Document {
  autoLoanApproval: boolean; // enable/disable automatic loan approval
  maxLoanAmount: number;     // maximum loan amount allowed
  minCreditScore: number;    // minimum credit score required
  maxLoanTerm: number;       // maximum loan term (months or days)
  loanEnabled: boolean;      // toggle loan feature
  transferEnabled: boolean;  // toggle transfers
  transferDailyLimit: number;// daily transfer cap
  savingsEnabled: boolean;   // toggle savings
  billPaymentEnabled: boolean;// toggle bill payments
  savingsPenalty: number;    // penalty for early withdrawal
  savingsInterestRate: number;// e.g., 0.025 = 2.5%
  updatedBy: string;         // adminId who last updated
  updatedAt: Date;           // last updated timestamp
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  companyAddress: string;
  companyTimezone: string;
  maintenanceMode: boolean;  // put platform in maintenance mode
  singleton: string;
  profitRange: ProfitRange[];
}

/**
 * Profit Range Subschema
 */
const ProfitRangeSchema = new Schema<ProfitRange>(
  {
    maxAmount: { type: Number, required: true },
    minAmount: { type: Number, required: true },
    category: {
      type: String,
      enum: ["bill-payment", "transfer", "loan", "savings", "escrow"],
      required: true,
    },
    action: { type: String, enum: ["send", "receive"], default: "send" },
    type: { type: String, enum: ["percentage", "amount"], required: true },
    amount: { type: Number, default: 0 },
    description: { type: String, required: true }
  },
  { _id: false } // no need for _id in subdocs
);

/**
 * Settings Schema
 */
const SettingsSchema = new Schema<ISettings>(
  {
    autoLoanApproval: { type: Boolean, default: true },
    maxLoanAmount: { type: Number, default: 50000 }, // ₦50,000
    minCreditScore: { type: Number, default: 0.4 },
    maxLoanTerm: { type: Number, default: 12 }, // months/days

    loanEnabled: { type: Boolean, default: true },
    transferEnabled: { type: Boolean, default: true },
    transferDailyLimit: { type: Number, default: 500000 }, // ₦500k daily
    savingsEnabled: { type: Boolean, default: true },
    billPaymentEnabled: { type: Boolean, default: true },

    savingsPenalty: { type: Number, default: 0.15 }, // 15%
    savingsInterestRate: { type: Number, default: 0.025 }, // 2.5%

    companyName: { type: String, default: "Prime Finance" },
    companyPhone: { type: String, default: "+234-800-000-0000" },
    companyEmail: { type: String, default: "support@primefinance.live" },
    companyAddress: { type: String, default: "Lagos, Nigeria" },
    companyTimezone: { type: String, default: "Africa/Lagos" },

    maintenanceMode: { type: Boolean, default: false },

    updatedBy: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now },

    profitRange: {
      type: [ProfitRangeSchema],
      default: [
        {
          category: "transfer",
          type: "amount",
          minAmount: 100,
          maxAmount: 4999,
          amount: 8,
          action: "send",
          description: "Transfer Fee"
        },
        {
          category: "transfer",
          type: "amount",
          minAmount: 5000,
          maxAmount: 5000000,
          amount: 50,
          action: "receive",
          description: "VAT Fee"
        },
        {
          category: "loan",
          type: "percentage",
          minAmount: 0,
          maxAmount: 500000,
          action: "send",
          amount: 0.10, // 10%
          description: "Loan Interest"
        },
        {
          category: "loan",
          type: "amount",
          minAmount: 0,
          maxAmount: 500000,
          action: "send",
          amount: 500,
          description: "Service Fee"
        },
        {
          category: "bill-payment",
          type: "percentage",
          minAmount: 0,
          maxAmount: 100000,
          action: "send",
          amount: 0.03, // 3%
          description: "Bill Payment Commision"
        },
        {
          category: "savings",
          type: "percentage",
          minAmount: 0,
          maxAmount: 100000,
          action: "send",
          amount: 0.025, // 2.5%
          description: "Savings Interest"
        },
      ],
    },

    singleton: { type: String, default: "singleton", unique: true },
  },
  { collection: "settings", timestamps: true }
);

// ✅ Ensure there is always only one settings document
SettingsSchema.index({ singleton: 1 }, { unique: true });

/**
 * Pre-save hook to update timestamps and enforce singleton
 */
SettingsSchema.pre("save", async function (next) {
  const existing = await Settings.findOne({ singleton: "singleton" });
  if (existing && existing._id !== this._id) {
    throw new Error("Only one settings document allowed (singleton enforced).");
  }
  this.updatedAt = new Date();
  next();
});

/**
 * Static helper to get or initialize settings safely
 */
SettingsSchema.statics.getSingleton = async function () {
  let settings = await this.findOne({ singleton: "singleton" });
  if (!settings) {
    settings = await this.create({
      updatedBy: "system",
    });
  }
  return settings;
};

// ✅ Export model
export const Settings = model<ISettings>("Settings", SettingsSchema);
