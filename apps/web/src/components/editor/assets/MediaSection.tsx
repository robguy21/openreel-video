import React, { useCallback, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Upload } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import type { MediaItem } from "@openreel/core";
import { AspectRatioMatchDialog } from "../dialogs/AspectRatioMatchDialog";
import { toast } from "../../../stores/notification-store";
import { saveFileHandle, saveDirectoryHandle } from "../../../services/media-storage";
import { KieAIImageDialog } from "../kieai/KieAIImageDialog";
import { loadMediaBlob } from "../../../services/media-storage";
import { useKieAIStore } from "../../../stores/kieai-store";
import {
  EmptyState,
  LoadingIndicator,
  MediaThumbnail,
  PanelButton,
} from "./shared";

/**
 * The Media section: the project's library, importing into it (the picker, drag and drop,
 * relinking a missing file) and adding an item to the timeline. Moved out of
 * AssetsPanel.tsx unchanged (docs/PROPOSAL_EDITOR_REDESIGN.md R4.5); the editor's sidebar
 * shows it as the Media tab.
 */
/** The Media tab's segmented filter (docs/PROPOSAL_EDITOR_REDESIGN.md R4.4). */
const MEDIA_FILTERS: ReadonlyArray<{ value: "all" | MediaItem["type"]; label: string }> = [
  { value: "all", label: "All" },
  { value: "video", label: "Takes" },
  { value: "image", label: "Stills" },
  { value: "audio", label: "Audio" },
];

export interface MediaSectionProps {
  /** "sidebar" is the editor's Media tab, titled by its panel; "assets" is the old
   *  Assets column (the desktop layout), which titles itself and keeps Record. */
  variant?: "assets" | "sidebar";
  /** Opens AI Generate; the Generate button shows only when this is given. */
  onGenerate?: () => void;
  /** One click on an item: the editor loads it into the Reference monitor (R4.4). */
  onOpen?: (item: MediaItem) => void;
}

