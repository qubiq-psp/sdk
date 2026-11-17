/**
 * Ref of a scrolling block without focusable children (a table wider than the screen, long JSON): the block is in the
 * tab order only while it has something to scroll on either axis, so it can be scrolled from the keyboard (axe
 * scrollable-region-focusable). Returns the cleanup (a React 19 ref callback).
 */
export function scrollFocus(element: HTMLElement | null): (() => void) | undefined {
  if (!element || typeof ResizeObserver === 'undefined') return undefined;
  const update = () => {
    const scrolls = element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
    if (scrolls) element.tabIndex = 0;
    else element.removeAttribute('tabindex');
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(element);
  for (const child of element.children) observer.observe(child);
  return () => {
    observer.disconnect();
  };
}
