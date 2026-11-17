import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Toasts: light or dark theme by the system setting. */
function Toaster(props: ToasterProps) {
  return <Sonner theme="system" position="bottom-right" richColors closeButton className="toaster group" {...props} />;
}

export { Toaster };
