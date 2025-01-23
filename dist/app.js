"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const kycRoutes_1 = __importDefault(require("./routes/kycRoutes"));
const paybillsRoutes_1 = __importDefault(require("./routes/paybillsRoutes"));
const loanRoutes_1 = __importDefault(require("./routes/loanRoutes"));
const dataRoutes_1 = __importDefault(require("./routes/dataRoutes"));
const exceptions_1 = require("./exceptions");
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
app.use("/api/users", userRoutes_1.default);
app.use("/api/kyc", kycRoutes_1.default);
app.use("/api/paybills", paybillsRoutes_1.default);
app.use("/api/loans", loanRoutes_1.default);
app.use("/api/data", dataRoutes_1.default);
// // Catch and handle all 404 errors
// app.all("*", function (req: Request, res: Response): Response {
//   console.log("Not Found");
//   return res.sendStatus(404);
// });
app.use(exceptions_1.errHandler);
exports.default = app;
