import { UsersService } from './users.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PayoutsService } from '../payouts/payouts.service';

describe('UsersService.setPayout', () => {
  it('onboards the payout with the user name as businessName and persists the result', async () => {
    const onboard = jest.fn().mockResolvedValue({
      gatewayWalletId: 'ACCT_test123',
      payoutBankName: 'Equity Bank',
      payoutAccountName: 'JANE DOE',
      payoutAccountLast4: '6789',
    });
    const payouts = { onboard } as unknown as PayoutsService;
    const update = jest.fn().mockResolvedValue({ id: 'user-1' });
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Jane Doe' }),
        update,
      },
    } as unknown as PrismaService;
    const service = new UsersService(prisma, payouts);

    await service.setPayout('user-1', {
      bankCode: '011',
      bankName: 'Equity Bank',
      accountNumber: '0123456789',
    });

    expect(onboard).toHaveBeenCalledWith({
      businessName: 'Jane Doe',
      bankCode: '011',
      bankName: 'Equity Bank',
      accountNumber: '0123456789',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: {
          gatewayWalletId: 'ACCT_test123',
          payoutBankName: 'Equity Bank',
          payoutAccountName: 'JANE DOE',
          payoutAccountLast4: '6789',
        },
      }),
    );
  });
});
