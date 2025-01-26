import { User } from "./users.interfaces";
import { Request } from 'express';

export interface ProtectedRequest extends Request {
	user?: User;
	admin?: User;
}