import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Meeting } from "@/bindings";
import { AudioPlayerGroup } from "../../ui/AudioPlayer";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { MeetingCard } from "./MeetingCard";
import { buildSnippet } from "./MeetingSearch";
import type { MeetingActions } from "./useMeetings";

interface MeetingListProps {
  meetings: Meeting[];
  /** Total before filtering, for the empty-state distinction. */
  total: number;
  query: string;
  terms: string[];
  model: string;
  hasKey: boolean;
  summarizingId: number | null;
  defaultPrompt: string;
  actions: MeetingActions;
}

/** `undefined` = automatic (newest open when not searching). */
type Expanded = number | null | undefined;

export const MeetingList: React.FC<MeetingListProps> = ({
  meetings,
  total,
  query,
  terms,
  model,
  hasKey,
  summarizingId,
  defaultPrompt,
  actions,
}) => {
  const { t } = useTranslation();
  const searching = terms.length > 0;

  const [expanded, setExpanded] = useState<Expanded>(undefined);
  const [lastQuery, setLastQuery] = useState(query);
  // A new search collapses everything; clearing it returns to automatic.
  if (query !== lastQuery) {
    setLastQuery(query);
    setExpanded(searching ? null : undefined);
  }
  const expandedId =
    expanded === undefined
      ? searching
        ? null
        : (meetings[0]?.id ?? null)
      : expanded;

  const [pendingDelete, setPendingDelete] = useState<Meeting | null>(null);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await actions.deleteMeeting(pendingDelete.id);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const snippets = useMemo(
    () =>
      new Map(
        searching
          ? meetings.map((m) => [m.id, buildSnippet(m, terms)] as const)
          : [],
      ),
    [meetings, terms, searching],
  );

  return (
    <div className="space-y-2">
      <h2 className="px-4 text-[11px] font-semibold text-mid-gray uppercase tracking-wider">
        {t("meeting.pastMeetings")}
      </h2>

      {total === 0 ? (
        <div className="bg-surface border border-card-border shadow-card rounded-lg px-4 py-8 text-center text-sm text-mid-gray">
          {t("meeting.empty")}
        </div>
      ) : meetings.length === 0 ? (
        <div className="bg-surface border border-card-border shadow-card rounded-lg px-4 py-8 text-center text-sm text-mid-gray">
          {t("meeting.search.noMatches", { query: query.trim() })}
        </div>
      ) : (
        <AudioPlayerGroup>
          <div className="space-y-2">
            {meetings.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                model={model}
                hasKey={hasKey}
                summarizing={summarizingId === m.id}
                expanded={expandedId === m.id}
                onToggle={() => setExpanded(expandedId === m.id ? null : m.id)}
                terms={terms}
                snippet={snippets.get(m.id) ?? null}
                defaultPrompt={defaultPrompt}
                onRequestDelete={() => setPendingDelete(m)}
                actions={actions}
              />
            ))}
          </div>
        </AudioPlayerGroup>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        title={t("meeting.deleteDialog.title")}
        description={pendingDelete?.title}
        closeLabel={t("meeting.deleteDialog.cancel")}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              {t("meeting.deleteDialog.cancel")}
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {t("meeting.deleteDialog.confirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text/80">
          {t("meeting.deleteDialog.description")}
        </p>
      </Dialog>
    </div>
  );
};
