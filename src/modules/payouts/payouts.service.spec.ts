import { PayoutsService } from './payouts.service';
import type { PaymentProvider } from '../payments/providers/payment-provider.interface';

describe('PayoutsService.onboard', () => {
  it('resolves the account, creates a subaccount, and returns display-friendly fields', async () => {
    const resolveAccountNumber = jest.fn().mockResolvedValue({
      accountNumber: '0123456789',
      accountName: 'JANE DOE',
    });
    const createSubaccount = jest
      .fn()
      .mockResolvedValue({ subaccountCode: 'ACCT_test123' });
    const provider = {
      resolveAccountNumber,
      createSubaccount,
    } as unknown as PaymentProvider;
    const service = new PayoutsService(provider);

    const result = await service.onboard({
      businessName: 'Jane Doe',
      bankCode: '011',
      bankName: 'Equity Bank',
      accountNumber: '0123456789',
    });

    expect(resolveAccountNumber).toHaveBeenCalledWith('0123456789', '011');
    expect(createSubaccount).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: 'Jane Doe',
        bankCode: '011',
        accountNumber: '0123456789',
      }),
    );
    expect(result).toEqual({
      gatewayWalletId: 'ACCT_test123',
      payoutBankName: 'Equity Bank',
      payoutAccountName: 'JANE DOE',
      payoutAccountLast4: '6789',
    });
  });

  it('propagates a resolution failure without creating a subaccount', async () => {
    const resolveAccountNumber = jest
      .fn()
      .mockRejectedValue(new Error('Could not verify that account number'));
    const createSubaccount = jest.fn();
    const provider = {
      resolveAccountNumber,
      createSubaccount,
    } as unknown as PaymentProvider;
    const service = new PayoutsService(provider);

    await expect(
      service.onboard({
        businessName: 'Jane Doe',
        bankCode: '011',
        bankName: 'Equity Bank',
        accountNumber: 'bad',
      }),
    ).rejects.toThrow('Could not verify that account number');
    expect(createSubaccount).not.toHaveBeenCalled();
  });
});
