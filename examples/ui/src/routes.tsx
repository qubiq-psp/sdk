import { Navigate, type RouteObject } from 'react-router';
import { Layout } from '@/components/app/layout';
import { AccountScreen } from '@/screens/account';
import { BalancesScreen } from '@/screens/balances';
import { DepositScreen } from '@/screens/deposits/detail';
import { DepositListScreen } from '@/screens/deposits/list';
import { InvoiceDetailScreen } from '@/screens/invoices/detail';
import { InvoiceListScreen } from '@/screens/invoices/list';
import { InvoiceNewScreen } from '@/screens/invoices/new';
import { RequestLogEntryScreen } from '@/screens/log/detail';
import { RequestLogScreen } from '@/screens/log/list';
import { NetworksScreen } from '@/screens/networks';
import { OperationScreen } from '@/screens/operations/detail';
import { OperationsScreen } from '@/screens/operations/list';
import { PayoutScreen } from '@/screens/payouts/detail';
import { PayoutListScreen } from '@/screens/payouts/list';
import { PayoutNewScreen } from '@/screens/payouts/new';
import { ReceivedDetailScreen } from '@/screens/received/detail';
import { ReceivedScreen } from '@/screens/received/list';
import { DeliveryScreen } from '@/screens/webhooks/delivery';
import { WebhookSettingsScreen } from '@/screens/webhooks/settings';

/** Every screen of the UI. */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <AccountScreen /> },
      { path: 'invoices', element: <InvoiceListScreen /> },
      { path: 'invoices/new', element: <InvoiceNewScreen /> },
      { path: 'invoices/:invoiceId', element: <InvoiceDetailScreen /> },
      { path: 'balances', element: <BalancesScreen /> },
      { path: 'operations', element: <OperationsScreen /> },
      { path: 'operations/:operationId', element: <OperationScreen /> },
      { path: 'deposits', element: <DepositListScreen /> },
      { path: 'deposits/:depositId', element: <DepositScreen /> },
      { path: 'payouts', element: <PayoutListScreen /> },
      { path: 'payouts/new', element: <PayoutNewScreen /> },
      { path: 'payouts/:payoutId', element: <PayoutScreen /> },
      { path: 'networks', element: <NetworksScreen /> },
      { path: 'webhooks', element: <WebhookSettingsScreen /> },
      { path: 'webhooks/deliveries/:deliveryId', element: <DeliveryScreen /> },
      { path: 'received', element: <ReceivedScreen /> },
      { path: 'received/:receivedId', element: <ReceivedDetailScreen /> },
      { path: 'log', element: <RequestLogScreen /> },
      { path: 'log/:entryId', element: <RequestLogEntryScreen /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
