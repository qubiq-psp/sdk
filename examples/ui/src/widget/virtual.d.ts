// `virtual:checkout-frame` is the widget of this build: vite.config.ts points it at checkout-frame.sdk.tsx or
// checkout-frame.plain.tsx. Both export the same names.
declare module 'virtual:checkout-frame' {
  import type { ComponentType } from 'react';
  import type { CheckoutFrameProps, WidgetInfo } from '@/widget/types';

  export const CheckoutFrame: ComponentType<CheckoutFrameProps>;
  export const widgetInfo: WidgetInfo;
}
