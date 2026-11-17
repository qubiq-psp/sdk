// Smoke tests of every screen against MSW handlers typed by the contract, the actions of each screen, and at the end
// a check that the screens called every route of the contract.
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { allRoutes } from '@/api/client';
import * as f from './fixtures';
import { calls, handle, server } from './msw';
import { FakeEventSource, renderAt } from './render';

const INVOICE = '32ddde90-754b-4ef9-b5f6-2fd75726af14';
const PAYOUT = '3f0c2a4e-6b1d-4c8e-9a51-2d7e8f1b0c33';
const DELIVERY = 'c65065bb-9874-49d4-b44b-4930a167a5c1';
const OPERATION = '5c1e7a92-4d3b-4f86-9a20-8e6b3d1f7c45';
const DEPOSIT = 'a949d97d-1f23-45f0-a8e7-23b3ecfa6fd8';

beforeAll(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:statement', revokeObjectURL: () => {} }));
  // The CSV download clicks a link; jsdom cannot navigate
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const called = (op: string) => calls.filter((c) => c.operationId === op);
const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });

/** Clicks the button of a confirmation, then its confirm button. */
async function confirm(user: ReturnType<typeof userEvent.setup>, button: string | RegExp, confirmLabel: string) {
  await user.click(await screen.findByRole('button', { name: button }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: confirmLabel }));
}

