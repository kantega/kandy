import type React from "react";
import { useCallback, useEffect, useRef } from "react";

/**
 * How long a single click waits for a second one before it counts. Close to
 * the macOS default double-click interval, short enough not to feel laggy.
 */
const DOUBLE_CLICK_WINDOW_MS = 250;

interface SingleOrDoubleClickHandlers {
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

/**
 * Lets one element carry separate single- and double-click actions.
 *
 * A double click also fires two click events, so the single action is held
 * back until the double-click window has passed. A click that ends a text
 * selection is ignored, so selecting a sentence to copy it does not also
 * toggle the element. Keyboard activation (`detail === 0`) runs at once.
 */
export const useSingleOrDoubleClick = (
  onSingle?: () => void,
  onDouble?: () => void,
): SingleOrDoubleClickHandlers => {
  const timerRef = useRef<number>();

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      if (!onSingle) return;
      if (event.detail === 0) {
        onSingle();
        return;
      }
      if (event.detail > 1) return;
      if (window.getSelection()?.toString()) return;

      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(onSingle, DOUBLE_CLICK_WINDOW_MS);
    },
    [onSingle],
  );

  const onDoubleClick = useCallback(() => {
    window.clearTimeout(timerRef.current);
    onDouble?.();
  }, [onDouble]);

  return { onClick, onDoubleClick };
};
