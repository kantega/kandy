import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface InlineTitleProps {
  value: string;
  /** Accessible name and tooltip for the editing affordance. */
  label: string;
  /** Rejecting keeps the old title and reports the failure as a toast. */
  onSave: (value: string) => Promise<void>;
  className?: string;
}

/**
 * Single-line title that turns into an input where it stands. The text itself
 * is the affordance, so there is no pencil to aim at. Enter and blur save,
 * Escape reverts, an empty title is treated as a cancel.
 *
 * Clicks and keystrokes stop here so the surrounding expand/collapse row never
 * reacts to the title being edited.
 */
export const InlineTitle: React.FC<InlineTitleProps> = ({
  value,
  label,
  onSave,
  className = "",
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Enter saves and unmounts the input, which fires blur in turn. One commit
  // per edit, whichever of the two gets there first.
  const settled = useRef(false);

  const startEditing = useCallback(() => {
    setDraft(value);
    settled.current = false;
    setEditing(true);
  }, [value]);

  const commit = useCallback(async () => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);

    const next = draft.trim();
    if (next === "" || next === value) return;
    try {
      await onSave(next);
    } catch (error) {
      toast.error(t("export.edit.saveFailed"), { description: String(error) });
    }
  }, [draft, onSave, t, value]);

  const cancel = useCallback(() => {
    settled.current = true;
    setEditing(false);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        void commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    },
    [cancel, commit],
  );

  if (editing) {
    return (
      <input
        // The input only mounts on entering edit mode, so autoFocus is enough.
        autoFocus
        type="text"
        value={draft}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => void commit()}
        onFocus={(event) => event.target.select()}
        className={`w-full min-w-0 rounded border border-logo-primary bg-logo-primary/10 px-1 py-0.5 text-sm font-medium text-text focus:outline-none ${className}`}
      />
    );
  }

  return (
    <button
      type="button"
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        startEditing();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`block w-full min-w-0 truncate rounded border border-transparent px-1 py-0.5 text-start text-sm font-medium text-text cursor-text transition-colors hover:border-mid-gray/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary ${className}`}
    >
      {value}
      <span className="sr-only">{label}</span>
    </button>
  );
};
