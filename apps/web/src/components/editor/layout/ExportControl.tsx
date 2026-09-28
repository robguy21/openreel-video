import React, { useCallback, useState, useEffect } from "react";
import { Settings, Video } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import {
  getExportEngine,
  getDeviceProfile,
  estimateExportTime,
  type VideoExportSettings,
  type AudioExportSettings,
  type ExportResult,
  type DeviceProfile,
  type TimeEstimate,
} from "@openreel/core";
import { ExportDialog } from "../ExportDialog";
import { CompressDialog } from "../CompressDialog";
import { deriveSourceExportMatch } from "../../../services/export-source-match";
import { useExportRunner, extForFormat, exportFilename, writeBlobToWritable } from "../../../services/export-runner";
import { ScreenRecorder } from "../ScreenRecorder";
import {
  useStudioStore,
  exportToStudio,
  dismissStudioError,
} from "../../../services/studio/studio-session";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Icon } from "@/icons/Icon";
import { toast } from "../../../stores/notification-store";
import { useAnalytics, AnalyticsEvents } from "../../../hooks/useAnalytics";
import { RailButton, RailGlyph, RailMenu, type RailMenuEntry } from "./RailItem";

type ExportType =
  | "mp4"
  | "prores"
  | "gif"
  | "wav"
  | "4k-master"
  | "4k-prores"
  | "4k"
  | "1080p-high"
  | "4k-60-master"
  | "1080p-60"
  | "project";

const ExportGlyph = (
  <RailGlyph>
    <path d="M12 15V4M7 9l5-5 5 5" />
    <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
  </RailGlyph>
);

/**
 * Export, as an item at the foot of the rail (Robert, 2026-09-28: the top bar goes, and
 * Export to Studio and its menu move into the sidebar). The logic is the old top bar's,
 * moved unchanged: inside a Clip Studio session the default is Export to Studio, with
 * its progress, error and "Saved!" states; the menu keeps the local-file presets, the
 * custom export and the compressor. The screen recorder and the settings dialog, which
 * the old top bar also hosted, are hosted here.
 */
