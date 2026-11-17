// Values of the Merchant API enums the filters offer. `satisfies` keeps them in step with the contract types.
import type { components, operations } from '@psp-examples/contract/types';

type S = components['schemas'];
type Q<O extends keyof operations> = NonNullable<operations[O]['parameters']['query']>;
type Item<T> = T extends readonly (infer I)[] ? I : T;

export const INVOICE_STATUSES = [
  'active',
  'partially_paid',
  'paid',
  'overpaid',
  'expired',
  'expired_partial',
  'cancelled',
] as const satisfies readonly S['V1Invoice']['status'][];

export const PAYOUT_STATUSES = [
  'pending_approval',
  'approved',
  'dispatched',
  'submitted',
  'confirmed',
  'failed',
  'rejected',
  'cancelled',
  'expired',
  'manual_review',
] as const satisfies readonly S['V1Payout']['status'][];

export const DEPOSIT_STATUSES = [
  'detected',
  'confirmed',
  'dropped',
] as const satisfies readonly S['V1Deposit']['status'][];

export const CREDIT_STATUSES = [
  'none',
  'paused',
  'aml_wait',
  'aml_hold',
  'credited',
  'unallocated',
  'dust',
  'aml_dirty',
  'income',
] as const satisfies readonly S['V1Deposit']['creditStatus'][];

export const MATCH_KINDS = [
  'in_time',
  'after_final',
  'late',
  'wrong_asset',
  'orphan',
  'unknown_address',
  'dust',
  'wrong_network',
  'unattributed_native',
] as const satisfies readonly NonNullable<S['V1Deposit']['matchKind']>[];

export const OPERATION_TYPES = [
  'deposit_credit',
  'deposit_hold',
  'aml_release',
  'aml_dirty_assign',
  'aml_dirty_release',
  'aml_dirty_withdrawal',
  'unallocated_assign',
  'payout_hold',
  'payout_release',
  'payout_capture',
  'payout_capture_late',
  'payout_network_fee_hold',
  'payout_network_fee_charge',
  'payout_network_fee_release',
  'cross_network_payout_hold',
  'cross_network_payout_capture',
  'cross_network_payout_release',
  'cross_network_payout_reversal',
  'merchant_credit',
  'merchant_debit',
  'merchant_freeze',
  'merchant_unfreeze',
  'fee_refund',
  'reversal',
] as const satisfies readonly Item<Q<'listMerchantOperations'>['type']>[];

export const DELIVERY_STATUSES = [
  'waiting',
  'pending',
  'delivered',
  'failed',
  'expired',
] as const satisfies readonly S['V1Delivery']['status'][];

export const DELIVERY_KINDS = ['notification', 'test'] as const satisfies readonly S['V1Delivery']['kind'][];

export const WEBHOOK_EVENTS = [
  'invoice.payment_detected',
  'invoice.payment_dropped',
  'invoice.payment_held',
  'invoice.underpaid',
  'invoice.paid',
  'invoice.overpaid',
  'invoice.expired',
  'invoice.expired_partial',
  'invoice.late_payment',
  'invoice.wrong_asset_payment',
  'invoice.cancelled',
  'webhook.test',
] as const satisfies readonly S['V1Delivery']['type'][];
