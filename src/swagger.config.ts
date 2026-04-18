/**
 * swagger.config.ts
 *
 * Centralized OpenAPI (Swagger) configuration for Prime Loan API
 * - Centralized schemas for Users, Admin, Loans, Transfers, Bills, Savings
 * - Standardized Success / Error response wrappers
 * - Reusable parameter schemas (pagination / date range)
 * - Helpful swagger-ui options for developer ergonomics
 *
 * NOTE:
 * - Keep your Joi validation schemas in sync with these schemas (single source of truth is recommended).
 * - Use $ref in your route files for request/response bodies, e.g.:
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserRequest'
 *
 * - If you want swagger-jsdoc to pick up JSDoc comments across modules, ensure `apis` globs match your project structure.
 */

import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options: any = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Prime Loan API",
      version: "2.0.0",
      description:
        "Comprehensive financial services API covering loans, transfers, bill payments, savings, and backoffice administration.",
      contact: {
        name: "Prime Loan Support",
        email: "support@primefinance.live",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
      {
        url: "https://staging.primefinance.live",
        description: "Staging server",
      },
      {
        url: "https://api.primefinance.live",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },

      // Common reusable parameters (for referencing in route JSDoc)
      parameters: {
        PageParam: {
          name: "page",
          in: "query",
          schema: { type: "integer", default: 1 },
          description: "Page number",
        },
        LimitParam: {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 20 },
          description: "Items per page",
        },
        FromDateParam: {
          name: "from",
          in: "query",
          schema: { type: "string", format: "date-time" },
          description: "Start datetime (ISO 8601)",
        },
        ToDateParam: {
          name: "to",
          in: "query",
          schema: { type: "string", format: "date-time" },
          description: "End datetime (ISO 8601)",
        },
      },

      schemas: {
        /*******************
         * Generic wrappers
         *******************/
        Success: {
          type: "object",
          properties: {
            status: { type: "string", example: "success" },
            data: { type: "object" },
            message: { type: "string" },
          },
        },
        Error: {
          type: "object",
          properties: {
            status: { type: "string", example: "error" },
            message: { type: "string" },
            requestId: { type: "string" },
            traceId: { type: "string" },
            errors: { type: "array", items: { type: "object" } },
          },
        },

        // Generic pagination envelope
        PaginatedList: {
          type: "object",
          properties: {
            items: { type: "array", items: { type: "object" } },
            total: { type: "integer" },
            page: { type: "integer" },
            limit: { type: "integer" },
          },
        },

        /*******************
         * Auth / User
         *******************/
        CreateUserRequest: {
          type: "object",
          required: ["email", "name", "surname", "password", "phone", "bvn", "pin", "nin", "dob"],
          properties: {
            email: { type: "string", format: "email" },
            name: { type: "string" },
            surname: { type: "string" },
            password: { type: "string", minLength: 6 },
            phone: { type: "string" },
            bvn: { type: "string", minLength: 11, maxLength: 11 },
            pin: { type: "string", minLength: 4, maxLength: 4 },
            nin: { type: "string", minLength: 11, maxLength: 11 },
            dob: { type: "string", description: "Date of birth (ISO or dd/mm/yyyy)" },
          },
        },

        LoginRequest: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string" },
            password: { type: "string" },
          },
        },

        AuthTokens: {
          type: "object",
          properties: {
            accessToken: { type: "string" },
            refreshToken: { type: "string" },
            expiresIn: { type: "integer", description: "access token lifetime in seconds" },
            tokenType: { type: "string", example: "Bearer" },
          },
        },

        User: {
          type: "object",
          properties: {
            _id: { type: "string" },
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["user", "admin", "super_admin"] },
            status: { type: "string", enum: ["active", "inactive"] },
            user_metadata: {
              type: "object",
              properties: {
                first_name: { type: "string" },
                surname: { type: "string" },
                phone: { type: "string" },
                accountNo: { type: "string" },
                wallet: { type: "string" },
                creditScore: { type: "number" },
                ladderIndex: { type: "number" },
              },
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },

        LoginResponse: {
          allOf: [
            { $ref: "#/components/schemas/Success" },
            {
              type: "object",
              properties: {
                data: {
                  type: "object",
                  properties: {
                    tokens: { $ref: "#/components/schemas/AuthTokens" },
                    user: { $ref: "#/components/schemas/User" },
                  },
                },
              },
            },
          ],
        },

        ChangePasswordRequest: {
          type: "object",
          required: ["oldPassword", "newPassword"],
          properties: {
            oldPassword: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },

        InitiateResetRequest: {
          type: "object",
          required: ["email", "type"],
          properties: {
            email: { type: "string", format: "email" },
            type: { type: "string", enum: ["password", "pin"] },
          },
        },

        ValidateResetRequest: {
          type: "object",
          required: ["email", "pin"],
          properties: {
            email: { type: "string", format: "email" },
            pin: { type: "string" },
          },
        },

        UpdatePasswordOrPinRequest: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
            newPassword: { type: "string" },
            newPin: { type: "string" },
          },
        },

        UpdateUserRequest: {
          type: "object",
          required: ["field", "value"],
          properties: {
            field: { type: "string", description: "field path to update, e.g. user_metadata.phone" },
            value: { type: "string" },
          },
        },

        /*******************
         * Transfers
         *******************/
        TransferInitiateRequest: {
          type: "object",
          required: ["fromAccount", "toAccount", "amount", "transferType"],
          properties: {
            fromAccount: { type: "string", description: "Sender account number" },
            fromClientId: { type: "string" },
            fromClient: { type: "string" },
            fromSavingsId: { type: "string" },
            fromBvn: { type: "string" },
            toClient: { type: "string" },
            toClientId: { type: "string" },
            toSession: { type: "string" },
            toAccount: { type: "string", description: "Beneficiary account number" },
            toSavingsId: { type: "string" },
            toBvn: { type: "string" },
            toBank: { type: "string", description: 'Bank code; use "999999" for internal transfers' },
            toKyc: {
              description: "Flexible KYC field",
              oneOf: [{ type: "string" }, { type: "object" }, { type: "boolean" }],
            },
            amount: { type: "number", description: "Amount (Naira)" },
            transferType: { type: "string", enum: ["intra", "inter"] },
            remark: { type: "string" },
            idempotencyKey: { type: "string" },
            // optional: metadata
            metadata: { type: "object" },
          },
        },

        TransferStatusQuery: {
          type: "object",
          properties: {
            reference: { type: "string", description: "Provider/reference ID for the transfer" },
            sessionId: { type: "string", description: "Provider session identifier" },
          },
        },

        WalletAlertRequest: {
          type: "object",
          required: ["account_number", "amount", "reference", "session_id"],
          properties: {
            account_number: { type: "string" },
            amount: { type: "number" },
            originator_account_name: { type: "string" },
            originator_account_number: { type: "string" },
            originator_bank: { type: "string" },
            originator_narration: { type: "string" },
            reference: { type: "string" },
            session_id: { type: "string" },
          },
        },

        Transfer: {
          type: "object",
          properties: {
            _id: { type: "string" },
            userId: { type: "string" },
            traceId: { type: "string" },
            fromAccount: { type: "string" },
            toAccount: { type: "string" },
            amount: { type: "number" },
            status: { type: "string", enum: ["PENDING", "COMPLETED", "FAILED"] },
            transferType: { type: "string", enum: ["intra", "inter"] },
            providerResponse: { type: "object" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },

        TransferResponse: {
          allOf: [
            { $ref: "#/components/schemas/Success" },
            {
              type: "object",
              properties: {
                data: { $ref: "#/components/schemas/Transfer" },
              },
            },
          ],
        },

        TransfersPaginatedResponse: {
          allOf: [
            { $ref: "#/components/schemas/Success" },
            {
              type: "object",
              properties: {
                data: {
                  type: "object",
                  properties: {
                    page: { type: "integer" },
                    limit: { type: "integer" },
                    total: { type: "integer" },
                    items: { type: "array", items: { $ref: "#/components/schemas/Transfer" } },
                  },
                },
              },
            },
          ],
        },

        /*******************
         * Bills / ClubConnect
         *******************/
        BillPaymentRequest: {
          type: "object",
          required: ["amount", "serviceType", "customerReference"],
          properties: {
            amount: { type: "number" },
            serviceType: { type: "string", enum: ["airtime", "data", "tv", "power", "betting", "internet", "waec", "jamb"] },
            serviceId: { type: "string", description: "provider service id (data plan id, cable id, etc.)" },
            customerReference: { type: "string", description: "target account/number (mobile number, meter number, smartcard)" },
            extras: { type: "object", description: "service-specific extras" },
            idempotencyKey: { type: "string" },
          },
        },

        BillPayment: {
          type: "object",
          properties: {
            _id: { type: "string" },
            userId: { type: "string" },
            serviceType: { type: "string" },
            amount: { type: "number" },
            status: { type: "string", enum: ["PENDING", "COMPLETED", "FAILED"] },
            customerReference: { type: "string" },
            providerTxnId: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },

        TvVerifyRequest: {
          type: "object",
          required: ["cableTV", "smartCardNo"],
          properties: {
            cableTV: { type: "string" },
            smartCardNo: { type: "string" },
          },
        },

        PowerVerifyRequest: {
          type: "object",
          required: ["electricCompany", "meterNo"],
          properties: {
            electricCompany: { type: "string" },
            meterNo: { type: "string" },
          },
        },

        BettingVerifyRequest: {
          type: "object",
          required: ["bettingCompany", "customerId"],
          properties: {
            bettingCompany: { type: "string" },
            customerId: { type: "string" },
          },
        },

        SmileVerifyRequest: {
          type: "object",
          required: ["mobileNumber"],
          properties: {
            mobileNumber: { type: "string" },
          },
        },

        JambVerifyRequest: {
          type: "object",
          required: ["examType", "profileId"],
          properties: {
            examType: { type: "string" },
            profileId: { type: "string" },
          },
        },

        /*******************
         * Loans
         *******************/
        CreateLoanRequest: {
          type: "object",
          required: ["first_name", "last_name", "dob", "nin", "email", "bvn", "phone", "amount", "reason", "category", "duration", "repayment_amount", "acknowledgment"],
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
            dob: { type: "string", example: "1995-07-20" },
            doi: { type: "string", description: "Date of incorporation (for businesses)" },
            nin: { type: "string" },
            tin: { type: "string" },
            email: { type: "string", format: "email" },
            bvn: { type: "string" },
            phone: { type: "string" },
            address: { type: "string" },
            company: { type: "string" },
            company_address: { type: "string" },
            annual_income: { type: "string" },
            guarantor_1_name: { type: "string" },
            guarantor_1_phone: { type: "string" },
            guarantor_2_name: { type: "string" },
            guarantor_2_phone: { type: "string" },
            amount: { type: "number" },
            reason: { type: "string" },
            base64Image: { type: "string" },
            outstanding: { type: "number" },
            category: { type: "string" },
            type: { type: "string" },
            status: { type: "string" },
            duration: { type: "string" },
            repayment_amount: { type: "number" },
            percentage: { type: "number" },
            loan_date: { type: "string", format: "date-time" },
            repayment_date: { type: "string", format: "date-time" },
            acknowledgment: { type: "boolean" },
          },
        },

        RepayLoanRequest: {
          type: "object",
          required: ["transactionId", "amount", "outstanding"],
          properties: {
            transactionId: { type: "string" },
            amount: { type: "number" },
            outstanding: { type: "number" },
            paymentMethod: { type: "string" },
            metadata: { type: "object" },
          },
        },

        Loan: {
          type: "object",
          properties: {
            _id: { type: "string" },
            userId: { type: "string" },
            amount: { type: "number" },
            outstanding: { type: "number" },
            status: { type: "string", enum: ["pending", "accepted", "rejected"] },
            loan_payment_status: { type: "string", enum: ["not-started", "in-progress", "complete"] },
            repayment_date: { type: "string", format: "date-time" },
            category: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },

        LoanResponse: {
          allOf: [
            { $ref: "#/components/schemas/Success" },
            {
              type: "object",
              properties: {
                data: { $ref: "#/components/schemas/Loan" },
              },
            },
          ],
        },

        /*******************
         * Savings
         *******************/
        CreatePlanRequest: {
          type: "object",
          required: ["planType", "planName", "amount"],
          properties: {
            planType: { type: "string", enum: ["LOCKED", "FLEXIBLE"] },
            planName: { type: "string" },
            targetAmount: { type: "number" },
            durationDays: { type: "integer" },
            amount: { type: "number" },
            interestRate: { type: "number" },
            renew: { type: "boolean" },
          },
        },

        WithdrawRequest: {
          type: "object",
          required: ["amount"],
          properties: {
            amount: { type: "number" },
          },
        },

        SavingsPlan: {
          type: "object",
          properties: {
            _id: { type: "string" },
            userId: { type: "string" },
            planName: { type: "string" },
            planType: { type: "string", enum: ["LOCKED", "FLEXIBLE"] },
            principal: { type: "number" },
            interestRate: { type: "number" },
            status: { type: "string", enum: ["ACTIVE", "COMPLETED", "CANCELLED"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },

        /*******************
         * Admin (brief)
         *******************/
        CreateAdminRequest: {
          type: "object",
          required: ["email", "name", "surname", "password", "phone"],
          properties: {
            email: { type: "string", format: "email" },
            name: { type: "string" },
            surname: { type: "string" },
            password: { type: "string", minLength: 6 },
            phone: { type: "string" },
            is_super_admin: { type: "boolean" },
            permissions: { type: "array", items: { type: "string" } },
          },
        },

        Admin: {
          type: "object",
          properties: {
            _id: { type: "string" },
            email: { type: "string" },
            name: { type: "string" },
            surname: { type: "string" },
            is_super_admin: { type: "boolean" },
            permissions: { type: "array", items: { type: "string" } },
            status: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },

        UpdatePermissionsRequest: {
          type: "object",
          required: ["permissions"],
          properties: {
            permissions: { type: "array", items: { type: "string" } },
          },
        },

        BulkLoanActionRequest: {
          type: "object",
          required: ["loanIds", "action"],
          properties: {
            loanIds: { type: "array", items: { type: "string" } },
            action: { type: "string", enum: ["approve", "reject"] },
            reason: { type: "string" },
          },
        },

        DisburseLoanRequest: {
          type: "object",
          required: ["loanId"],
          properties: {
            loanId: { type: "string" },
            amount: { type: "number" },
          },
        },

        RejectLoanRequest: {
          type: "object",
          required: ["reason"],
          properties: {
            reason: { type: "string" },
          },
        },

        // A small reusable date-range schema for reports
        DateRangeQuery: {
          type: "object",
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
          },
        },
      }, // end schemas
    }, // end components
    // Apply bearer token globally unless an endpoint explicitly omits it.
    security: [{ bearerAuth: [] }],
  }, // end definition

  // Where to scan for JSDoc/Swagger comments
  apis: [
    "./src/routes/*.ts",
    "./src/routes/**/*.ts",
    "./src/modules/**/routes/*.ts",
    "./src/modules/**/controllers/*.ts",
    // add additional globs if your code is organized differently
  ],
};

export const specs = swaggerJsdoc(options);

/**
 * Options passed to swagger-ui-express's setup UI. Tweak to taste.
 */
export const swaggerUiOptions = {
  explorer: true,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: "none", // collapse endpoints by default
    filter: true, // show search box
    defaultModelsExpandDepth: -1, // hide big schema trees by default
  },
};

export { swaggerUi };

/**
 * Quick notes & migration tips:
 * 1. Replace inline request/response JSON in route JSDoc with $ref to the schemas above.
 * 2. Ensure validateReqBody / validateReqQuery match whether the route expects body vs query.
 *    e.g. /transfers/status should validate query (validateReqQuery) if parameters are query params.
 * 3. Use the wrapper pattern for responses:
 *    200:
 *      description: ...
 *      content:
 *        application/json:
 *          schema:
 *            $ref: '#/components/schemas/Success'
 *    or for typed response:
 *      $ref: '#/components/schemas/TransferResponse'
 * 4. Keep Joi validation (../validations) synchronized with these schemas.
 *
 * If you want, I can also:
 * - Produce a PR patch converting one route file (e.g. users.routes.ts) to use $ref-based JSDoc, OR
 * - Generate a short checklist / script to validate Joi vs OpenAPI schema coverage across your app.
 */
