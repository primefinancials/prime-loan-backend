import mongoose from 'mongoose';
import User from '../src/modules/users/user.model';
import { SavingsPlan } from '../src/modules/savings/savings.plan.model';
import { DatabaseService } from '../src/shared/db';

async function run() {
  const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017';
  const dbName = process.env.DATABASE_NAME || 'prime-loan';
  await mongoose.connect(`${dbUrl}/${dbName}`);
  
  const email = 'georgeirabor54321@yahoo.com';
  const user = await User.findOne({ email });
  
  if (!user) {
    console.log(`User ${email} not found`);
    process.exit(1);
  }

  console.log(`Found user: ${user._id} (${user.user_metadata.first_name})`);

  const planName = "Flexible Savings";
  const targetAmount = 10000;
  const initialPrincipal = 5000;

  // Create the plan directly in DB to bypass the "no initial deposit for flexible" logic in service if necessary
  // Or use the service and then update it.
  
  const plan = await SavingsPlan.create({
    userId: user._id,
    planType: 'FLEXIBLE',
    planName: planName,
    targetAmount: targetAmount,
    principal: initialPrincipal,
    interestRate: 0.1, // 10% default
    locked: true,
    maturityDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
    status: 'ACTIVE',
    contribution: {
      frequency: 'monthly',
      amount: 1000,
      dayOfMonth: 1,
      pendingDeduction: false
    },
    contributionHistory: [{
      amount: initialPrincipal,
      initiated: new Date(),
      processed: true,
      transactionId: "MANUAL_INIT"
    }],
    withdrawalHistory: []
  });

  console.log(`Created savings plan: ${plan._id}`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
