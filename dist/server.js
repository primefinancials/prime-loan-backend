"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const utils_1 = require("./utils");
const config_1 = require("./config");
const loanReminder_1 = require("./jobs/loanReminder");
const node_cron_1 = __importDefault(require("node-cron"));
let lastRun = Date.now();
node_cron_1.default.schedule('*/9 * * * *', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Running loan check...');
    yield (0, loanReminder_1.checkLoansAndSendEmails)();
}));
node_cron_1.default.schedule('0 * * * *', () => __awaiter(void 0, void 0, void 0, function* () {
    const now = Date.now();
    const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);
    if (hoursSinceLastRun >= 23) {
        console.log('Running send email...');
        yield (0, loanReminder_1.sendMessageForLoan)();
        lastRun = now; // Update the last run time
    }
}));
const startApp = () => __awaiter(void 0, void 0, void 0, function* () {
    const app = (0, express_1.default)();
    yield (0, utils_1.connectToDB)();
    yield (0, app_1.default)(app);
    const server = http_1.default.createServer(app);
    server.listen(config_1.PORT, () => {
        console.log(`initiated User Service`);
    }).on("listening", () => console.log(`User Service listening on port ${config_1.PORT}`)).on("error", (err) => {
        console.log(err);
        process.exit();
    }).on("close", () => {
    });
});
startApp();
