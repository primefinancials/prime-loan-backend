import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { AuthMiddleware } from '../../shared/middleware/AuthMiddleware';

export class UserRoutes {
  private router: Router;

  constructor(
    private userController: UserController,
    private authMiddleware: AuthMiddleware
  ) {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes() {
    this.router.post('/create-client', this.userController.createUser.bind(this.userController));
    this.router.post('/login', this.userController.login.bind(this.userController));
    this.router.get('/profile', 
      this.authMiddleware.authenticate(), 
      this.userController.getProfile.bind(this.userController)
    );
  }

  getRouter(): Router {
    return this.router;
  }
}