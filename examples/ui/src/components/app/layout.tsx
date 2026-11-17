import { NavLink, Outlet } from 'react-router';
import {
  ArrowLeftRight,
  Banknote,
  Inbox,
  Landmark,
  Network,
  Receipt,
  ScrollText,
  Send,
  UserRound,
  Wallet,
  Webhook,
} from 'lucide-react';
import { widgetInfo } from 'virtual:checkout-frame';
import { useConfig } from '@/api/config';
import { useStreamState } from '@/api/stream';
import { cn } from '@/lib/cn';
import { NetBadge, ToneBadge } from './badges';

const NAV = [
  { to: '/', label: 'Account', icon: UserRound, end: true },
  { to: '/invoices', label: 'Invoices', icon: Receipt },
  { to: '/balances', label: 'Balances', icon: Wallet },
  { to: '/operations', label: 'Operations', icon: ArrowLeftRight },
  { to: '/deposits', label: 'Deposits', icon: Landmark },
  { to: '/payouts', label: 'Payouts', icon: Send },
  { to: '/networks', label: 'Networks and tariff', icon: Network },
  { to: '/webhooks', label: 'Webhook settings', icon: Webhook },
  { to: '/received', label: 'Received webhooks', icon: Inbox },
  { to: '/log', label: 'Request log', icon: ScrollText },
];

const STREAM_LABEL = {
  open: ['success', 'Live updates on'],
  connecting: ['warning', 'Connecting…'],
  closed: ['danger', 'Live updates off'],
  unsupported: ['muted', 'No live updates'],
} as const;

/** Which backend this UI talks to, from `GET /api/config`, and how this build shows the widget. */
function BackendBar() {
  const config = useConfig();
  const stream = useStreamState();
  const c = config.data?.data;
  const [tone, streamText] = STREAM_LABEL[stream];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {c ? (
        <>
          <ToneBadge tone={c.backend === 'sdk' ? 'info' : 'neutral'} className="text-sm">
            Backend: {c.backend === 'sdk' ? `SDK (@qubiq-psp/sdk ${c.sdkVersion ?? '?'})` : 'plain (own signing)'}
          </ToneBadge>
          <NetBadge net={c.net} />
          <span className="font-mono break-all" title="API key (public)">
            {c.keyId}
          </span>
          <span className="hidden font-mono lg:inline" title="Merchant API">
            {c.apiUrl}
          </span>
        </>
      ) : config.error ? (
        <ToneBadge tone="danger">Backend not reachable: {config.error.errorCode}</ToneBadge>
      ) : (
        <span>Connecting to the backend…</span>
      )}
      <ToneBadge tone="muted" className="max-sm:hidden">
        Widget: {widgetInfo.label}
      </ToneBadge>
      <ToneBadge tone={tone}>{streamText}</ToneBadge>
    </div>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:p-2"
      >
        Skip to content
      </a>
      <aside className="border-b bg-card md:sticky md:top-0 md:h-svh md:w-56 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3 md:py-5">
          <Banknote className="size-5" aria-hidden />
          <span className="text-sm font-semibold">PSP example merchant</span>
        </div>
        <nav aria-label="Sections" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end ?? false}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-accent',
                  isActive && 'bg-accent font-medium',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-2 backdrop-blur">
          <BackendBar />
        </header>
        <main id="main" className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
