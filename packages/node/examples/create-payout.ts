// Quotes a payout, requests it and prints its state.
//   PSP_API_KEY=psp_pk_test_… PSP_API_SECRET=psp_sk_test_… PSP_API_URL=https://… npx tsx examples/create-payout.ts w-2290 T… 1000
import { PspClient, PspConnectionError, getResponseMeta, isPspApiError } from '@qubiq-psp/sdk';

const psp = new PspClient(); // reads PSP_API_KEY, PSP_API_SECRET and PSP_API_URL

async function createPayout(requestId: string, toAddress: string, amount: string): Promise<void> {
  try {
    const quote = await psp.payouts.quote({ network: 'tron', asset: 'USDT', toAddress, amount });
    console.log(`fee ${quote.commission} USDT, network fee up to ${quote.networkFee.amount} ${quote.networkFee.asset}`);

    // The request id is the externalId: a retry with the same id returns the same payout, never a second one.
    // The SDK waits up to 180 s per attempt here: the platform may take 130 s to answer.
    const payout = await psp.payouts.create(
      { externalId: requestId, network: 'tron', asset: 'USDT', amount, toAddress, quoteId: quote.quoteId },
      { clientRequestId: `payout-${requestId}` },
    );
    console.log(getResponseMeta(payout)?.status === 201 ? 'requested' : 'already existed', payout.id, payout.status);
  } catch (err) {
    if (isPspApiError(err, 'payout_conflict')) {
      const existing = await psp.payouts.get(err.details.payoutId);
      console.error(`request ${requestId} already has payout ${existing.id} with other fields (${existing.status})`);
    } else if (isPspApiError(err, 'insufficient_balance')) {
      console.error(`at most ${err.details.maxAmount} ${err.details.asset} can be paid out now`);
    } else if (isPspApiError(err, 'too_many_requests')) {
      console.error(`too many quotes: wait ${err.details.retryAfterSeconds} s`);
    } else if (err instanceof PspConnectionError && err.outcome === 'unknown') {
      console.error('the outcome is unknown: run again with the same request id, it will not pay twice');
    } else {
      throw err;
    }
  }
}

const [requestId = 'w-2290', toAddress = 'TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW', amount = '1000'] = process.argv.slice(2);
createPayout(requestId, toAddress, amount).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
