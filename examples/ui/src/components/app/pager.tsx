import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Pages of a list: "1–20 of 135", back and forward. */
export function Pager({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const last = Math.max(1, Math.ceil(total / limit));
  return (
    <nav aria-label="Pages" className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <Button
        variant="outline"
        size="icon"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label="Next page"
        disabled={page >= last}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight />
      </Button>
    </nav>
  );
}
