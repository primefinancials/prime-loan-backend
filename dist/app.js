"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const app = (0, express_1.default)();
// CORS
// app.use(cors());
// app.use(helmet());
// // Request body parser
// app.use(express.json());
// app.use(express.urlencoded({ extended: false }));
// // Cookie parser
// app.use(cookieParser());
// app.use(compression());
// // Routes
// app.use("/api/users", userRoutes);
// app.use("/api/kyc", kycRoutes);
// app.use("/api/paybills", paybillsRoutes);
// app.use("/api/loans", loanRoutes);
// app.use("/api/data", dataRoutes);
// // Catch and handle all 404 errors
// app.all("*", function (req: Request, res: Response): Response {
//   console.log("Not Found");
//   return res.sendStatus(404);
// });
// app.use(errHandler);
exports.default = app;
