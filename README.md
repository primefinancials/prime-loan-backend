# Prime Finance Backend - Clean Architecture

A modern, scalable Node.js backend application built with Clean Architecture principles for a financial services platform.

## 🏗️ Architecture Overview

This project follows Clean Architecture principles with clear separation of concerns:

```
src/
├── core/                    # Business Logic Layer
│   ├── entities/           # Business Entities
│   ├── repositories/       # Repository Interfaces
│   ├── services/          # Service Interfaces
│   └── use-cases/         # Application Use Cases
├── infrastructure/         # Infrastructure Layer
│   ├── database/          # Database Models & Connection
│   ├── repositories/      # Repository Implementations
│   ├── services/         # Service Implementations
│   ├── jobs/             # Background Jobs
│   └── di/               # Dependency Injection
├── presentation/          # Presentation Layer
│   ├── controllers/      # HTTP Controllers
│   └── routes/          # Route Definitions
├── shared/               # Shared Components
│   ├── errors/          # Error Classes
│   ├── middleware/      # Express Middleware
│   └── validation/      # Validation Schemas
└── main.ts              # Application Entry Point
```

## 🚀 Key Features

- **Clean Architecture**: Separation of concerns with clear boundaries
- **Dependency Injection**: Centralized container for managing dependencies
- **Type Safety**: Full TypeScript implementation
- **Error Handling**: Centralized error handling with custom error types
- **Validation**: Request validation using Joi schemas
- **Authentication**: JWT-based authentication with refresh tokens
- **Database**: MongoDB with Mongoose ODM
- **Background Jobs**: Automated loan processing and notifications
- **Email Service**: Nodemailer integration for notifications
- **External APIs**: Integration with VFD wallet and Mono credit check

## 🛠️ Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT tokens
- **Validation**: Joi
- **Email**: Nodemailer
- **Scheduling**: node-cron
- **Testing**: Jest (ready for implementation)

## 📦 Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables (copy from existing .env file)

4. Start the development server:
   ```bash
   npm run dev
   ```

## 🏃‍♂️ Running the Application

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### Testing
```bash
npm test
npm run test:watch
npm run test:coverage
```

## 🔧 Configuration

The application uses environment variables for configuration. Key variables include:

- `PORT`: Server port
- `DB_URL`: MongoDB connection string
- `ACCESS_TOKEN_SECRET`: JWT access token secret
- `REFRESH_TOKEN_SECRET`: JWT refresh token secret
- `CRYPTOJS_KEY`: Encryption key for passwords
- `EMAIL_USERNAME`: SMTP username
- `EMAIL_PASSWORD`: SMTP password

## 📚 API Endpoints

### User Management
- `POST /api/users/create-client` - Create new user account
- `POST /api/users/login` - User authentication
- `GET /api/users/profile` - Get user profile (authenticated)

### Loan Management
- `POST /api/loans/create-loan` - Create loan application (authenticated)
- `POST /api/loans/disburse-loan` - Disburse loan (admin only)

## 🔄 Background Jobs

The application includes automated background jobs:

- **Overdue Loan Processing**: Runs every 9 minutes to process overdue loans
- **Loan Reminders**: Sends daily reminders for upcoming loan payments

## 🧪 Testing

The project is set up for comprehensive testing with Jest:

- Unit tests for use cases
- Integration tests for repositories
- End-to-end tests for API endpoints

## 🚀 Deployment

The application can be deployed using Docker:

```bash
docker build -t prime-finance-backend .
docker run -p 3000:3000 prime-finance-backend
```

## 🤝 Contributing

1. Follow the established architecture patterns
2. Write tests for new features
3. Use TypeScript strictly
4. Follow the existing code style
5. Update documentation as needed

## 📄 License

This project is proprietary software for Prime Finance.

## 🔒 Security

- Passwords are encrypted using CryptoJS
- JWT tokens for authentication
- Input validation on all endpoints
- Rate limiting and security headers via Helmet
- Environment-based configuration

## 📈 Monitoring

The application includes comprehensive logging and error tracking for production monitoring.