export const MediaSection: React.FC<MediaSectionProps> = ({
  variant = "assets",
  onGenerate,
  onOpen,
}) => {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | MediaItem["type"]>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [showAspectRatioDialog, setShowAspectRatioDialog] = useState(false);
  const [aspectRatioDialogData, setAspectRatioDialogData] = useState<{
    videoWidth: number;
    videoHeight: number;
    itemToAdd: MediaItem;
  } | null>(null);
  const [sortOrder, setSortOrder] = useState<"none" | "asc" | "desc">("none");

  // KieAI image generation dialog
  const [kieaiDialog, setKieaiDialog] = useState<{ file: File; previewUrl: string | null } | null>(null);

  // Project store
  const {
    project,
    importMedia,
    deleteMedia,
    replaceMediaAsset,
    updateSettings,
    setKieAIItemState,
  } = useProjectStore();
  const mediaItems = project.mediaLibrary.items;
  // Tiles take the film's shape: two across for a landscape film, three for portrait.
  const portrait = project.settings.height > project.settings.width;
  const tileAspect = `${project.settings.width || 16} / ${project.settings.height || 9}`;

  // KieAI store
  const { retryTask } = useKieAIStore();

  // UI store
  const { select, isSelected, startDrag, openModal } = useUIStore();

  // Count missing assets
  const missingAssetsCount = mediaItems.filter(
    (item) => item.isPlaceholder,
  ).length;

  // Filter media items by the missing-assets toggle, then optional sort
  const needle = query.trim().toLowerCase();
  const baseFilteredItems = mediaItems.filter(
    (item) =>
      (showOnlyMissing ? item.isPlaceholder : true) &&
      (kind === "all" || item.type === kind) &&
      (needle === "" || item.name.toLowerCase().includes(needle)),
  );
  const filteredItems =
    sortOrder === "none"
      ? baseFilteredItems
      : [...baseFilteredItems].sort((a, b) => {
          const comparison = a.name.localeCompare(b.name);
          return sortOrder === "desc" ? -comparison : comparison;
        });

  // Handle file import with loading state
  const handleFileImport = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setIsImporting(true);
      const fileArray = Array.from(files);

      try {
        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i];
          setImportProgress(
            `Importing ${file.name} (${i + 1}/${fileArray.length})...`,
          );

          const result = await importMedia(file);

          // If it's a video with audio, extract audio to separate track
          if (result.success && file.type.startsWith("video/")) {
            setImportProgress(`Extracting audio from ${file.name}...`);
            // Audio extraction is handled by the importMedia function
            // The audio track is created automatically when adding to timeline
          }
        }
      } catch (error) {
        console.error("Import failed:", error);
      } finally {
        setIsImporting(false);
        setImportProgress("");
      }
    },
    [importMedia],
  );

  // Handle drag and drop import — capture FileSystemFileHandle for each dropped file
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      // Snapshot dataTransfer synchronously — it becomes inert after the first await.
      const droppedFiles = e.dataTransfer.files;
      const handlePromises =
        "getAsFileSystemHandle" in DataTransferItem.prototype
          ? Array.from(e.dataTransfer.items)
              .filter((item) => item.kind === "file")
              .map(async (item) => {
                try {
                  const handle = await (item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle> }).getAsFileSystemHandle();
                  if (handle.kind === "file") {
                    const fileHandle = handle as FileSystemFileHandle;
                    const file = await fileHandle.getFile();
                    await saveFileHandle(file.name, file.size, fileHandle);
                  }
                } catch {
                  // Ignore — handle capture is best-effort
                }
              })
          : [];

      await Promise.all(handlePromises);
      handleFileImport(droppedFiles);
    },
    [handleFileImport],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // Handle media item selection
  const handleSelectItem = useCallback(
    (itemId: string) => {
      select({ type: "clip", id: itemId });
    },
    [select],
  );

  // Handle media item deletion
  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      await deleteMedia(itemId);
    },
    [deleteMedia],
  );

  // Handle asset replacement
  const handleReplaceAsset = useCallback(
    async (itemId: string) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*,audio/*,image/*";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          setIsImporting(true);
          setImportProgress(`Replacing asset...`);
          try {
            await replaceMediaAsset(itemId, file);
          } catch (error) {
            console.error("Asset replacement failed:", error);
          } finally {
            setIsImporting(false);
            setImportProgress("");
          }
        }
      };
      input.click();
    },
    [replaceMediaAsset],
  );

  const handleRelinkFromFolder = useCallback(async () => {
    if (!("showDirectoryPicker" in window)) {
      toast.error("Folder picker not supported", "Please relink assets individually using the refresh button on each missing asset.");
      return;
    }
    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    } catch {
      return; // user cancelled
    }

    const { project } = useProjectStore.getState();
    const placeholders = project.mediaLibrary.items.filter((item) => item.isPlaceholder);
    if (placeholders.length === 0) return;

    // Persist the directory handle for future auto-restore
    try { await saveDirectoryHandle(project.id, dirHandle); } catch { /* best-effort */ }

    // Build a name:size → {File, handle} map for reliable matching
    const fileMap = new Map<string, { file: File; handle: FileSystemFileHandle }>();
    const entries = (dirHandle as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
    for await (const [, fh] of entries) {
      if ((fh as FileSystemHandle).kind === "file") {
        const fileHandle = fh as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        fileMap.set(`${file.name.toLowerCase()}:${file.size}`, { file, handle: fileHandle });
      }
    }

    setIsImporting(true);
    let linked = 0;
    for (const item of placeholders) {
      // Match on original source file name + size (same strategy as auto-restore)
      const key = item.sourceFile
        ? `${item.sourceFile.name.toLowerCase()}:${item.sourceFile.size}`
        : null;
      const entry = key ? fileMap.get(key) : null;
      if (entry) {
        setImportProgress(`Relinking ${item.name}…`);
        try {
          // Save individual file handle for future auto-restore
          try { await saveFileHandle(entry.file.name, entry.file.size, entry.handle); } catch { /* best-effort */ }
          await replaceMediaAsset(item.id, entry.file, dirHandle.name);
          linked++;
        } catch (err) {
          console.error(`[AssetsPanel] Failed to relink ${item.name}:`, err);
        }
      }
    }
    setIsImporting(false);
    setImportProgress("");

    if (linked > 0) {
      toast.success(`Relinked ${linked} of ${placeholders.length} asset${placeholders.length !== 1 ? "s" : ""}`);
    } else {
      toast.error("No matches found", "None of the files in the selected folder matched the missing assets by filename.");
    }
  }, [replaceMediaAsset]);

  // Handle drag start for timeline placement
  const handleItemDragStart = useCallback(
    (e: React.DragEvent, item: MediaItem) => {
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({ mediaId: item.id }),
      );
      e.dataTransfer.effectAllowed = "copy";
      startDrag("media", { mediaId: item.id, mediaType: item.type });
    },
    [startDrag],
  );

  const addMediaToTimeline = useCallback(async (item: MediaItem) => {
    const { addClipToNewTrack } = useProjectStore.getState();
    await addClipToNewTrack(item.id, playheadPosition);
  }, [playheadPosition]);

  const handleConfirmAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    await updateSettings({
      width: aspectRatioDialogData.videoWidth,
      height: aspectRatioDialogData.videoHeight,
    });

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, updateSettings, addMediaToTimeline]);

  const handleCancelAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, addMediaToTimeline]);

  const handleAddToTimeline = useCallback(
    async (item: MediaItem) => {
      const { project: currentProject } = useProjectStore.getState();
      const tracks = currentProject.timeline.tracks;
      const hasClips = tracks.some((track) => track.clips.length > 0);

      if (
        !hasClips &&
        item.type === "video" &&
        item.metadata?.width &&
        item.metadata?.height
      ) {
        const videoWidth = item.metadata.width;
        const videoHeight = item.metadata.height;
        const projectWidth = currentProject.settings.width;
        const projectHeight = currentProject.settings.height;

        if (videoWidth !== projectWidth || videoHeight !== projectHeight) {
          setAspectRatioDialogData({ videoWidth, videoHeight, itemToAdd: item });
          setShowAspectRatioDialog(true);
          return;
        }
      }

      await addMediaToTimeline(item);
    },
    [addMediaToTimeline],
  );

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Open KieAI dialog for an image asset
  const handleOpenKieAI = useCallback(async (item: MediaItem) => {
    try {
      const blob = await loadMediaBlob(item.id);
      if (!blob) {
        toast.error("Asset not found", "Cannot load the image data for this asset.");
        return;
      }
      const mimeType = blob.type || (item.name.match(/\.png$/i) ? "image/png" : "image/jpeg");
      const file = new File([blob], item.name, { type: mimeType as string });
      setKieaiDialog({ file, previewUrl: item.thumbnailUrl });
    } catch (err) {
      console.error("[KieAI] Failed to load media blob:", err);
      toast.error("Failed to open KieAI", err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  const handleRetryKieAI = useCallback((item: MediaItem) => {
    if (!item.kieaiTaskId) return;
    // Reset error state and re-activate polling
    setKieAIItemState(item.id, true, false);
    retryTask(item.kieaiTaskId);
  }, [retryTask, setKieAIItemState]);

  return (
    <>
      {isImporting && (
        <LoadingIndicator message={importProgress || "Importing media..."} />
      )}

      <input
        ref={fileInputRef}
        type="file"
        aria-label="Import media"
        accept="video/*,audio/*,image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          handleFileImport(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-3 px-4 pb-3">
          {variant === "assets" && (
            <div className="font-bold text-[18px] text-fg pt-[18px]">Media</div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Import media"
              onClick={triggerFileInput}
              className="or-primary or-focus flex h-[38px] items-center justify-center gap-1.5 pl-3 pr-4 text-[13px] font-medium"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Import
            </button>
            {onGenerate && (
              <button
                type="button"
                onClick={onGenerate}
                className="or-control or-focus flex h-[38px] items-center px-3.5 text-[13px]"
              >
                Generate
              </button>
            )}
            {variant === "assets" && (
              <button
                type="button"
                aria-label="Record"
                onClick={() => openModal("recorder")}
                className="or-control or-focus flex h-[38px] items-center gap-1.5 px-3.5 text-[13px]"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                  <circle cx="12" cy="12" r="8" />
                  <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
                </svg>
                Record
              </button>
            )}
          </div>
          <label className="or-field flex h-10 items-center gap-2 pl-3.5 pr-1.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-fg-3" aria-hidden="true">
              <circle cx="11" cy="11" r="6" />
              <path d="M20 20l-4.5-4.5" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search media"
              aria-label="Search media"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-muted"
            />
            <button
              type="button"
              aria-label="Sort media"
              aria-pressed={sortOrder !== "none"}
              title={sortOrder === "none" ? "Sort by name" : sortOrder === "asc" ? "Sorted A to Z" : "Sorted Z to A"}
              onClick={() =>
                setSortOrder((prev) =>
                  prev === "none" ? "asc" : prev === "asc" ? "desc" : "none",
                )
              }
              className={`or-focus grid h-7 w-7 shrink-0 place-items-center rounded-pill ${sortOrder === "none" ? "text-fg-3 hover:text-fg-2" : "or-lit"}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M3 7h13M3 7l3-3M3 7l3 3M21 17H8M21 17l-3-3M21 17l-3 3" />
              </svg>
            </button>
          </label>
          <div role="group" aria-label="Show" className="or-track grid w-full grid-cols-4">
            {MEDIA_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={kind === f.value}
                onClick={() => setKind(f.value)}
                className={`or-focus h-7 rounded-pill text-[12px] ${kind === f.value ? "or-lit" : "text-fg-2 hover:text-fg"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {missingAssetsCount > 0 && (
          <div className="px-4 pb-3 space-y-2">
            <PanelButton
              label="Show Only Missing Assets"
              onClick={() => setShowOnlyMissing(!showOnlyMissing)}
              className={`w-full px-3 py-2 rounded-lg border text-xs font-medium transition-all flex items-center justify-between ${
                showOnlyMissing
                  ? "bg-yellow-500/10 border-yellow-500 text-yellow-500"
                  : "bg-background-tertiary border-border text-text-secondary hover:border-yellow-500/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} />
                <span>Show Only Missing Assets</span>
              </div>
              <div className="px-2 py-0.5 rounded-full bg-yellow-500 text-black text-[10px] font-bold">
                {missingAssetsCount}
              </div>
            </PanelButton>
            <PanelButton
              label="Relink from Folder"
              onClick={handleRelinkFromFolder}
              className="w-full px-3 py-2 rounded-lg border border-yellow-500/40 bg-yellow-500/5 text-yellow-500 text-xs font-medium transition-all hover:bg-yellow-500/15 flex items-center gap-2"
            >
              <RefreshCw size={14} />
              <span>Relink from Folder…</span>
            </PanelButton>
          </div>
        )}

        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar ${isDragOver ? "bg-accent-soft" : ""}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="px-4 pb-[18px] relative">
            {filteredItems.length > 0 && variant === "assets" && (
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-semibold text-fg-2">Project Media</span>
                <span className="text-[12px] font-medium text-fg-muted">{filteredItems.length}</span>
              </div>
            )}
            {filteredItems.length === 0 ? (
              mediaItems.length === 0 ? (
                <EmptyState onImport={triggerFileInput} />
              ) : (
                <p className="py-8 text-center text-[12px] text-fg-3">Nothing here matches.</p>
              )
            ) : (
              <div
                className="grid gap-x-3 gap-y-3.5"
                style={{ gridTemplateColumns: `repeat(${portrait ? 3 : 2}, minmax(0, 1fr))` }}
              >
                {filteredItems.map((item) => (
                  <MediaThumbnail
                    key={item.id}
                    item={item}
                    isSelected={isSelected(item.id)}
                    viewMode="large"
                    aspect={tileAspect}
                    onSelect={() => {
                      handleSelectItem(item.id);
                      onOpen?.(item);
                    }}
                    onDelete={() => handleDeleteItem(item.id)}
                    onReplace={() => handleReplaceAsset(item.id)}
                    onDragStart={(e) => handleItemDragStart(e, item)}
                    onAddToTimeline={() => handleAddToTimeline(item)}
                    onKieAI={item.type === "image" && !item.isPending && !item.kieaiError ? () => handleOpenKieAI(item) : undefined}
                    onRetryKieAI={item.kieaiError && item.kieaiTaskId ? () => handleRetryKieAI(item) : undefined}
                  />
                ))}
                <div className="flex flex-col">
                  <PanelButton
                    label="Add media"
                    onClick={triggerFileInput}
                    className="w-full rounded-tile border border-dashed border-glass-border bg-field hover:border-accent/50 hover:bg-accent-soft relative flex items-center justify-center cursor-pointer transition-all overflow-hidden group"
                    style={{ aspectRatio: tileAspect }}
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <Upload size={20} className="text-fg-muted group-hover:text-accent transition-colors" />
                      <span className="text-[10px] text-fg-muted group-hover:text-accent transition-colors font-medium">Add media</span>
                    </div>
                  </PanelButton>
                </div>
              </div>
            )}

            {isDragOver && (
              <div className="absolute inset-4 border-2 border-dashed border-accent rounded-xl flex items-center justify-center bg-accent-soft pointer-events-none z-50 backdrop-blur-sm">
                <div className="text-accent text-sm font-bold bg-bg-1 px-4 py-2 rounded-full shadow-lg">
                  Drop files to import
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {aspectRatioDialogData && (
        <AspectRatioMatchDialog
          isOpen={showAspectRatioDialog}
          videoWidth={aspectRatioDialogData.videoWidth}
          videoHeight={aspectRatioDialogData.videoHeight}
          currentWidth={project.settings.width}
          currentHeight={project.settings.height}
          onConfirm={handleConfirmAspectRatioMatch}
          onCancel={handleCancelAspectRatioMatch}
        />
      )}

      {kieaiDialog && (
        <KieAIImageDialog
          open={true}
          onClose={() => setKieaiDialog(null)}
          sourceFile={kieaiDialog.file}
          previewUrl={kieaiDialog.previewUrl}
        />
      )}
    </>
  );
};
