import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, FileType, Loader2 } from "lucide-react";

import type { ExportDoc, ExportFormat } from "@/lib/export";

import { useExportAction } from "./useExportAction";

interface ExportMenuProps {
  /**
   * Builds the document to export. A callback rather than a value so the
   * caller does not have to serialise a whole transcript on every render.
   */
  buildDoc: () => ExportDoc;
  disabled?: boolean;
  className?: string;
  /** Render only the icon, for tight rows next to other icon buttons. */
  compact?: boolean;
  /** Aligns the popover to the right edge of the trigger. Defaults to true. */
  alignRight?: boolean;
}

export const EXPORT_FORMATS: ReadonlyArray<{
  format: ExportFormat;
  labelKey: string;
  Icon: typeof FileText;
}> = [
  { format: "docx", labelKey: "export.asWord", Icon: FileText },
  { format: "pdf", labelKey: "export.asPdf", Icon: FileType },
];

/**
 * "Export as Word / PDF" menu.
 *
 * Owns the whole interaction: renders the document, opens the save dialog,
 * writes the file and reports the outcome as a toast. Callers only supply the
 * content.
 */
export const ExportMenu: React.FC<ExportMenuProps> = ({
  buildDoc,
  disabled = false,
  className = "",
  compact = false,
  alignRight = true,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const exportDoc = useExportAction();
  // Guards against a state update after the row has been unmounted.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleExport = async (format: ExportFormat) => {
    if (busyFormat !== null) return;

    setIsOpen(false);
    setBusyFormat(format);

    try {
      await exportDoc(buildDoc(), format);
    } finally {
      if (mountedRef.current) setBusyFormat(null);
    }
  };

  const isBusy = busyFormat !== null;
  const isDisabled = disabled || isBusy;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={isDisabled}
        title={t("export.label")}
        aria-label={t("export.label")}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`flex items-center gap-1.5 rounded-md border border-transparent text-mid-gray transition-colors hover:border-mid-gray/20 hover:bg-mid-gray/10 hover:text-text focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary ${
          compact ? "p-1" : "px-2 py-1 text-xs font-medium"
        } ${isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        {isBusy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        {!compact && <span>{t("export.label")}</span>}
      </button>

      {isOpen && !isDisabled && (
        <div
          role="menu"
          className={`absolute top-full z-50 mt-1 min-w-[170px] overflow-hidden rounded-md border border-mid-gray/80 bg-surface shadow-menu ${
            alignRight ? "right-0" : "left-0"
          }`}
        >
          {EXPORT_FORMATS.map(({ format, labelKey, Icon }) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              onClick={() => void handleExport(format)}
              className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-start text-sm transition-colors duration-150 hover:bg-logo-primary/10 focus:bg-logo-primary/10 focus:outline-none"
            >
              <Icon className="w-3.5 h-3.5 shrink-0 text-mid-gray" />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
