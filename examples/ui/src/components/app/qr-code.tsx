import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

/**
 * QR code of a payment address: a wallet scans the address; the amount and network are chosen by hand. Drawn on a
 * canvas, so a strict CSP (`img-src 'self'`) needs no `data:`.
 */
export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    QRCode.toCanvas(canvas.current, value, { margin: 1, width: size, errorCorrectionLevel: 'M' }).catch(() => {
      // No canvas (tests) or a value too long: the address is shown as text anyway
    });
  }, [value, size]);
  return (
    <canvas
      ref={canvas}
      width={size}
      height={size}
      role="img"
      aria-label={`QR code of ${value}`}
      className="rounded-md bg-white p-1"
    />
  );
}
