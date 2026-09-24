import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

/** How long the confirmation stays on screen after a write. */
const VISIBLE_MS = 1500;

interface SavedHint {
  /** Render next to the field. Null while nothing has just been saved. */
  element: React.ReactNode;
  /** Call after a successful write. */
  markSaved: () => void;
}

/**
 * Inline confirmation for single-line fields that commit on blur or Enter.
 * Without a Save button to click, the write needs some acknowledgement, and a
 * toast is too loud for a one-word setting.
 */
export const useSavedHint = (): SavedHint => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const markSaved = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(true);
    timer.current = setTimeout(() => setVisible(false), VISIBLE_MS);
  }, []);

  const element = visible ? (
    <span
      role="status"
      className="flex shrink-0 items-center gap-1 text-xs text-success"
    >
      <Check className="w-3.5 h-3.5" aria-hidden="true" />
      {t("common.saved")}
    </span>
  ) : null;

  return { element, markSaved };
};
