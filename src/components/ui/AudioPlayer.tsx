import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { Play, Pause } from "lucide-react";

interface AudioPlayerProps {
  /** Audio source URL. If not provided, onLoadRequest must be provided. */
  src?: string;
  /** Called when play is clicked and no src is loaded yet. Should return the audio URL. */
  onLoadRequest?: () => Promise<string | null>;
  className?: string;
  autoPlay?: boolean;
  /** Playback position in seconds, a few times a second while playing. */
  onTimeUpdate?: (seconds: number) => void;
}

/** Speeds the rate button steps through, wrapping back to 1× after 2×. */
const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;
const PLAYBACK_RATE_KEY = "kandy.playbackRate";

const readStoredRate = (): number => {
  try {
    const stored = Number(localStorage.getItem(PLAYBACK_RATE_KEY));
    return PLAYBACK_RATES.find((rate) => rate === stored) ?? 1;
  } catch {
    return 1;
  }
};

/**
 * One playback speed for every player, so speeding up one recording speeds up
 * the next. Remembered between sessions in localStorage.
 */
const playbackRateStore = (() => {
  let rate = readStoredRate();
  const listeners = new Set<() => void>();
  return {
    get: () => rate,
    set: (next: number) => {
      rate = next;
      try {
        localStorage.setItem(PLAYBACK_RATE_KEY, String(next));
      } catch {
        /* storage unavailable; the rate still applies for this session */
      }
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
})();

const nextPlaybackRate = (rate: number): number => {
  const index = PLAYBACK_RATES.findIndex((r) => r === rate);
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
};

export interface AudioPlayerHandle {
  /** Jump to `seconds` and play, loading the recording first if needed. */
  seekTo: (seconds: number) => void;
}

interface AudioPlayerGroupContextValue {
  requestPlayback: (audio: HTMLAudioElement) => void;
  releasePlayback: (audio: HTMLAudioElement) => void;
}

const AudioPlayerGroupContext =
  createContext<AudioPlayerGroupContextValue | null>(null);

export const AudioPlayerGroup: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const value = useMemo<AudioPlayerGroupContextValue>(
    () => ({
      requestPlayback: (audio) => {
        if (activeAudioRef.current !== audio) activeAudioRef.current?.pause();
        activeAudioRef.current = audio;
      },
      releasePlayback: (audio) => {
        if (activeAudioRef.current === audio) activeAudioRef.current = null;
      },
    }),
    [],
  );

  return (
    <AudioPlayerGroupContext.Provider value={value}>
      {children}
    </AudioPlayerGroupContext.Provider>
  );
};

const AudioPlayerBase: React.ForwardRefRenderFunction<
  AudioPlayerHandle,
  AudioPlayerProps
> = (
  {
    src: initialSrc,
    onLoadRequest,
    className = "",
    autoPlay = false,
    onTimeUpdate,
  },
  ref,
) => {
  const { t, i18n } = useTranslation();
  const group = useContext(AudioPlayerGroupContext);
  const playbackRate = useSyncExternalStore(
    playbackRateStore.subscribe,
    playbackRateStore.get,
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(initialSrc ?? null);
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const src = loadedSrc;
  const animationRef = useRef<number>();
  const dragTimeRef = useRef<number>(0);
  // Ref so the media listeners below always call the latest callback.
  const onTimeUpdateRef = useRef(onTimeUpdate);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  /** A seek asked for before the metadata was in, applied once it is. */
  const pendingSeekRef = useRef<number | null>(null);

  // Use refs to avoid stale closures in animation loop
  const isPlayingRef = useRef(false);
  const isDraggingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  // Stable animation loop with no dependencies
  const tick = useCallback(() => {
    if (audioRef.current && !isDraggingRef.current) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
    }

    if (isPlayingRef.current) {
      animationRef.current = requestAnimationFrame(tick);
    }
  }, []); // Empty dependency array is key!

  // Manage animation loop lifecycle
  useEffect(() => {
    if (isPlaying && !isDragging) {
      // Only start if not already running
      if (!animationRef.current) {
        animationRef.current = requestAnimationFrame(tick);
      }
    } else {
      // Stop animation loop
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [isPlaying, isDragging, tick]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      const pending = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (pending !== null) audio.currentTime = pending;
      setCurrentTime(pending ?? 0);
    };

    const handleEnded = () => {
      group?.releasePlayback(audio);
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
    };

    const handlePlay = () => {
      group?.requestPlayback(audio);
      setIsPlaying(true);
    };
    const handlePause = () => {
      group?.releasePlayback(audio);
      setIsPlaying(false);
    };

    const handleTimeUpdate = () => {
      onTimeUpdateRef.current?.(audio.currentTime);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      group?.releasePlayback(audio);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [group]);

  // Auto-play when src becomes available (via onLoadRequest or autoPlay prop)
  const prevLoadedSrc = useRef<string | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Play when loadedSrc changes from null to a value (lazy load case)
    if (loadedSrc && !prevLoadedSrc.current && onLoadRequest) {
      audio.play().catch((error) => {
        console.error("Auto-play failed:", error);
      });
    }
    // Or when autoPlay is set with initial src
    else if (autoPlay && initialSrc && !prevLoadedSrc.current) {
      audio.play().catch((error) => {
        console.error("Auto-play failed:", error);
      });
    }

    prevLoadedSrc.current = loadedSrc;
  }, [loadedSrc, autoPlay, initialSrc, onLoadRequest]);

  // Loading a new source resets playbackRate to defaultPlaybackRate, so both
  // are set, and again whenever the source changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.defaultPlaybackRate = playbackRate;
    audio.playbackRate = playbackRate;
  }, [playbackRate, src]);

  // Global drag handlers
  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (audioRef.current) {
        audioRef.current.currentTime = dragTimeRef.current;
        setCurrentTime(dragTimeRef.current);
      }
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("touchend", handleMouseUp);

      return () => {
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchend", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseUp]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (loadedSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(loadedSrc);
      }
    };
  }, [loadedSrc]);

  /** Fetch the source; the effect watching loadedSrc starts playback. */
  const requestLoad = useCallback(async () => {
    if (!onLoadRequest) return;
    setIsLoading(true);
    try {
      const newSrc = await onLoadRequest();
      if (newSrc) setLoadedSrc(newSrc);
    } finally {
      setIsLoading(false);
    }
  }, [onLoadRequest]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isLoading) return;

    try {
      if (isPlaying) {
        audio.pause();
      } else if (!src) {
        await requestLoad();
      } else {
        await audio.play();
      }
    } catch (error) {
      console.error("Playback failed:", error);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (seconds: number) => {
        const audio = audioRef.current;
        if (!audio) return;

        if (!src) {
          pendingSeekRef.current = seconds;
          if (!isLoading) {
            requestLoad().catch((error) => {
              console.error("Loading audio failed:", error);
            });
          }
          return;
        }

        if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
          audio.currentTime = seconds;
          setCurrentTime(seconds);
        } else {
          pendingSeekRef.current = seconds;
        }
        audio.play().catch((error) => {
          console.error("Playback failed:", error);
        });
      },
    }),
    [src, isLoading, requestLoad],
  );

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    dragTimeRef.current = newTime;
    setCurrentTime(newTime);

    if (!isDragging && audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleSliderMouseDown = () => {
    // A click without movement fires no change event; without this the
    // release would seek to the previous drag's position.
    dragTimeRef.current = currentTime;
    setIsDragging(true);
  };

  const handleSliderTouchStart = () => {
    // A click without movement fires no change event; without this the
    // release would seek to the previous drag's position.
    dragTimeRef.current = currentTime;
    setIsDragging(true);
  };

  const formatTime = (time: number): string => {
    if (!isFinite(time)) return "0:00";

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Fix playhead positioning with better edge case handling
  const getProgressPercent = (): number => {
    if (duration <= 0) return 0;

    // Handle the end case - if we're within 0.1 seconds of the end, show 100%
    if (duration - currentTime < 0.1) return 100;

    const percent = (currentTime / duration) * 100;
    return Math.min(100, Math.max(0, percent));
  };

  const progressPercent = getProgressPercent();

  const formattedRate = `${playbackRate.toLocaleString(i18n.language, {
    maximumFractionDigits: 2,
  })}×`;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" />

      <button
        onClick={togglePlay}
        disabled={isLoading}
        className="rounded-md transition-colors cursor-pointer text-text hover:text-logo-primary disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
        aria-label={isPlaying ? t("audioPlayer.pause") : t("audioPlayer.play")}
      >
        {isPlaying ? (
          <Pause width={20} height={20} fill="currentColor" />
        ) : (
          <Play width={20} height={20} fill="currentColor" />
        )}
      </button>

      <div className="flex-1 flex items-center gap-2">
        <span className="text-xs text-mid-gray min-w-[30px] tabular-nums">
          {formatTime(currentTime)}
        </span>

        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.01"
          value={currentTime}
          onChange={handleSeek}
          onMouseDown={handleSliderMouseDown}
          onTouchStart={handleSliderTouchStart}
          className={`flex-1 h-1 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-logo-primary ${progressPercent >= 99.5 ? "[&::-webkit-slider-thumb]:translate-x-0.5 [&::-moz-range-thumb]:translate-x-0.5" : ""}`}
          style={{
            background: `linear-gradient(to right, var(--color-background-ui) 0%, var(--color-background-ui) ${progressPercent}%, var(--color-track) ${progressPercent}%, var(--color-track) 100%)`,
          }}
        />

        <span className="text-xs text-mid-gray min-w-[30px] tabular-nums">
          {formatTime(duration)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => playbackRateStore.set(nextPlaybackRate(playbackRate))}
        title={t("audioPlayer.speed")}
        aria-label={t("audioPlayer.speedLabel", { rate: formattedRate })}
        className="min-w-[42px] rounded-md px-1 py-0.5 text-xs tabular-nums text-mid-gray transition-colors cursor-pointer hover:text-logo-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
      >
        {formattedRate}
      </button>
    </div>
  );
};

export const AudioPlayer = forwardRef(AudioPlayerBase);
