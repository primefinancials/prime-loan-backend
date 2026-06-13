import { Schema, model, Document, Types } from "mongoose";
import { getCollectionName } from '../../shared/utils/collection.utils';

/**
 * Profit Range Definition
 * Each range specifies how profit is computed per category
 */
export interface ProfitRange {
  maxAmount: number;
  minAmount: number;
  category: "bill-payment" | "transfer" | "loan" | "savings" | "escrow" | "marketplace";
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
    reminders: {
      dueTomorrow: string;
      dueToday: string;
      overdue: string;
    };
    serviceFee: number;
    interest: { percentage: boolean; value: number; }
    signupBonus?: number;
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
    messageTemplates?: {
      tier1: { daysMin: number; daysMax: number; maxCallsPerDay: number; smsTemplate: string };
      tier2: { daysMin: number; daysMax: number; maxCallsPerDay: number; smsTemplate: string };
      tier3: { daysMin: number; daysMax: number; maxCallsPerDay: number; smsTemplate: string };
      tier4: { daysMin: number; daysMax: number; maxCallsPerDay: number; smsTemplate: string; sendEmail: boolean };
    };
  };
  workersConfig: Types.Map<{
    enabled: boolean;
    cronSchedule?: string;
  }>;

  // --- V2 Integration Fields ---

  // Bill payment provider toggle
  billPaymentProvider: 'flutterwave' | 'vfd';

  // Influencer commission config
  influencer: {
    enabled: boolean;
    commissionRates: {
      loan: number;
      escrow: number;
      savings: number;
      'bill-payment': number;
      marketplace: number;
      signup_bonus: number;  // flat amount in naira
    };
    minPayoutAmount: number;
  };

  // Flutterwave auto-debit config (replaces monoAutoDebit)
  autoDebit: {
    enabled: boolean;
    cardEnabled: boolean;
    bankEnabled: boolean;
    maxDebitAttempts: number;
    minDebitAmount: number;
  };

  voiceCallProvider: 'termii' | 'africastalking'; // legacy field, use voiceCallConfig.provider
  voiceCallConfig: {
    provider: 'termii' | 'africastalking';
    atCallFromNumbers: string[];      // Africa's Talking virtual numbers — randomly rotated
    termiiSenderIds: string[];        // Termii sender IDs — randomly rotated
  };

  // Default/Late Charge Configuration
  chargeConfiguration: {
    enabled: boolean;
    type: 'PERCENTAGE' | 'FIXED_AMOUNT';
    percentageValue?: number;  // e.g., 1 for 1%
    fixedAmountValue?: number;  // e.g., 50 naira
    calculationBase: 'PRINCIPAL_ONLY' | 'PRINCIPAL_PLUS_INTEREST_AND_FEES';
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
      enum: ["bill-payment", "transfer", "loan", "savings", "escrow", "marketplace"],
      required: true,
    },
    action: { type: String, enum: ["send", "receive"], default: "send" },
    type: { type: String, enum: ["percentage", "amount"], required: true },
    amount: { type: Number, default: 0 },
    description: { type: String, required: true }
  },
  { _id: true } // enable _id for individual fee entry CRUD
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
          interestRate: { type: Number, default: 0 },
          penaltyRate: { type: Number, default: 2.5 }, // Lower penalty for standard
          withdrawalDelayHours: { type: Number, default: 24 }, // 24 hours delay default
          locked: { type: Boolean, default: true }
        },
        instant: {
          interestRate: { type: Number, default: 0 },
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
      signupBonus: { type: Number, default: 100 },
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
        dailyRate: { type: Number, default: 1 },
        gracePeriod: { type: Number, default: 1 }
      },
      reminders: {
        dueTomorrow: { type: String, default: "Your loan is due tomorrow. Please ensure your wallet is funded." },
        dueToday: { type: String, default: "Your loan is due today. Please fund your wallet to avoid penalties." },
        overdue: { type: String, default: "Your loan is overdue. Penalties are now being applied." }
      },
      serviceFee: { type: Number, default: 500 },
      interest: {
        percentage: { type: Boolean, default: true },
        value: { type: Number, default: 10 }
      }
    },

    // System Config
    system: {
      currency: { type: String, default: "NGN" },
      maintenanceMode: { type: Boolean, default: false }
    },

    // Backward compatibility defaults
    savingsPenalty: { type: Number, default: 15 },
    savingsInterestRate: { type: Number, default: 2.5 },

    companyName: { type: String, default: "Prime Loan" },
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
      message: { type: String, default: "This is a reminder from Prime Loan. You have an overdue loan payment. Please pay immediately to avoid penalties." },
      messageTemplates: {
        tier1: {
          daysMin: { type: Number, default: 1 },
          daysMax: { type: Number, default: 3 },
          maxCallsPerDay: { type: Number, default: 1 },
          smsTemplate: { type: String, default: 'Dear {name}, your loan of {amount} naira was due on {date}. Please make payment to avoid penalties. Thank you.' }
        },
        tier2: {
          daysMin: { type: Number, default: 4 },
          daysMax: { type: Number, default: 7 },
          maxCallsPerDay: { type: Number, default: 2 },
          smsTemplate: { type: String, default: 'Urgent reminder. Your loan is {days} days overdue. A daily penalty is being applied. Outstanding: {outstanding} naira. Pay now.' }
        },
        tier3: {
          daysMin: { type: Number, default: 8 },
          daysMax: { type: Number, default: 14 },
          maxCallsPerDay: { type: Number, default: 3 },
          smsTemplate: { type: String, default: 'Final warning. Failure to pay {outstanding} naira within 48 hours may result in your account being flagged. Pay immediately.' }
        },
        tier4: {
          daysMin: { type: Number, default: 15 },
          daysMax: { type: Number, default: 999 },
          maxCallsPerDay: { type: Number, default: 3 },
          smsTemplate: { type: String, default: 'Notice. Your account has been flagged for review. Outstanding: {outstanding} naira. Contact support immediately.' },
          sendEmail: { type: Boolean, default: true }
        }
      }
    },

    workersConfig: {
      type: Map,
      of: new Schema({
        enabled: { type: Boolean, default: true },
        cronSchedule: { type: String }
      }, { _id: false }),
      default: {}
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
          amount: 10, // 10%
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
          amount: 3, // 3%
          description: "Bill Payment Commision"
        },
        {
          category: "savings",
          type: "percentage",
          minAmount: 0,
          maxAmount: 100000,
          action: "send",
          amount: 2.5, // 2.5%
          description: "Savings Interest"
        },
        {
          category: "escrow",
          type: "percentage",
          minAmount: 0,
          maxAmount: 10000000,
          action: "send",
          amount: 1.5, // 1.5%
          description: "Escrow Platform Fee"
        },
        {
          category: "marketplace",
          type: "percentage",
          minAmount: 0,
          maxAmount: 10000000,
          action: "send",
          amount: 7.5, // 7.5%
          description: "VAT"
        },
        {
          category: "marketplace",
          type: "percentage",
          minAmount: 0,
          maxAmount: 10000000,
          action: "send",
          amount: 1.5, // 1.5%
          description: "Marketplace Escrow Service Fee"
        }
      ],
    },

    singleton: { type: String, default: "singleton", unique: true },

    // --- V2 Integration Fields ---

    // Bill payment provider toggle
    billPaymentProvider: {
      type: String,
      enum: ['flutterwave', 'vfd'],
      default: 'vfd'
    },

    // Influencer commission configuration
    influencer: {
      enabled: { type: Boolean, default: true },
      commissionRates: {
        loan: { type: Number, default: 2.5 },
        escrow: { type: Number, default: 1.5 },
        savings: { type: Number, default: 1.0 },
        'bill-payment': { type: Number, default: 1.0 },
        marketplace: { type: Number, default: 2.0 },
        signup_bonus: { type: Number, default: 100 }
      },
      minPayoutAmount: { type: Number, default: 1000 }
    },

    // Flutterwave auto-debit configuration (replaces monoAutoDebit)
    autoDebit: {
      enabled: { type: Boolean, default: true },
      cardEnabled: { type: Boolean, default: true },
      bankEnabled: { type: Boolean, default: true },
      maxDebitAttempts: { type: Number, default: 3 },
      minDebitAmount: { type: Number, default: 100 }
    },

    voiceCallProvider: {
      type: String,
      enum: ['termii', 'africastalking'],
      default: 'termii'
    },

    // Voice call config V2 (number rotation + provider)
    voiceCallConfig: {
      provider: {
        type: String,
        enum: ['termii', 'africastalking'],
        default: 'termii'
      },
      atCallFromNumbers: {
        type: [String],
        default: []
      },
      termiiSenderIds: {
        type: [String],
        default: ['Prime Loan']
      }
    },

    // Default/Late Charge Configuration (Fix #4.2)
    chargeConfiguration: {
      enabled: { type: Boolean, default: true },
      type: {
        type: String,
        enum: ['PERCENTAGE', 'FIXED_AMOUNT'],
        default: 'PERCENTAGE'
      },
      percentageValue: { type: Number, default: 1 }, // 1%
      fixedAmountValue: { type: Number, default: 0 },
      calculationBase: {
        type: String,
        enum: ['PRINCIPAL_ONLY', 'PRINCIPAL_PLUS_INTEREST_AND_FEES'],
        default: 'PRINCIPAL_PLUS_INTEREST_AND_FEES' // NEW FORMULA
      }
    },
  },
  { collection: getCollectionName("settings"), timestamps: true }
);

// ✅ Ensure there is always only one settings document
SettingsSchema.index({ singleton: 1 }, { unique: true });

/**
 * Pre-save hook to update timestamps and enforce singleton
 */
SettingsSchema.pre("save", async function (next) {
  if (!this.isNew) {
    // Existing document being updated — no singleton violation
    this.updatedAt = new Date();
    return next();
  }
  const existing = await Settings.findOne({ singleton: "singleton" });
  if (existing && !(existing as any)._id.equals(this._id)) {
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
