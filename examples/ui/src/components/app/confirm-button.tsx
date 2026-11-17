import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** A button that asks first: cancelling an invoice or a payout, creating a payout, clearing a log. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = 'outline',
  destructive = false,
  disabled,
  size = 'sm',
  type = 'button',
}: {
  children: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  variant?: 'outline' | 'default' | 'destructive' | 'ghost' | 'secondary';
  destructive?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'default';
  type?: 'button' | 'submit';
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled} type={type}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Back</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
