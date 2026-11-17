import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/** Copies a value to the clipboard (needs HTTPS or localhost). */
export function CopyButton({
  value,
  label = 'Copy',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-7 text-muted-foreground', className)}
      aria-label={label}
      title={label}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => toast.error('The clipboard is not available'),
        );
      }}
    >
      {done ? <Check /> : <Copy />}
    </Button>
  );
}
