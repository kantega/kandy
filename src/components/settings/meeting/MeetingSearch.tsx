import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import type { Meeting } from "@/bindings";
import { Input } from "../../ui/Input";
import { IconButton } from "../../ui/IconButton";

/** Lower-cased, whitespace-separated terms. Empty when nothing is typed. */
export function parseSearchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every term must occur somewhere in title, summary or transcript. */
export function meetingMatches(meeting: Meeting, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack =
    `${meeting.title}\n${meeting.summary ?? ""}\n${meeting.transcript}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

const SNIPPET_RADIUS = 70;

/**
 * Removes markdown syntax so a snippet reads as prose: heading marks, list
 * markers, blockquote marks, backticks, emphasis and link brackets.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`+/g, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?!\w)/g, "$1$2")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/**
 * One line of context around the first term hit. Summary is preferred over
 * transcript because it is the text the user is most likely to recognise.
 * Returns null when no body text contains a term (the hit was in the title).
 */
export function buildSnippet(meeting: Meeting, terms: string[]): string | null {
  for (const source of [meeting.summary ?? "", meeting.transcript]) {
    const flat = stripMarkdown(source).replace(/\s+/g, " ").trim();
    if (!flat) continue;
    const lower = flat.toLowerCase();
    let first = -1;
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1 && (first === -1 || idx < first)) first = idx;
    }
    if (first === -1) continue;
    const start = Math.max(0, first - SNIPPET_RADIUS);
    const end = Math.min(flat.length, first + SNIPPET_RADIUS);
    return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface HighlightProps {
  text: string;
  terms: string[];
}

/** Wraps every occurrence of a term in `<mark>`. */
export const Highlight: React.FC<HighlightProps> = ({ text, terms }) => {
  const parts = useMemo(() => {
    if (terms.length === 0) return [text];
    const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
    return text.split(pattern);
  }, [text, terms]);
  if (terms.length === 0) return <>{text}</>;
  const lowerTerms = new Set(terms);
  return (
    <>
      {parts.map((part, i) =>
        lowerTerms.has(part.toLowerCase()) ? (
          <mark
            key={i}
            className="bg-logo-primary/20 text-inherit rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
};

interface MeetingSearchProps {
  value: string;
  onChange: (value: string) => void;
  shown: number;
  total: number;
}

export const MeetingSearch: React.FC<MeetingSearchProps> = ({
  value,
  onChange,
  shown,
  total,
}) => {
  const { t } = useTranslation();
  const active = value.trim() !== "";

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search
          className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mid-gray pointer-events-none"
          aria-hidden="true"
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && value !== "") {
              e.preventDefault();
              onChange("");
            }
          }}
          placeholder={t("meeting.search.placeholder")}
          aria-label={t("meeting.search.label")}
          autoComplete="off"
          spellCheck={false}
          className={`w-full font-normal ps-9 ${active ? "pe-9" : ""}`}
        />
        {active && (
          <IconButton
            label={t("meeting.search.clear")}
            onClick={() => onChange("")}
            className="absolute end-1 top-1/2 -translate-y-1/2"
          >
            <X className="w-4 h-4" />
          </IconButton>
        )}
      </div>
      {active && (
        <span
          className="text-xs text-mid-gray tabular-nums shrink-0"
          aria-live="polite"
        >
          {t("meeting.search.count", { shown, total })}
        </span>
      )}
    </div>
  );
};
