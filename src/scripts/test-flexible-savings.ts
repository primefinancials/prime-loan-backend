
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { SavingsService } from '../modules/savings/savings.service';
import { SettingsService } from '../modules/admin/settings.service';
import { SavingsPlan } from '../modules/savings/savings.plan.model';
import User from '../modules/users/user.model';
import { LedgerService } from '../modules/ledger/LedgerService';
import { VfdProvider } from '../shared/providers/vfd.provider';

dotenv.config();

const DB_URL = process.env.DB_URL || 'mongodb://localhost:27017/prime-loan';

async function runTest() {
    try {
        console.log('Using DB:', DB_URL);
        await mongoose.connect(DB_URL);
        console.log('Connected to MongoDB');

        // 1. Ensure Settings are ready
        const settings = await SettingsService.getSettings();
        console.log('Settings loaded:', (settings.savings as any).flexible);

        // 2. Mock User
        const user = await User.findOne();
        if (!user) throw new Error('No user found to test with');
        console.log(`Testing with User: ${user._id}`);

        // 3. Test Standard Flexible Plan (Delayed)
        console.log('\n--- Testing Standard Flexible Plan ---');
        const stdResult = await SavingsService.createPlan({
            userId: (user._id as any).toString(),
            planType: 'FLEXIBLE',
            subType: 'STANDARD',
            planName: 'Test Standard Flex',
            idempotencyKey: `create-std-${Date.now()}`,
            contribution: { frequency: 'monthly', amount: 5000 },
            amount: 10000
        } as any);
        console.log('Standard Plan Created:', (stdResult as any).planId);

        // Fetch Document to Modify Principal
        const standardPlan = await SavingsPlan.findById((stdResult as any).planId);
        if (!standardPlan) throw new Error("Standard Plan not found in DB");

        standardPlan.principal = 20000; // 20k
        await standardPlan.save();
        console.log('Funded Standard Plan with 20k');

        // Withdraw 5000
        const stdWithdraw = await SavingsService.completePlan({
            planId: standardPlan._id as any,
            userId: user._id as any,
            amount: 5000,
            idempotencyKey: `with-std-${Date.now()}`
        });
        console.log('Standard Withdraw Result:', stdWithdraw);

        // Verify Pending
        const planAfter = await SavingsPlan.findById(standardPlan._id);
        console.log('Withdrawal History:', JSON.stringify(planAfter?.withdrawalHistory, null, 2));

        if (planAfter?.withdrawalHistory && planAfter.withdrawalHistory.length > 0) {
            // Note: Early or standard withdrawal test logic can go here.
            const pending = planAfter.withdrawalHistory[0];
            pending.scheduledDate = new Date(Date.now() - 1000); // 1 sec ago
            await planAfter.save();
            console.log('Fast-forwarded withdrawal schedule');

            // Process Pending
            await SavingsService.processPendingWithdrawals();

            // Verify processed
            const finalPlan = await SavingsPlan.findById(standardPlan._id);
            const processedItem = finalPlan?.withdrawalHistory?.[0];
            console.log('Processed Item Status:', processedItem?.processed);
            console.log('Transaction ID:', processedItem?.transactionId);
        }

        // 4. Test Instant Flexible Plan
        console.log('\n--- Testing Instant Flexible Plan ---');
        const instResult = await SavingsService.createPlan({
            userId: (user._id as any).toString(),
            planType: 'FLEXIBLE',
            subType: 'INSTANT',
            planName: 'Test Instant Flex',
            idempotencyKey: `create-inst-${Date.now()}`,
            contribution: { frequency: 'monthly', amount: 5000 },
            amount: 10000
        } as any);

        const instantPlan = await SavingsPlan.findById((instResult as any).planId);
        if (!instantPlan) throw new Error("Instant Plan not found");

        instantPlan.principal = 20000;
        await instantPlan.save();

        const instWithdraw = await SavingsService.completePlan({
            planId: instantPlan._id as any,
            userId: user._id as any,
            amount: 5000,
            idempotencyKey: `with-inst-${Date.now()}`
        });
        console.log('Instant Withdraw Result:', instWithdraw);

        const finalInstant = await SavingsPlan.findById(instantPlan._id);
        console.log('Instant Principal After:', finalInstant?.principal);

    } catch (error) {
        console.error('Test Failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

runTest();
