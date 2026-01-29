/**
 * Profit Service
 * Handles realization and distribution of profits to sub-ledgers.
 */
import { LedgerService } from '../ledger/LedgerService';
import { DatabaseService } from '../../shared/db';
import { UuidService } from '../../shared/utils/uuid';

export class ProfitService {

    /**
     * Realize and Distribute Profit
     * Moves funds from 'platform_revenue' (temporary holding) to specific sub-ledgers.
     * 
     * @param category Source category (e.g. 'loan-interest', 'transfer-fee')
     * @param amount Amount to distribute from revenue
     * @param traceId Original traceId for audit trail
     */
    static async distributeProfit(category: string, amount: number, traceId: string) {
        if (amount <= 0) return;

        const session = await DatabaseService.startSession();
        try {
            await DatabaseService.withTransaction(session, async () => {
                // 1. Define Distribution Ratio (could be in Settings)
                // Example: 70% Operational, 20% Reserve, 10% Risk Fund
                const operationalShare = Math.floor(amount * 0.70);
                const reserveShare = Math.floor(amount * 0.20);
                const riskShare = Math.floor(amount * 0.10); // Loss Provisioning

                // Ensure no loose change due to floor
                const remainder = amount - (operationalShare + reserveShare + riskShare);

                // 2. Create Ledger Entries
                // Debit: platform_revenue (General Pool)
                // Credit: Specific Sub-Ledgers

                const distributionTraceId = UuidService.generateTraceId();

                // Debit Revenue
                await LedgerService.createEntry({
                    traceId: distributionTraceId,
                    userId: 'system',
                    account: 'platform_revenue',
                    entryType: 'DEBIT',
                    category: 'profit_distribution',
                    subtype: 'allocation',
                    amount: amount,
                    status: 'COMPLETED',
                    meta: { originalTraceId: traceId, category }
                }, session);

                // Credit Operational
                await LedgerService.createEntry({
                    traceId: distributionTraceId,
                    userId: 'system',
                    account: 'revenue_operational',
                    entryType: 'CREDIT',
                    category: 'profit_distribution',
                    subtype: 'operational',
                    amount: operationalShare + remainder, // Add remainder here
                    status: 'COMPLETED',
                    meta: { originalTraceId: traceId }
                }, session);

                // Credit Reserve
                await LedgerService.createEntry({
                    traceId: distributionTraceId,
                    userId: 'system',
                    account: 'revenue_reserve',
                    entryType: 'CREDIT',
                    category: 'profit_distribution',
                    subtype: 'reserve',
                    amount: reserveShare,
                    status: 'COMPLETED',
                    meta: { originalTraceId: traceId }
                }, session);

                // Credit Risk Fund
                await LedgerService.createEntry({
                    traceId: distributionTraceId,
                    userId: 'system',
                    account: 'revenue_risk_fund',
                    entryType: 'CREDIT',
                    category: 'profit_distribution',
                    subtype: 'risk_fund',
                    amount: riskShare,
                    status: 'COMPLETED',
                    meta: { originalTraceId: traceId }
                }, session);
            });
        } finally {
            session.endSession();
        }
    }

    /**
     * Get Total Profit Metrics (Admin Dashboard)
     */
    static async getProfitMetrics() {
        // Aggregate ledger balances for system accounts
        const [revenue, operational, reserve, risk] = await Promise.all([
            LedgerService.getWalletBalance('platform_revenue'), // Should be low if distributed often, or holds pending
            LedgerService.getWalletBalance('revenue_operational'),
            LedgerService.getWalletBalance('revenue_reserve'),
            LedgerService.getWalletBalance('revenue_risk_fund')
        ]);

        return {
            unallocatedRevenue: revenue,
            operationalProfit: operational,
            retainedEarnings: reserve,
            riskProvision: risk,
            totalRealized: operational + reserve + risk
        };
    }
}
