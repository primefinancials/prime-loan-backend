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
const utils_1 = require("./utils");
const config_1 = require("./config");
const startApp = () => __awaiter(void 0, void 0, void 0, function* () {
    yield (0, utils_1.connectToDB)();
    // const server = http.createServer(app);
    app_1.default.listen(3000, () => {
        console.log(`initiated User Service`);
    }).on("listening", () => console.log(`User Service listening on port ${config_1.PORT}`)).on("error", (err) => {
        console.log(err);
        process.exit();
    }).on("close", () => {
    });
});
startApp();
