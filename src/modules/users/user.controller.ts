/**
 * user.controller.ts
 * V2 User Controller
 * - Handles signup, login, profile, password reset, updates
 * - Leverages UserService for business logic
 */
import { Request, Response, NextFunction } from "express";
import { ProtectedRequest } from "../../interfaces";
import { UserService } from "./user.service";

export class UserController {
  /**
   * Register a new user
   */
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await UserService.createClientAccount(req.body);

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
      const { field, value } = req.body;

      const updatedUser = await UserService.update(req.user!._id, field, value);

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

      const stats = await UserService.getUserFinancialSummary(user?._id || "");

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
