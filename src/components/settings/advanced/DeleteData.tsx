import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { commands } from "@/bindings";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { SettingContainer } from "../../ui/SettingContainer";

/** What the open confirmation is about, with the count it names. */
type Pending =
  | { kind: "history"; count: number }
  | { kind: "meetings"; ids: number[] };

const pendingCount = (pending: Pending): number =>
  pending.kind === "history" ? pending.count : pending.ids.length;

/**
 * Bulk deletes, kept out of the panes where the data is read.
 *
 * History includes starred entries here: this row is the "everything goes"
 * action, and the confirmation says so. Per-entry and selection deletes in the
 * History pane still protect starred entries.
 */
export const DeleteData: React.FC = () => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const openHistoryConfirm = async () => {
    const result = await commands.getHistoryStats();
    if (result.status !== "ok") {
      console.error("Failed to read history stats:", result.error);
      toast.error(t("settings.advanced.deleteData.error"));
      return;
    }
    if (result.data.total === 0) {
      toast.info(t("settings.advanced.deleteData.empty"));
      return;
    }
    setPending({ kind: "history", count: result.data.total });
  };

  const openMeetingsConfirm = async () => {
    const result = await commands.getMeetings();
    if (result.status !== "ok") {
      console.error("Failed to read meetings:", result.error);
      toast.error(t("settings.advanced.deleteData.error"));
      return;
    }
    if (result.data.length === 0) {
      toast.info(t("settings.advanced.deleteData.empty"));
      return;
    }
    setPending({ kind: "meetings", ids: result.data.map((m) => m.id) });
  };

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      if (pending.kind === "history") {
        const result = await commands.deleteAllHistoryEntries(true);
        if (result.status !== "ok") throw new Error(String(result.error));
        toast.success(
          t("settings.history.deletedCount", { count: result.data }),
        );
      } else {
        // One at a time: the backend deletes the row and its audio file per
        // call, and a partial failure should stop rather than fan out.
        let deleted = 0;
        for (const id of pending.ids) {
          const result = await commands.deleteMeeting(id);
          if (result.status !== "ok") throw new Error(String(result.error));
          deleted += 1;
        }
        toast.success(
          t("settings.advanced.deleteData.meetingsDeleted", {
            count: deleted,
          }),
        );
      }
      setPending(null);
    } catch (error) {
      console.error("Bulk delete failed:", error);
      toast.error(t("settings.advanced.deleteData.error"), {
        description: String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingContainer
        grouped
        title={t("settings.advanced.deleteData.history.title")}
        description={t("settings.advanced.deleteData.history.description")}
      >
        <Button
          variant="danger-ghost"
          size="sm"
          disabled={busy}
          onClick={() => void openHistoryConfirm()}
          className="flex items-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {t("settings.advanced.deleteData.action")}
        </Button>
      </SettingContainer>

      <SettingContainer
        grouped
        title={t("settings.advanced.deleteData.meetings.title")}
        description={t("settings.advanced.deleteData.meetings.description")}
      >
        <Button
          variant="danger-ghost"
          size="sm"
          disabled={busy}
          onClick={() => void openMeetingsConfirm()}
          className="flex items-center gap-1.5"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {t("settings.advanced.deleteData.action")}
        </Button>
      </SettingContainer>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}
        title={
          pending?.kind === "meetings"
            ? t("settings.advanced.deleteData.meetings.confirmTitle")
            : t("settings.advanced.deleteData.history.confirmTitle")
        }
        description={
          pending
            ? pending.kind === "meetings"
              ? t("settings.advanced.deleteData.meetings.confirmBody", {
                  count: pendingCount(pending),
                })
              : t("settings.advanced.deleteData.history.confirmBody", {
                  count: pendingCount(pending),
                })
            : undefined
        }
        closeLabel={t("settings.advanced.deleteData.cancel")}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              {t("settings.advanced.deleteData.cancel")}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy
                ? t("settings.advanced.deleteData.deleting")
                : t("settings.advanced.deleteData.confirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text/80">
          {t("settings.advanced.deleteData.warning")}
        </p>
      </Dialog>
    </>
  );
};
