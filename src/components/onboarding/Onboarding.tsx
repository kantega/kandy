import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import type { ModelInfo } from "@/bindings";
import type { ModelCardStatus } from "./ModelCard";
import ModelCard from "./ModelCard";
import KandyTextLogo from "../icons/KandyTextLogo";
import { useModelStore } from "../../stores/modelStore";

/**
 * White card on the dark onboarding backdrop. `.scope-light` re-points the
 * palette so the ModelCard inside renders with its light-theme tokens even
 * when the app is in dark mode.
 */
const LightCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="scope-light bg-surface text-text rounded-xl border border-edge shadow-card">
    {children}
  </div>
);

interface OnboardingProps {
  onModelSelected: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onModelSelected }) => {
  const { t } = useTranslation();
  const {
    models,
    downloadModel,
    selectModel,
    downloadingModels,
    verifyingModels,
    downloadProgress,
    downloadStats,
    cancelDownload,
  } = useModelStore();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const hasStartedSelection = useRef(false);

  const isBusy = selectedModelId !== null;

  // Curate the download list. The catalog arrives rank-sorted, so the first two
  // recommended models are the featured picks. Everything else hides behind
  // "Show all".
  const { downloadable, topPicks, otherRecommended, rest } = useMemo(() => {
    // Kandy is Norwegian-first: hide any download candidate that does not list
    // Norwegian (nb / no / nn) among its supported languages. Models with an
    // empty `supported_languages` are treated as multilingual (Whisper etc.
    // report language coverage via `supports_language_selection`, and those
    // handle every language Whisper does — norsk included).
    const supportsNorwegian = (m: ModelInfo): boolean => {
      const langs = m.supported_languages ?? [];
      if (langs.length === 0) return m.supports_language_selection;
      return langs.some((c) => ["nb", "no", "nn"].includes(c.toLowerCase()));
    };
    const downloadable = models.filter(
      (m: ModelInfo) => !m.is_downloaded && supportsNorwegian(m),
    );
    const recommended = downloadable.filter((m: ModelInfo) => m.is_recommended);
    // `models` arrives in editorial rank order (the backend sorts by rank_of,
    // then accuracy), so keep that order here: ranked-but-not-recommended models
    // surface first, then the unranked tail by accuracy.
    const rest = downloadable.filter((m: ModelInfo) => !m.is_recommended);
    return {
      downloadable,
      topPicks: recommended.slice(0, 2),
      otherRecommended: recommended.slice(2),
      rest,
    };
  }, [models]);

  const hasRecommended = topPicks.length > 0 || otherRecommended.length > 0;
  // When nothing recommended remains to download (e.g. all already on disk),
  // there is no curated subset to collapse, so just show the full list.
  const showRest = showAll || !hasRecommended;

  // Watch for the selected model to finish downloading + verifying
  useEffect(() => {
    if (!selectedModelId) {
      hasStartedSelection.current = false;
      return;
    }

    const model = models.find((m) => m.id === selectedModelId);
    const stillDownloading = selectedModelId in downloadingModels;
    const stillVerifying = selectedModelId in verifyingModels;

    if (
      model?.is_downloaded &&
      !stillDownloading &&
      !stillVerifying &&
      !hasStartedSelection.current
    ) {
      hasStartedSelection.current = true;

      // Model is ready — select it and transition
      selectModel(selectedModelId).then((success) => {
        if (success) {
          onModelSelected();
        } else {
          toast.error(t("onboarding.errors.selectModel"));
          hasStartedSelection.current = false;
          setSelectedModelId(null);
        }
      });
    }
  }, [
    selectedModelId,
    models,
    downloadingModels,
    verifyingModels,
    selectModel,
    onModelSelected,
    t,
  ]);

  const handleDownloadModel = async (modelId: string) => {
    setSelectedModelId(modelId);

    // Error toast is handled centrally by the model-download-failed event listener
    // in modelStore — no toast here to avoid duplicates.
    const success = await downloadModel(modelId);
    if (!success) {
      setSelectedModelId(null);
    }
  };

  const handleCancelDownload = async (modelId: string) => {
    const success = await cancelDownload(modelId);
    if (success) {
      setSelectedModelId(null);
    }
  };

  const handleSelectExistingModel = (modelId: string) => {
    setSelectedModelId(modelId);
  };

  const getModelStatus = (modelId: string): ModelCardStatus => {
    if (modelId in verifyingModels) return "verifying";
    if (modelId in downloadingModels) return "downloading";
    return "downloadable";
  };

  const getExistingModelStatus = (modelId: string): ModelCardStatus => {
    if (selectedModelId === modelId) return "switching";
    return "available";
  };

  const getModelDownloadProgress = (modelId: string): number | undefined => {
    return downloadProgress[modelId]?.percentage;
  };

  const getModelDownloadSpeed = (modelId: string): number | undefined => {
    return downloadStats[modelId]?.speed;
  };

  return (
    <div className="scope-dark bg-brand-gradient text-text h-screen w-full flex flex-col p-6 gap-4 overflow-y-auto">
      <div className="flex flex-col items-center gap-2 shrink-0">
        <KandyTextLogo width={200} wordmark="text" />
        <p className="text-text/85 max-w-md font-medium mx-auto">
          {t("onboarding.subtitle")}
        </p>
      </div>

      <div className="max-w-[600px] w-full mx-auto text-center flex-1 flex flex-col min-h-0">
        <div className="space-y-6 pb-6">
          {models.some(
            (m: ModelInfo) =>
              m.is_downloaded &&
              ((m.supported_languages ?? []).length === 0
                ? m.supports_language_selection
                : (m.supported_languages ?? []).some((c) =>
                    ["nb", "no", "nn"].includes(c.toLowerCase()),
                  )),
          ) && (
            <div className="space-y-3">
              <div className="text-left">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-mid-gray">
                  {t("onboarding.existingModelsTitle")}
                </h2>
              </div>
              {models
                .filter(
                  (m: ModelInfo) =>
                    m.is_downloaded &&
                    ((m.supported_languages ?? []).length === 0
                      ? m.supports_language_selection
                      : (m.supported_languages ?? []).some((c) =>
                          ["nb", "no", "nn"].includes(c.toLowerCase()),
                        )),
                )
                .map((model: ModelInfo) => (
                  <LightCard key={model.id}>
                    <ModelCard
                      model={model}
                      status={getExistingModelStatus(model.id)}
                      disabled={isBusy}
                      onSelect={handleSelectExistingModel}
                      showRecommended={false}
                    />
                  </LightCard>
                ))}
            </div>
          )}

          {downloadable.length > 0 && (
            <div className="space-y-3">
              <div className="text-left">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-mid-gray">
                  {t("onboarding.downloadModelsTitle")}
                </h2>
              </div>

              {topPicks.map((model: ModelInfo) => (
                <LightCard key={model.id}>
                  <ModelCard
                    model={model}
                    variant="featured"
                    status={getModelStatus(model.id)}
                    disabled={isBusy}
                    onSelect={handleDownloadModel}
                    onDownload={handleDownloadModel}
                    onCancel={handleCancelDownload}
                    downloadProgress={getModelDownloadProgress(model.id)}
                    downloadSpeed={getModelDownloadSpeed(model.id)}
                    showRecommended={false}
                  />
                </LightCard>
              ))}

              {otherRecommended.map((model: ModelInfo) => (
                <LightCard key={model.id}>
                  <ModelCard
                    model={model}
                    status={getModelStatus(model.id)}
                    disabled={isBusy}
                    onSelect={handleDownloadModel}
                    onDownload={handleDownloadModel}
                    onCancel={handleCancelDownload}
                    downloadProgress={getModelDownloadProgress(model.id)}
                    downloadSpeed={getModelDownloadSpeed(model.id)}
                    showRecommended={false}
                  />
                </LightCard>
              ))}

              {hasRecommended && rest.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="flex items-center justify-center gap-1.5 mx-auto py-1 px-2 rounded-md text-sm font-medium text-text/85 hover:text-text transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-off-white"
                >
                  {showAll
                    ? t("onboarding.showFewerModels")
                    : t("onboarding.showAllModels", {
                        total: downloadable.length,
                      })}
                  <ChevronDown
                    className={`w-4 h-4 transition-transform duration-200 ${
                      showAll ? "rotate-180" : ""
                    }`}
                  />
                </button>
              )}

              {showRest &&
                rest.map((model: ModelInfo) => (
                  <LightCard key={model.id}>
                    <ModelCard
                      model={model}
                      status={getModelStatus(model.id)}
                      disabled={isBusy}
                      onSelect={handleDownloadModel}
                      onDownload={handleDownloadModel}
                      onCancel={handleCancelDownload}
                      downloadProgress={getModelDownloadProgress(model.id)}
                      downloadSpeed={getModelDownloadSpeed(model.id)}
                      showRecommended={false}
                    />
                  </LightCard>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
