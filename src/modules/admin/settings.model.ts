import { Schema, model, Document } from "mongoose";
import { getCollectionName } from '../../shared/utils/collection.utils';

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

  // Refined Savings Settings
  savings: {
    fixed: {
      minDuration: number; // deprecated, use minDurationMonths
      minDurationMonths: number; // minimum months (e.g., 3)
      interestRate: number; // percentage (e.g., 10 for 10%)
      penaltyRate: number;  // percentage (e.g., 5 for 5%)
      earlyWithdrawal: {
        type: 'immediate' | 'delayed';
        delayDays: number;
      };
    };
    flexible: {
      interestRate: number; // percentage
      standard: {
        penaltyRate: number; // percentage
        withdrawalDelayHours: number; // delay in hours
        locked: boolean;
      };
      instant: {
        penaltyRate: number; // percentage
        locked: boolean;
      };
    };
    autoSave: {
      retryEnabled: boolean;
      maxRetries: number;
    };
  };

  // Refined Loan Settings
  loan: {
    minCreditScore: number;
    autoApprovalLimit: number;
    collateral: {
      percentage: number; // percentage of savings
    };
    ladder: {
      levels: { minScore: number; maxAmount: number; interestRate: number; duration: number }[];
      defaultInterest: number;
    };
    penalty: {
      dailyRate: number;
      gracePeriod: number; // days
    };
  };

  // System Settings
  system: {
    currency: string;
    maintenanceMode: boolean;
  };

  transferEnabled: boolean;  // toggle transfers
  transferDailyLimit: number;// daily transfer cap
  savingsEnabled: boolean;   // toggle savings
  billPaymentEnabled: boolean;// toggle bill payments

  // Deprecated flat fields (kept for backward compatibility during migration)
  savingsPenalty?: number;
  savingsInterestRate?: number;
  maintenanceMode?: boolean;

  updatedBy: string;         // adminId who last updated
  updatedAt: Date;           // last updated timestamp
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  companyAddress: string;
  companyTimezone: string;
  singleton: string;
  profitRange: ProfitRange[];
  defaulterCallConfig: {
    enabled: boolean;
    maxCallsPerDay: number;
    message: string;
  };
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

    // Savings Config
    savings: {
      fixed: {
        minDuration: { type: Number, default: 30 }, // deprecated
        minDurationMonths: { type: Number, default: 3 }, // 3 months minimum
        interestRate: { type: Number, default: 10 },
        penaltyRate: { type: Number, default: 5 },
        earlyWithdrawal: {
          type: { type: String, enum: ['immediate', 'delayed'], default: 'immediate' },
          delayDays: { type: Number, default: 0 }
        }
      },
      flexible: {
        interestRate: { type: Number, default: 0 },
        standard: {
          penaltyRate: { type: Number, default: 2.5 }, // Lower penalty for standard
          withdrawalDelayHours: { type: Number, default: 24 }, // 24 hours delay default
          locked: { type: Boolean, default: true }
        },
        instant: {
          penaltyRate: { type: Number, default: 5 }, // Higher penalty for instant
          locked: { type: Boolean, default: true }
        }
      },
      autoSave: {
        retryEnabled: { type: Boolean, default: true },
        maxRetries: { type: Number, default: 3 }
      }
    },

    // Loan Config
    loan: {
      minCreditScore: { type: Number, default: 0.4 },
      autoApprovalLimit: { type: Number, default: 50000 },
      collateral: {
        percentage: { type: Number, default: 50 }
      },
      ladder: {
        levels: [{
          minScore: { type: Number },
          maxAmount: { type: Number },
          interestRate: { type: Number },
          duration: { type: Number }
        }],
        defaultInterest: { type: Number, default: 5 }
      },
      penalty: {
        dailyRate: { type: Number, default: 10 },
        gracePeriod: { type: Number, default: 1 }
      }
    },

    // System Config
    system: {
      currency: { type: String, default: "NGN" },
      maintenanceMode: { type: Boolean, default: false }
    },

    // Backward compatibility defaults
    savingsPenalty: { type: Number, default: 0.15 },
    savingsInterestRate: { type: Number, default: 0.025 },

    companyName: { type: String, default: "Prime Finance" },
    companyPhone: { type: String, default: "+234-800-000-0000" },
    companyEmail: { type: String, default: "support@primefinance.live" },
    companyAddress: { type: String, default: "Lagos, Nigeria" },
    companyTimezone: { type: String, default: "Africa/Lagos" },

    maintenanceMode: { type: Boolean, default: false },

    updatedBy: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now },

    defaulterCallConfig: {
      enabled: { type: Boolean, default: false },
      maxCallsPerDay: { type: Number, default: 1 },
      message: { type: String, default: "This is a reminder from Prime Finance. You have an overdue loan payment. Please pay immediately to avoid penalties." }
    },

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
        {
          category: "escrow",
          type: "percentage",
          minAmount: 0,
          maxAmount: 10000000,
          action: "send",
          amount: 0.015, // 1.5%
          description: "Escrow Platform Fee"
        }
      ],
    },

    singleton: { type: String, default: "singleton", unique: true },
  },
  { collection: getCollectionName("settings"), timestamps: true }
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