describe('screens', () => {
  it('Account: the merchant, the deployment and the backend in the header', async () => {
    renderAt('/');
    await heading('Account');
    expect(await screen.findByText('shop-example')).toBeInTheDocument();
    expect(await screen.findByText(/Backend: plain/)).toBeInTheDocument();
    expect(screen.getAllByText(f.config.keyId).length).toBeGreaterThan(0);
    expect(screen.getByText(/Widget: plain iframe/)).toBeInTheDocument();
    expect(FakeEventSource.instances.at(-1)?.url).toBe('/api/stream');
  });

  it('shows a platform error with errorCode, details, the string to sign and the link to the request log', async () => {
    server.use(
      handle('getAccount', () => ({
        status: 401,
        body: {
          errorCode: 'api_auth_failed',
          errorMessage: 'Bad signature',
          details: { reason: 'bad_signature', stringToSign: 'v1\nGET\n/api/v1/account\n1\nn\nh' },
        },
      })),
    );
    renderAt('/');
    expect(await screen.findByText('api_auth_failed')).toBeInTheDocument();
    expect(screen.getByText('Error from the platform')).toBeInTheDocument();
    expect(screen.getByLabelText(/details\.stringToSign/)).toHaveTextContent('/api/v1/account');
    expect(screen.getByRole('link', { name: 'In the request log' })).toHaveAttribute(
      'href',
      `/log?callId=${f.CALL_ID}`,
    );
  });

  it('Invoices: the list with filters and pages', async () => {
    renderAt('/invoices?status=paid,overpaid&page=2');
    await heading('Invoices');
    expect(await screen.findByRole('link', { name: 'order-58240' })).toBeInTheDocument();
    expect(called('listInvoices').at(-1)!.url.search).toBe('?page=2&limit=20&status=paid,overpaid');
  });

  it('New invoice: create, repeat with the same externalId, with networks and tariff', async () => {
    const user = userEvent.setup();
    renderAt('/invoices/new');
    await heading('New invoice');
    await screen.findByText(/tariff deposit rule/);
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/got 201 Created/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Repeat' }));
    await waitFor(() => expect(called('createInvoice')).toHaveLength(2));
    const [first, second] = called('createInvoice');
    expect(second!.body).toEqual(first!.body);
    expect(first!.body).toMatchObject({ network: 'tron', asset: 'USDT', amount: '1' });
  });

  it('Invoice: details, history, cancel with confirmation, and the payment widget', async () => {
    const user = userEvent.setup();
    server.use(handle('getInvoice', () => ({ ...f.example('getInvoice'), status: 'active' as const })));
    renderAt(`/invoices/${INVOICE}`);
    expect(await screen.findByText('order-58213')).toBeInTheDocument();
    await screen.findByText('History');
    await confirm(user, 'Cancel invoice', 'Cancel the invoice');
    await waitFor(() => expect(called('cancelInvoice')).toHaveLength(1));
    expect(called('cancelInvoice')[0]!.url.pathname).toBe(`/api/invoices/${INVOICE}/cancel`);

    await user.click(screen.getByRole('button', { name: 'Payment widget' }));
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    expect(await screen.findByTitle('Payment page')).toHaveAttribute('src', f.checkoutLink.url);
    // The lifetime is empty: not sent, the backend's default applies
    expect(called('createCheckoutLink')[0]!.body).toEqual({
      branding: { companyName: 'Example shop', title: 'Order order-58213' },
    });
  });

  it('Payment widget: details.field of 400 example_invalid_request marks its input', async () => {
    const user = userEvent.setup();
    server.use(
      handle('getInvoice', () => ({ ...f.example('getInvoice'), status: 'active' as const })),
      handle('createCheckoutLink', () => ({
        status: 400,
        body: {
          errorCode: 'example_invalid_request',
          errorMessage: 'branding.logoUrl: must be https',
          details: { field: 'branding.logoUrl', message: 'must be https' },
        },
      })),
    );
    renderAt(`/invoices/${INVOICE}`);
    await screen.findByText('order-58213');
    await user.click(screen.getByRole('button', { name: 'Payment widget' }));
    await user.type(await screen.findByLabelText('Logo URL'), 'http://shop.example/logo.png');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    await waitFor(() => expect(screen.getByLabelText('Logo URL')).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByLabelText('Company name')).not.toHaveAttribute('aria-invalid');
  });

  it('refreshes by itself with X-Example-Source: poll when a webhook arrives', async () => {
    server.use(handle('getInvoice', () => ({ ...f.example('getInvoice'), status: 'active' as const })));
    renderAt(`/invoices/${INVOICE}`);
    await screen.findByText('order-58213');
    const before = called('getInvoice').length;
    expect(called('getInvoice').at(-1)!.headers.get('X-Example-Source')).toBe('ui');
    act(() => FakeEventSource.instances.at(-1)!.emit('webhook', f.receivedItem));
    await waitFor(() => expect(called('getInvoice').length).toBeGreaterThan(before));
    expect(called('getInvoice').at(-1)!.headers.get('X-Example-Source')).toBe('poll');
  });

  it('Balances', async () => {
    renderAt('/balances');
    await heading('Balances');
    expect(await screen.findByText('By currency')).toBeInTheDocument();
  });

  it('Operations: list, summary, statement JSON and CSV', async () => {
    const user = userEvent.setup();
    renderAt('/operations');
    await heading('Operations');
    await waitFor(() => expect(called('listMerchantOperations').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('tab', { name: 'Summary and statement' }));
    await screen.findByRole('heading', { name: 'Statement' });
    await user.click(screen.getByRole('button', { name: 'Download statement (CSV)' }));
    const lines = await screen.findByLabelText('First lines');
    expect(lines).toHaveTextContent('network,asset');
    expect(lines.textContent).not.toContain('\r');
    const formats = called('getMerchantOperationsStatement').map((c) => c.url.searchParams.get('format'));
    expect(formats).toEqual(expect.arrayContaining(['json', 'csv']));
    expect(called('getMerchantOperationsSummary').length).toBeGreaterThan(0);
  });

  it('Operation', async () => {
    renderAt(`/operations/${OPERATION}`);
    await heading('Operation');
    expect(await screen.findByText('payout_network_fee_charge')).toBeInTheDocument();
  });

  it('Deposits: list and one deposit', async () => {
    renderAt('/deposits');
    await heading('Deposits');
    await screen.findByText('Totals of the filter');
    renderAt(`/deposits/${DEPOSIT}`);
    await heading('Deposit');
    await waitFor(() => expect(called('getMerchantDeposit')).toHaveLength(1));
  });

  it('Payouts: list, quote, create after confirmation, one payout and cancel', async () => {
    const user = userEvent.setup();
    renderAt('/payouts');
    expect((await screen.findAllByRole('link', { name: 'wd-7765' })).length).toBeGreaterThan(0);

    renderAt('/payouts/new');
    await heading('New payout');
    await user.type(await screen.findByLabelText('To address'), 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf');
    await user.type(screen.getByLabelText('Amount'), '25');
    await user.click(screen.getByRole('button', { name: 'Get quote' }));
    await screen.findByText('Quote id');
    await confirm(user, 'Create payout', 'Send payout');
    await waitFor(() => expect(called('createPayout')).toHaveLength(1));
    expect(called('createPayout')[0]!.body).toMatchObject({
      amount: '25',
      toAddress: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    });

    server.use(handle('getPayout', () => ({ ...f.example('getPayout'), status: 'pending_approval' as const })));
    renderAt(`/payouts/${PAYOUT}`);
    await screen.findByText('Timeline');
    await confirm(user, 'Cancel payout', 'Cancel the payout');
    await waitFor(() => expect(called('cancelPayout')).toHaveLength(1));
  });

  it('Networks and tariff', async () => {
    renderAt('/networks');
    await heading('Networks and tariff');
    // The plan name comes from the platform's example as it is
    expect(await screen.findByText(f.example('getMerchantTariff').tariffPlanName)).toBeInTheDocument();
    expect(screen.getAllByText('trc20 · TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf').length).toBeGreaterThan(0);
  });

  it('Webhook settings: set the URL of this backend, remove it, send a test, deliveries', async () => {
    const user = userEvent.setup();
    renderAt('/webhooks');
    await heading('Webhook settings');
    const url = await screen.findByLabelText('URL');
    await waitFor(() => expect(url).toHaveValue(f.config.webhookUrl));
    await user.click(screen.getByRole('button', { name: 'Set URL' }));
    await waitFor(() => expect(called('setWebhookUrl')).toHaveLength(1));
    expect(called('setWebhookUrl')[0]!.body).toEqual({ url: f.config.webhookUrl });
    await confirm(user, 'Remove URL', 'Remove');
    await waitFor(() => expect(called('removeWebhookUrl')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Send test' }));
    await waitFor(() => expect(called('sendTestWebhook')).toHaveLength(1));
    expect(called('listDeliveries').length).toBeGreaterThan(0);
  });

  it('Delivery: attempts, the receiver copies and redelivery', async () => {
    const user = userEvent.setup();
    renderAt(`/webhooks/deliveries/${DELIVERY}`);
    await heading('Delivery');
    await confirm(user, 'Send again', 'Send again');
    await waitFor(() => expect(called('redeliverDelivery')).toHaveLength(1));
    expect(called('listReceivedWebhooks').at(-1)!.url.searchParams.get('webhookId')).toBe(DELIVERY);
  });

  it('Received webhooks: the log, the receiver settings and clearing', async () => {
    const user = userEvent.setup();
    renderAt('/received');
    await heading('Received webhooks');
    expect(await screen.findByText('verified')).toBeInTheDocument();
    await user.clear(await screen.findByLabelText('Fail next'));
    await user.type(screen.getByLabelText('Fail next'), '3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(called('setReceiverSettings')).toHaveLength(1));
    expect(called('setReceiverSettings')[0]!.body).toEqual({ mode: 'auto', status: 500, delayMs: 0, failNext: 3 });
    await confirm(user, 'Clear log', 'Clear');
    await waitFor(() => expect(called('clearReceivedWebhooks')).toHaveLength(1));

    renderAt(`/received/${f.RECEIVED_ID}`);
    await heading('Received webhook');
    expect(await screen.findByText('The signature matches the current secret')).toBeInTheDocument();
  });

  it('Request log: hides auto-refresh by default, updates live, one entry with the string to sign, clearing', async () => {
    const user = userEvent.setup();
    renderAt('/log');
    await heading('Request log');
    await screen.findByText('POST /api/v1/invoices');
    expect(called('listRequestLog').at(-1)!.url.searchParams.get('source')).toBe('ui');
    const before = called('listRequestLog').length;
    act(() => FakeEventSource.instances.at(-1)!.emit('request', f.requestLogItem));
    await waitFor(() => expect(called('listRequestLog').length).toBeGreaterThan(before));
    await confirm(user, 'Clear log', 'Clear');
    await waitFor(() => expect(called('clearRequestLog')).toHaveLength(1));

    renderAt(`/log/${f.ENTRY_ID}`);
    await heading('Request');
    expect(await screen.findByLabelText('String to sign')).toHaveTextContent('/api/v1/invoices');
  });

  it('Request log of one call: the link of an action filters by callId', async () => {
    renderAt(`/log?callId=${f.CALL_ID}&source=all`);
    await screen.findByText(/attempts of one call/);
    const search = called('listRequestLog').at(-1)!.url.searchParams;
    expect(search.get('callId')).toBe(f.CALL_ID);
    expect(search.get('source')).toBeNull();
  });

  it('called every route of the contract (the receiver is called by the platform, the stream by EventSource)', () => {
    const seen = new Set(calls.map((c) => c.operationId));
    if (FakeEventSource.instances.some((s) => s.url === '/api/stream')) seen.add('streamEvents');
    const missing = allRoutes()
      .map((r) => r.operationId)
      .filter((op) => op !== 'receivePspWebhook' && !seen.has(op));
    expect(missing).toEqual([]);
  });
});