export const ExportControl: React.FC = () => {
  const { project } = useProjectStore();
  const {
    setExportState: setGlobalExportState,
    activeModal,
    closeModal,
  } = useUIStore();
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isCompressOpen, setIsCompressOpen] = useState(false);
  const { importMedia } = useProjectStore();
  const { track } = useAnalytics();

  const handleExported = useCallback(
    (videoSettings: Partial<VideoExportSettings>) => {
      track(AnalyticsEvents.PROJECT_EXPORTED, {
        format: videoSettings.format ?? "mp4",
        codec: videoSettings.codec ?? "h264",
        width: videoSettings.width ?? project.settings.width,
        height: videoSettings.height ?? project.settings.height,
        frameRate: videoSettings.frameRate ?? project.settings.frameRate,
        duration: project.timeline?.duration ?? 0,
      });
    },
    [project, track],
  );

  const {
    state: exportState,
    runExport,
    showSavePicker,
    reportProgress,
    markComplete,
    beginExport,
    finishExportSoon,
    failExport,
    cancel: handleCancelExport,
    resetError,
  } = useExportRunner({ project, onExported: handleExported });

  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [exportEstimates, setExportEstimates] = useState<Map<string, TimeEstimate>>(new Map());

  // Inside a Clip Studio session the primary Export sends the render to the
  // studio; the dropdown keeps the local-file presets.
  const studioPid = useStudioStore((s) => s.pid);
  const studioStatus = useStudioStore((s) => s.status);
  const studioMessage = useStudioStore((s) => s.message);
  const studioProgress = useStudioStore((s) => s.progress);
  const studioError = useStudioStore((s) => s.error);
  const studioLastExportAt = useStudioStore((s) => s.lastExportAt);
  const isStudioSession = studioPid !== null;
  const isStudioExporting = isStudioSession && studioStatus === "exporting";
  const [studioSavedVisible, setStudioSavedVisible] = useState(false);
  useEffect(() => {
    if (!studioLastExportAt) return;
    setStudioSavedVisible(true);
    const timer = window.setTimeout(() => setStudioSavedVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [studioLastExportAt]);
  const handleExportToStudio = useCallback(() => {
    setIsExportOpen(false);
    void exportToStudio();
  }, []);

  useEffect(() => {
    setGlobalExportState({
      isExporting: exportState.isExporting,
      progress: exportState.progress,
      phase: exportState.phase,
    });
  }, [exportState.isExporting, exportState.progress, exportState.phase, setGlobalExportState]);

  useEffect(() => {
    if (isExportOpen && !deviceProfile) {
      getDeviceProfile().then(setDeviceProfile);
    }
  }, [isExportOpen, deviceProfile]);

  useEffect(() => {
    if (!deviceProfile || !project.timeline?.duration) {
      return;
    }

    const duration = project.timeline.duration;
    const estimates = new Map<string, TimeEstimate>();

    const configs: Array<{ key: string; width: number; height: number; frameRate: number; codec: "h264" | "h265" | "vp9" | "av1" }> = [
      { key: "mp4", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
      { key: "4k", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "4k-60-master", width: 3840, height: 2160, frameRate: 60, codec: "h264" },
      { key: "4k-master", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "1080p-high", width: 1920, height: 1080, frameRate: 30, codec: "h264" },
      { key: "1080p-60", width: 1920, height: 1080, frameRate: 60, codec: "h264" },
      { key: "prores", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
    ];

    for (const config of configs) {
      const estimate = estimateExportTime(deviceProfile, {
        width: config.width,
        height: config.height,
        frameRate: config.frameRate,
        duration,
        codec: config.codec,
      });
      estimates.set(config.key, estimate);
    }

    setExportEstimates(estimates);
  }, [deviceProfile, project.timeline?.duration, project.settings.width, project.settings.height]);

  const handleExport = useCallback(
    async (type: ExportType) => {
      setIsExportOpen(false);

      try {
        if (type === "wav") {
          const writable = await showSavePicker(exportFilename(project.name, "wav"), "wav");

          beginExport();

          const engine = getExportEngine();
          await engine.initialize();

          const audioSettings: Partial<AudioExportSettings> = {
            format: "wav",
            sampleRate: 48000,
            channels: 2,
            bitDepth: 24,
          };

          const generator = engine.exportAudio(project, audioSettings);
          let finalResult: ExportResult | undefined;

          while (true) {
            const { value, done } = await generator.next();
            if (done) {
              finalResult = value;
              break;
            }
            reportProgress(value.progress, value.phase);
          }

          if (finalResult?.success && finalResult.blob) {
            await writeBlobToWritable(finalResult.blob, writable);
            markComplete();
            track(AnalyticsEvents.PROJECT_EXPORTED, {
              format: "wav",
              duration: project.timeline?.duration ?? 0,
            });
          } else {
            try { await writable.abort(); } catch { void 0; }
            throw new Error(finalResult?.error?.message || "Export failed");
          }
        } else {
          const base = {
            width: project.settings.width,
            height: project.settings.height,
            frameRate: project.settings.frameRate,
          };

          const presets: Record<string, { settings: Partial<VideoExportSettings>; ext: string }> = {
            mp4: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            gif: { settings: { ...base, format: "webm", codec: "vp9", bitrate: 8000 }, ext: "webm" },
            project: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            "4k-60-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 60, format: "mov", codec: "h265", bitrate: 100000, quality: 95 }, ext: "mov" },
            "4k-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "h265", bitrate: 80000, quality: 95 }, ext: "mov" },
            "4k-prores": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "prores", bitrate: 880000, quality: 100 }, ext: "mov" },
            "4k": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mp4", codec: "h264", bitrate: 50000, quality: 90 }, ext: "mp4" },
            "1080p-60": { settings: { ...base, width: 1920, height: 1080, frameRate: 60, format: "mp4", codec: "h264", bitrate: 25000, quality: 95 }, ext: "mp4" },
            "1080p-high": { settings: { ...base, width: 1920, height: 1080, frameRate: 30, format: "mp4", codec: "h264", bitrate: 20000, quality: 95 }, ext: "mp4" },
            prores: { settings: { ...base, format: "mov", codec: "prores", bitrate: 220000, quality: 100 }, ext: "mov" },
          };

          const preset = presets[type] ?? presets.mp4;
          const writable = await showSavePicker(exportFilename(project.name, preset.ext), preset.ext);

          beginExport();

          await runExport(preset.settings, preset.ext, writable);
        }

        finishExportSoon();
      } catch (error) {
        failExport(error);
      }
    },
    [project, track, runExport, showSavePicker, beginExport, reportProgress, markComplete, finishExportSoon, failExport],
  );

  const handleCustomExport = useCallback(
    async (settings: VideoExportSettings) => {
      setIsExportDialogOpen(false);

      try {
        const ext = extForFormat(settings.format);
        const writable = await showSavePicker(exportFilename(project.name, ext), ext);

        beginExport();

        const needsUpscaling =
          settings.width > project.settings.width ||
          settings.height > project.settings.height;

        const exportSettings: Partial<VideoExportSettings> = {
          ...settings,
          upscaling:
            settings.upscaling?.enabled && needsUpscaling
              ? settings.upscaling
              : undefined,
        };

        await runExport(exportSettings, ext, writable);

        track(AnalyticsEvents.PROJECT_EXPORTED, {
          format: settings.format,
          codec: settings.codec,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          duration: project.timeline?.duration ?? 0,
          exportType: "custom",
          upscaling: settings.upscaling?.enabled ?? false,
        });

        finishExportSoon();
      } catch (error) {
        failExport(error);
      }
    },
    [project, track, runExport, showSavePicker, beginExport, finishExportSoon, failExport],
  );


  const handleRecordingComplete = useCallback(
    async (screenBlob: Blob, webcamBlob?: Blob) => {
      if (!screenBlob || screenBlob.size === 0) {
        toast.error(
          "Recording failed",
          "No video data was captured. Please try again.",
        );
        return;
      }

      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:-]/g, "");
      let importCount = 0;
      const errors: string[] = [];

      const screenFile = new File([screenBlob], `Screen_${timestamp}.webm`, {
        type: screenBlob.type || "video/webm",
      });
      const screenResult = await importMedia(screenFile);
      if (screenResult.success) {
        importCount++;
      } else {
        errors.push(
          screenResult.error?.message || "Failed to import screen recording",
        );
      }

      if (webcamBlob && webcamBlob.size > 0) {
        const webcamFile = new File([webcamBlob], `Webcam_${timestamp}.webm`, {
          type: webcamBlob.type || "video/webm",
        });
        const webcamResult = await importMedia(webcamFile);
        if (webcamResult.success) {
          importCount++;
        } else {
          errors.push(
            webcamResult.error?.message || "Failed to import webcam recording",
          );
        }
      }

      if (importCount > 0) {
        toast.success(
          `${importCount} recording${importCount > 1 ? "s" : ""} imported!`,
          webcamBlob && webcamBlob.size > 0
            ? "Screen and webcam added to assets. Use the timeline to composite them."
            : "Screen recording added to assets.",
        );
      } else if (errors.length > 0) {
        toast.error("Import failed", errors.join(". "));
      }
    },
    [importMedia],
  );

  const projectRes = `${project.settings.width}×${project.settings.height}`;
  const aspectRatio = project.settings.width / project.settings.height;
  const isVertical = aspectRatio < 0.9;

  const exportOptions: Array<{
    label: string;
    iconName: string;
    desc: string;
    type: ExportType;
    recommended?: boolean;
    separator?: boolean;
  }> = [
    {
      label: "MP4 Standard",
      iconName: "bolt",
      desc: `${projectRes} H.264 - Web & social`,
      type: "mp4",
      recommended: true,
    },
    {
      label: "",
      iconName: "film",
      desc: "",
      type: "mp4",
      separator: true,
    },
    ...(isVertical
      ? []
      : [
          {
            label: "4K Standard",
            iconName: "film",
            desc: "3840×2160 - YouTube 4K",
            type: "4k" as ExportType,
          },
        ]),
    {
      label: "1080p High Quality",
      iconName: "film",
      desc: "1920×1080 30fps - High bitrate",
      type: "1080p-high",
    },
    {
      label: "1080p 60fps",
      iconName: "film",
      desc: "1920×1080 - Smooth playback",
      type: "1080p-60",
    },
    {
      label: "Audio Only (WAV)",
      iconName: "music.note",
      desc: "Uncompressed audio",
      type: "wav",
    },
  ];

  const lastExport = useStudioStore((s) => s.lastExport);

  const entries: Array<RailMenuEntry | null> = [
    ...(isStudioSession
      ? [
          {
            label: "Export to Studio",
            description: `${projectRes} H.264 - saved into the Clip Studio project`,
            icon: <Icon name="square.and.arrow.up" size={16} ariaHidden />,
            onSelect: handleExportToStudio,
            isDefault: true,
          },
          ...(lastExport
            ? [{ label: "Open the last render", href: lastExport.url, icon: <Icon name="film" size={16} ariaHidden /> }]
            : []),
          null,
        ]
      : []),
    ...exportOptions
      .filter((option) => !option.separator)
      .map((option) => ({
        label: option.label,
        description: [option.desc, exportEstimates.get(option.type) ? `Est. ${exportEstimates.get(option.type)?.formatted}` : ""]
          .filter(Boolean)
          .join(" - "),
        icon: <Icon name={option.iconName} size={16} ariaHidden />,
        onSelect: () => void handleExport(option.type),
        isDefault: !isStudioSession && option.recommended === true,
      })),
    null,
    {
      label: "Custom export...",
      description: "Full settings with AI upscaling",
      icon: <Settings size={16} aria-hidden />,
      onSelect: () => setIsExportDialogOpen(true),
    },
    {
      label: "Compress video...",
      description: "Shrink any video to a target size",
      icon: <Video size={16} aria-hidden />,
      onSelect: () => setIsCompressOpen(true),
    },
  ];

  // What the item says while something is happening, and what clicking it then does.
  const busy = isStudioExporting
    ? {
        label: studioProgress > 0 && studioProgress < 1 ? `${Math.round(studioProgress * 100)}%` : "Exporting",
        title: studioMessage || "Exporting to Studio…",
        onClick: undefined as (() => void) | undefined,
      }
    : isStudioSession && studioError && !exportState.isExporting
      ? { label: "Failed", title: `${studioError} - click to clear`, onClick: dismissStudioError }
      : isStudioSession && studioSavedVisible && !exportState.isExporting
        ? { label: "Saved!", title: "Sent to Clip Studio", onClick: undefined }
        : exportState.isExporting
          ? { label: `${Math.round(exportState.progress)}%`, title: "Exporting - click to cancel", onClick: handleCancelExport }
          : exportState.error
            ? { label: "Failed", title: `${exportState.error} - click to clear`, onClick: resetError }
            : exportState.complete
              ? { label: "Saved!", title: "Export finished", onClick: undefined }
              : null;

  return (
    <>
      {busy ? (
        <RailButton
          icon={ExportGlyph}
          label={busy.label}
          title={busy.title}
          aria-label={`Export: ${busy.title}`}
          aria-live="polite"
          tone="primary"
          onClick={busy.onClick}
          disabled={!busy.onClick}
        />
      ) : (
        <RailMenu
          label="Export"
          isOpen={isExportOpen}
          onOpenChange={setIsExportOpen}
          entries={entries}
          width={300}
          footer={
            <div className="mt-1 border-t border-border px-2.5 pt-2 text-center text-[11px] text-fg-3">
              {project.settings.width}×{project.settings.height} • {project.settings.frameRate}fps
            </div>
          }
          trigger={
            <RailButton
              icon={ExportGlyph}
              label="Export"
              aria-label={isStudioSession ? "Export: to Studio, or to a file" : "Export"}
              tone="primary"
              aria-haspopup="menu"
              aria-expanded={isExportOpen}
            />
          }
        />
      )}

      <CompressDialog
        isOpen={isCompressOpen}
        onClose={() => setIsCompressOpen(false)}
      />
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleCustomExport}
        duration={project.timeline?.duration ?? 0}
        projectWidth={project.settings?.width ?? 1920}
        projectHeight={project.settings?.height ?? 1080}
        frameRate={project.settings?.frameRate ?? 30}
        sourceMatch={deriveSourceExportMatch(project)}
      />

      <ScreenRecorder
        isOpen={activeModal === "recorder"}
        onClose={closeModal}
        onRecordingComplete={handleRecordingComplete}
      />

      <SettingsDialog />
    </>
  );
};
