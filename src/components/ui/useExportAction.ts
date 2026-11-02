import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { saveExport } from "@/lib/export";
import type { ExportDoc, ExportFormat } from "@/lib/export";

/**
 * Export a document: render it, open the save dialog, write the file and
 * report the outcome as a toast. A dismissed save dialog stays silent.
 */
export const useExportAction = () => {
  const { t } = useTranslation();

  return useCallback(
    async (doc: ExportDoc, format: ExportFormat): Promise<void> => {
      try {
        const result = await saveExport(doc, format);
        if (result.saved) {
          toast.success(t("export.saved"), { description: result.path });
        }
      } catch (error) {
        toast.error(t("export.errors.failed"), { description: String(error) });
      }
    },
    [t],
  );
};
