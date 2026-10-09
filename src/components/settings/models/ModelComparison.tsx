import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FileAudio, History, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { commands } from "@/bindings";
import type {
  ModelComparison as ComparisonResult,
  ModelInfo,
} from "@/bindings";
import { useModelStore } from "@/stores/modelStore";
import { getTranslatedModelName } from "@/lib/utils/modelTranslation";
import { diffWords, type DiffWord } from "@/lib/utils/wordDiff";
import { SUPPORTED_AUDIO_EXTENSIONS } from "../meeting/useMeetings";
import Badge from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";

/**
 * Side-by-side comparison of two downloaded models on the same clip: the
 * latest dictation or an audio file. Each model loads into its own session in
 * the backend, so the active model is not switched until the user picks one.
 */
export const ModelComparison: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { models, currentModel, selectModel } = useModelStore();
  const downloaded = useMemo(
    () => models.filter((m: ModelInfo) => m.is_downloaded),
    [models],
  );
  const options = downloaded.map((m) => ({
    value: m.id,
    label: getTranslatedModelName(m, t),
  }));

  const [modelA, setModelA] = useState<string | null>(null);
  const [modelB, setModelB] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);

  // Default to the active model against the first other downloaded model.
  const a = modelA ?? (currentModel || downloaded[0]?.id) ?? null;
  const b = modelB ?? downloaded.find((m) => m.id !== a)?.id ?? null;

  if (downloaded.length < 2) {
    return null;
  }

  const nameOf = (id: string) => {
    const model = downloaded.find((m) => m.id === id);
    return model ? getTranslatedModelName(model, t) : id;
  };

  const seconds = (value: number) =>
    t("settings.models.compare.seconds", {
      value: value.toLocaleString(i18n.language, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      }),
    });

  const pickFile = async () => {
    const selected = await openFileDialog({
      multiple: false,
      filters: [
        {
          name: t("meeting.audioFiles"),
          extensions: [...SUPPORTED_AUDIO_EXTENSIONS],
        },
      ],
    });
    if (typeof selected === "string") setFilePath(selected);
  };

  const run = async () => {
    if (!a || !b || a === b) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await commands.compareModels(filePath, [a, b]);
      if (r.status === "ok") {
        setResult(r.data);
      } else {
        toast.error(t("settings.models.compare.failed"), {
          description: String(r.error),
        });
      }
    } finally {
      setRunning(false);
    }
  };

  const [first, second] = result?.results ?? [];
  const diff =
    first && second && !first.error && !second.error
      ? diffWords(first.text, second.text)
      : null;

  const renderText = (text: string, words: DiffWord[] | undefined) =>
    words ? (
      <p className="text-sm leading-relaxed">
        {words.map((w, i) => (
          <React.Fragment key={i}>
            <span
              className={
                w.differs ? "rounded bg-logo-primary/20 px-0.5" : undefined
              }
            >
              {w.text}
            </span>{" "}
          </React.Fragment>
        ))}
      </p>
    ) : (
      <p className="text-sm leading-relaxed">{text}</p>
    );

  const sourceLabel = filePath
    ? (filePath.split(/[\\/]/).pop() ?? filePath)
    : t("settings.models.compare.latestDictation");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-4">
        <h2 className="text-[11px] font-semibold text-mid-gray uppercase tracking-wider">
          {t("settings.models.compare.title")}
        </h2>
        <Badge variant="secondary">{t("modelSelector.experimental")}</Badge>
      </div>

      <div className="rounded-xl border-2 border-mid-gray/20 px-4 py-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Dropdown options={options} selectedValue={a} onSelect={setModelA} />
          <Dropdown options={options} selectedValue={b} onSelect={setModelB} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={filePath ? "secondary" : "primary-soft"}
            size="sm"
            className="flex items-center gap-1.5"
            onClick={() => setFilePath(null)}
          >
            <History className="w-3.5 h-3.5" aria-hidden="true" />
            {t("settings.models.compare.latestDictation")}
          </Button>
          <Button
            variant={filePath ? "primary-soft" : "secondary"}
            size="sm"
            className="flex items-center gap-1.5"
            onClick={() => void pickFile()}
          >
            <FileAudio className="w-3.5 h-3.5" aria-hidden="true" />
            {t("settings.models.compare.pickFile")}
          </Button>
          <span className="text-xs text-mid-gray truncate">{sourceLabel}</span>
          <Button
            size="sm"
            className="ms-auto flex items-center gap-1.5"
            disabled={running || !a || !b || a === b}
            onClick={() => void run()}
          >
            {running ? (
              <Loader2
                className="w-3.5 h-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {running
              ? t("settings.models.compare.running")
              : t("settings.models.compare.run")}
          </Button>
        </div>
        {a && b && a === b && (
          <p className="text-xs text-warning">
            {t("settings.models.compare.sameModel")}
          </p>
        )}
      </div>

      {result && (
        <div className="space-y-3">
          <p className="px-4 text-xs text-mid-gray">
            {t("settings.models.compare.clip", {
              name: result.source_name,
              duration: seconds(result.audio_seconds),
            })}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {result.results.map((r, idx) => (
              <div
                key={r.model_id}
                className="rounded-xl border-2 border-mid-gray/20 px-4 py-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {nameOf(r.model_id)}
                  </h3>
                  <Badge variant="secondary">{seconds(r.seconds)}</Badge>
                </div>
                {r.error ? (
                  <p className="text-sm text-error">{r.error}</p>
                ) : (
                  renderText(r.text, idx === 0 ? diff?.a : diff?.b)
                )}
                {!r.error && r.model_id !== currentModel && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void selectModel(r.model_id)}
                  >
                    {t("settings.models.compare.use", {
                      name: nameOf(r.model_id),
                    })}
                  </Button>
                )}
              </div>
            ))}
          </div>
          {diff && (
            <p className="px-4 text-xs text-mid-gray">
              {t("settings.models.compare.differing", {
                count: diff.differing,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
