const fs = require('fs');

let content = fs.readFileSync('src/modules/savings/savings.service.ts', 'utf8');

// Update autoDeductActiveLoan signature and return
content = content.replace(
  /private static async autoDeductActiveLoan\([^)]+\) *: *Promise<\{[^}]+\}> *\{/g,
  `private static async autoDeductActiveLoan(userId: string, withdrawalAmount: number, session: any): Promise<{ deductAmount: number, loanDeduction?: any }> {`
);

content = content.replace(
  /if \(\!activeLoan\) return \{\};/g,
  `if (!activeLoan) return { deductAmount: 0 };`
);

content = content.replace(
  /if \(deductAmount <= 0\) return \{\};/g,
  `if (deductAmount <= 0) return { deductAmount: 0 };`
);

content = content.replace(
  /await LoanService\.repayLoan\(\{\n\s*loanId: activeLoan\._id,\n\s*userId,\n\s*amount: deductAmount\n\s*\}\);/g,
  `await LoanService.repayLoan({
        loanId: activeLoan._id,
        userId,
        amount: deductAmount,
        internalOnly: true,
        session
      });`
);

content = content.replace(
  /return \{\n\s*loanDeduction: \{/g,
  `return {
        deductAmount,
        loanDeduction: {`
);

content = content.replace(
  /return \{\};\n\s*\}\n\s*\}/g,
  `return { deductAmount: 0 };
    }
  }`
);

fs.writeFileSync('src/modules/savings/savings.service.ts', content);
