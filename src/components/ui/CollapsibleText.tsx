import React, { useCallback, useState } from "react";

import { useSingleOrDoubleClick } from "@/hooks/useSingleOrDoubleClick";

import { EditableText, type EditableTextProps } from "./EditableText";

/** Characters of the first line kept for the collapsed preview. */
const PREVIEW_LENGTH = 100;

/**
 * First line of the text, clipped, for the collapsed row. Leading markdown
 * markers (headings, bullets, quotes) and bold markers are dropped so a
 * summary previews as words, not syntax.
 */
const previewOf = (text: string): string => {
  const firstLine =
    text
      .trim()
      .split("\n")
      .map((line) => line.replace(/^[#>*\-\s]+/, "").replace(/\*\*/g, ""))
      .find((line) => line.trim().length > 0) ?? "";
  return firstLine.length > PREVIEW_LENGTH
    ? `${firstLine.slice(0, PREVIEW_LENGTH).trimEnd()}…`
    : firstLine;
};

interface CollapsibleTextProps
  extends Omit<EditableTextProps, "onTextClick" | "startEditing"> {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Tooltip on the collapsed preview, e.g. "Show full transcript". */
  expandLabel: string;
}

/**
 * An [`EditableText`] that folds to a one-line preview.
 *
 * Single click on the text collapses it, single click on the preview expands
 * it, and a double click on either opens the editor. Empty text is shown in
 * full, since there is nothing to fold.
 */
export const CollapsibleText: React.FC<CollapsibleTextProps> = ({
  expanded,
  onExpandedChange,
  expandLabel,
  ...editable
}) => {
  /** Open the editor as the text expands, after a double click. */
  const [editOnExpand, setEditOnExpand] = useState(false);

  const expand = useCallback(() => {
    setEditOnExpand(false);
    onExpandedChange(true);
  }, [onExpandedChange]);

  const expandAndEdit = useCallback(() => {
    if (editable.disabled) return;
    setEditOnExpand(true);
    onExpandedChange(true);
  }, [editable.disabled, onExpandedChange]);

  const collapse = useCallback(() => {
    setEditOnExpand(false);
    onExpandedChange(false);
  }, [onExpandedChange]);

  const previewClickHandlers = useSingleOrDoubleClick(expand, expandAndEdit);
  const hasContent = editable.value.trim().length > 0;

  if (!hasContent) {
    return <EditableText {...editable} />;
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className={`block w-full text-start text-sm text-text/70 truncate cursor-pointer hover:text-text focus:outline-none focus-visible:underline ${editable.className ?? ""}`}
        {...previewClickHandlers}
        title={expandLabel}
      >
        {previewOf(editable.value)}
      </button>
    );
  }

  return (
    <EditableText
      {...editable}
      onTextClick={collapse}
      startEditing={editOnExpand}
    />
  );
};
