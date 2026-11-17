import { useEffect, useState } from 'react';
import { formatCountdown } from '@/lib/format';

/** Countdown to a moment; past it — "expired … ago". */
export function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = new Date(until).getTime() - now;
  return (
    <span className={left < 0 ? 'text-muted-foreground' : left < 5 * 60_000 ? 'text-status-warning-fg' : undefined}>
      {left >= 0 ? `${formatCountdown(left)} left` : `expired ${formatCountdown(-left)} ago`}
    </span>
  );
}
