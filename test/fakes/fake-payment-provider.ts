import { PaystackProvider } from '../../src/modules/payments/providers/paystack.provider';
import type { VerifiedTransaction } from '../../src/modules/payments/providers/payment-provider.interface';

// Extends the real PaystackProvider so signature verification and webhook
// parsing stay exactly as in production (no network calls, pure logic) —
// only verifyTransaction, which does a real HTTP call to Paystack, is faked.
// Tests register the expected result right before sending a simulated
// webhook, standing in for "what Paystack's own API would confirm."
export class FakePaymentProvider extends PaystackProvider {
  private readonly verifications = new Map<string, VerifiedTransaction>();

  registerVerification(reference: string, result: VerifiedTransaction) {
    this.verifications.set(reference, result);
  }

  override verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const result = this.verifications.get(reference);
    if (!result) {
      throw new Error(
        `FakePaymentProvider: no verification registered for ${reference}`,
      );
    }
    return Promise.resolve(result);
  }
}
