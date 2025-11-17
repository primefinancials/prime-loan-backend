/**
 * user.controller.ts
 * V2 User Controller
 * - Handles signup, login, profile, password reset, updates
 * - Leverages UserService for business logic
 */
import { Request, Response, NextFunction } from "express";
import { ProtectedRequest } from "../../interfaces";
import { UserService } from "./user.service";
import { User } from "./user.interface";

function formatDob(dob: string): string {
  // Expecting "MM/DD/YYYY" or "MM-DD-YYYY"
  const parts = dob.includes("/") ? dob.split("/") : dob.split("-");

  if (parts.length !== 3) {
    throw new Error("Invalid DOB format. Expected MM/DD/YYYY");
  }

  const [month, day, year] = parts;

  const date = new Date(`${year}-${month}-${day}`);

  if (isNaN(date.getTime())) {
    throw new Error("Invalid DOB provided");
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", 
                  "Aug", "Sep", "Oct", "Nov", "Dec"];

  const formatted = `${String(date.getDate()).padStart(2, "0")}-${months[date.getMonth()]}-${date.getFullYear()}`;

  return formatted;
}

export class UserController {
  /**
   * Register a new user
   */
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      // Convert dob BEFORE sending to service
      const formattedDob = formatDob(req.body.dob);

      const user = await UserService.createClientAccount({
        ...req.body,
        dob: formattedDob, // overwrite with formatted DOB
      });

      res.status(201).json({
        status: "success",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }


  /**
   * Login
   */
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const result = await UserService.login(email, password);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user profile
   */
  static async profile(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const user = await UserService.getUser(req.user!._id);

      res.status(200).json({
        status: "success",
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user fields
   */
  static async update(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { user }: { user: {
          first_name: string;
          profile_photo: string;
          phone: string;
          surname: string;
          address?: string | null | undefined;
      }} = req.body;

      let updatedUser;

      for (const [field, value] of Object.entries(user || {})) {
        updatedUser = await UserService.update(req.user!._id, `user_metadata.${field}`, value);
      }

      res.status(200).json({
        status: "success",
        data: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Initiate password or pin reset (sends OTP)
   */
  static async initiateReset(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, type } = req.body;
      const userService = new UserService();
      const result = await userService.initiateReset(email, type);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Validate reset OTP
   */
  static async validateReset(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, pin } = req.body;
      const userService = new UserService();
      const result = await userService.validateReset(email, pin);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update password or pin after validation
   */
  static async updatePasswordOrPin(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, newPassword, newPin } = req.body;
      const userService = new UserService();
      const result = await userService.updatePasswordOrPin(email, newPassword, newPin);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Change password for logged-in user
   */
  static async changePassword(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const { oldPassword, newPassword } = req.body;
      const userService = new UserService();
      const result = await userService.changePassword(req.user!._id, oldPassword, newPassword);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * User dashboard: aggregated platform statistics
   */
  static async getUserFinancialSummary(req: ProtectedRequest, res: Response, next: NextFunction) {
    try {
      const user = req.user;

      const stats = await UserService.getUserFinancialSummary(user);

      res.status(200).json({
        status: 'success',
        data: stats
      });
    } catch (error) {
      console.log('Dashboard Error: ', error)
      next(error);
    }
  }
}
