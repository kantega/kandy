import React, { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Loader2, Pencil, X } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { Button } from "./Button";
import { Textarea } from "./Textarea";

/** How the stored value should be rendered while not editing. */
export type EditableTextFormat = "markdown" | "text";

interface EditableTextProps {
  value: string;
  /**
   * Persists the edited value. Rejecting keeps the editor open with the draft
   * intact so the user does not lose their work.
   */
  onSave: (value: string) => Promise<void>;
  /** Defaults to `"markdown"`. Use `"text"` for transcripts. */
  format?: EditableTextFormat;
  /** Accessible name for the edit affordance, e.g. "Edit summary". */
  editLabel: string;
  /** Shown in place of the content when the value is empty. */
  emptyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Visible rows of the textarea while editing. */
  rows?: number;
  /** Extra controls shown beside the edit button while in read mode. */
  actions?: React.ReactNode;
}

const MARKDOWN_CLASSES =
  "max-w-none text-sm text-text/90 space-y-1 whitespace-normal [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_em]:italic [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-mid-gray/40 [&_blockquote]:pl-3 [&_blockquote]:text-text/70 [&_code]:font-mono [&_code]:text-[0.9em]";

/**
 * A block of markdown or plain text that can be edited in place.
 *
 * Read-only by default, with a pencil affordance that swaps the rendered
 * content for a textarea plus Save and Cancel. Saving is async: the control
 * shows a spinner, blocks a second submit, and reports failure as a toast
 * without discarding the draft.
 */
export const EditableText: React.FC<EditableTextProps> = ({
  value,
  onSave,
  format = "markdown",
  editLabel,
  emptyLabel,
  placeholder,
  disabled = false,
  className = "",
  rows = 8,
  actions,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Pick up outside changes (a regenerated summary, say) while not editing, so
  // the editor never opens on stale content.
  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  const isDirty = draft !== value;

  const handleCancel = useCallback(() => {
    setDraft(value);
    setIsEditing(false);
  }, [value]);

  const handleSave = useCallback(async () => {
    if (isSaving || !isDirty) {
      if (!isDirty) setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(draft);
      if (!mountedRef.current) return;
      setIsEditing(false);
    } catch (error) {
      if (!mountedRef.current) return;
      // Stay in edit mode — the draft is the user's only copy at this point.
      toast.error(t("export.edit.saveFailed"), { description: String(error) });
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [draft, isDirty, isSaving, onSave, t]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleCancel();
      return;
    }
    // Plain Enter has to insert a newline in a multi-line editor, so submit is
    // on the modifier chord instead.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSave();
    }
  };

  if (isEditing) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <Textarea
          // The textarea only mounts on entering edit mode, so autoFocus is
          // enough and avoids needing a forwarded ref on the shared control.
          autoFocus
          value={draft}
          rows={rows}
          placeholder={placeholder}
          disabled={isSaving}
          aria-label={editLabel}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full font-normal"
        />
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-mid-gray">
            {t("export.edit.hint")}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCancel}
            disabled={isSaving}
            className="flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" />
            {t("export.edit.cancel")}
          </Button>
          <Button
            variant="primary-soft"
            size="sm"
            onClick={() => void handleSave()}
            disabled={isSaving || !isDirty}
            className="flex items-center gap-1.5"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {isSaving ? t("export.edit.saving") : t("export.edit.save")}
          </Button>
        </div>
      </div>
    );
  }

  const hasContent = value.trim().length > 0;

  return (
    <div className={`group/editable flex flex-col gap-1 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {hasContent ? (
            format === "markdown" ? (
              <div className={MARKDOWN_CLASSES}>
                <ReactMarkdown>{value}</ReactMarkdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-text/90">
                {value}
              </p>
            )
          ) : (
            <p className="text-sm italic text-mid-gray">
              {emptyLabel ?? t("export.edit.empty")}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            disabled={disabled}
            title={editLabel}
            aria-label={editLabel}
            className={`rounded-md border border-transparent p-1 text-mid-gray transition-colors hover:border-mid-gray/20 hover:bg-mid-gray/10 hover:text-text focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary ${
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
