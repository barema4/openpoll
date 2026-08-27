import { Inject, Injectable } from '@nestjs/common';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from '../payments/providers/payment-provider.interface';

export interface PayoutDetails {
  gatewayWalletId: string;
  payoutBankName: string;
  payoutAccountName: string;
  payoutAccountLast4: string;
}

@Injectable()
export class PayoutsService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  listBanks() {
    return this.provider.listBanks();
  }

  resolveAccount(bankCode: string, accountNumber: string) {
    return this.provider.resolveAccountNumber(accountNumber, bankCode);
  }

  // Verifies the account, creates the Paystack subaccount, and returns
  // everything a payee record needs to store — the internal subaccount code
  // plus the friendly display fields so nobody has to look at "ACCT_xxxx".
  async onboard(params: {
    businessName: string;
    bankCode: string;
    bankName: string;
    accountNumber: string;
  }): Promise<PayoutDetails> {
    const resolved = await this.provider.resolveAccountNumber(
      params.accountNumber,
      params.bankCode,
    );

    const { subaccountCode } = await this.provider.createSubaccount({
      businessName: params.businessName,
      bankCode: params.bankCode,
      accountNumber: params.accountNumber,
    });

    return {
      gatewayWalletId: subaccountCode,
      payoutBankName: params.bankName,
      payoutAccountName: resolved.accountName,
      payoutAccountLast4: params.accountNumber.slice(-4),
    };
  }
}
