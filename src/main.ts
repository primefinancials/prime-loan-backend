import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { connectToDB } from './utils/connectToDB';
import { Container } from './infrastructure/di/Container';
import { UserRoutes } from './presentation/routes/UserRoutes';
import { LoanRoutes } from './presentation/routes/LoanRoutes';
import { errorHandler } from './shared/middleware/ErrorHandler';
import { PORT } from './config';

async function bootstrap() {
  const app = express();
  const container = Container.getInstance();

  // Middleware
  app.use(helmet());
  app.use(cors({
    origin: [
      '*',
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:8081',
      'https://prime-finance-admin.netlify.app',
      'https://admin.primefinance.live',
      'https://primefinance.live',
      'https://prime-loan-web-init.vercel.app'
    ],
    credentials: true,
  }));
  app.use(compression());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  // Connect to database
  await connectToDB();

  // Routes
  const userRoutes = new UserRoutes(
    container.get('userController'),
    container.get('authMiddleware')
  );

  const loanRoutes = new LoanRoutes(
    container.get('loanController'),
    container.get('authMiddleware')
  );

  app.use('/api/users', userRoutes.getRouter());
  app.use('/api/loans', loanRoutes.getRouter());

  // Error handling
  app.use(errorHandler);

  // Start server
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

bootstrap().catch(console.error);