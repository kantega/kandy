import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Circle, Loader2 } from "lucide-react";

export interface MeetingStep {
  label: string;
  done: boolean;
  running: boolean;
  /** Starts the step. Shown as a link while the step is missing. */
  onRun: () => void;
  /** Tooltip on the link, e.g. "Make chapters". */
  runLabel: string;
}

interface MeetingStatusLineProps {
  steps: MeetingStep[];
  /** Without an LLM key nothing can run; the line says why instead. */
  hasKey: boolean;
}

/**
 * One quiet line for the steps that run after transcription: summary,
 * chapters, improved transcript. Done steps get a tick, a running step a
 * spinner, and a missing step is a link that starts it. Hidden once every
 * step is done.
 */
export const MeetingStatusLine: React.FC<MeetingStatusLineProps> = ({
  steps,
  hasKey,
}) => {
  const { t } = useTranslation();
  if (steps.every((step) => step.done && !step.running)) return null;
  const anyRunning = steps.some((step) => step.running);

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mid-gray"
      aria-live="polite"
    >
      {steps.map((step, index) => (
        <React.Fragment key={step.label}>
          {index > 0 && <span aria-hidden="true">·</span>}
          <span className="flex items-center gap-1">
            {step.running ? (
              <Loader2
                className="w-3.5 h-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : step.done ? (
              <Check className="w-3.5 h-3.5 text-success" aria-hidden="true" />
            ) : (
              <Circle className="w-3 h-3" aria-hidden="true" />
            )}
            {!step.done && !step.running && hasKey && !anyRunning ? (
              <button
                type="button"
                onClick={step.onRun}
                title={step.runLabel}
                className="rounded underline decoration-dotted underline-offset-2 cursor-pointer transition-colors hover:text-logo-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
              >
                {step.label}
              </button>
            ) : (
              <span className={step.done ? "text-text/70" : undefined}>
                {step.label}
              </span>
            )}
          </span>
        </React.Fragment>
      ))}
      {!hasKey && <span>{t("meeting.addKeyHint")}</span>}
    </div>
  );
};
