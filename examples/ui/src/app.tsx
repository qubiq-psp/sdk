import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { useStream } from '@/api/stream';
import { Toaster } from '@/components/ui/sonner';
import { routes } from './routes';

/**
 * Queries are never retried by themselves: every retry would be another platform request in the log, and a platform
 * error is what QA wants to see. Nothing refetches on window focus; auto-refresh is explicit per screen.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15_000 },
      mutations: { retry: false },
    },
  });
}

function Live() {
  useStream();
  return null;
}

/** A data router: the browser one in the app, a memory one in tests. */
type Router = ReturnType<typeof createBrowserRouter>;

export function App({ router, queryClient }: { router?: Router; queryClient?: QueryClient }) {
  const [qc] = useState(() => queryClient ?? createQueryClient());
  const [r] = useState(() => router ?? createBrowserRouter(routes));
  return (
    <QueryClientProvider client={qc}>
      <Live />
      <RouterProvider router={r} />
      <Toaster />
    </QueryClientProvider>
  );
}
