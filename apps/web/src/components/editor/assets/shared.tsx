import React, { useState } from "react";
import {
  Image as ImageIcon, Film, Music, Plus, Upload, Trash2, AlertTriangle, RefreshCw, Sparkles,
} from "@/icons/lucide-compat";
import type { MediaItem } from "@openreel/core";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";

/**
 * The pieces the Assets panel's sections share: the media tile, the empty and loading
 * states, and the two plain buttons. Moved out of AssetsPanel.tsx unchanged when its
 * Media, Text and Graphics sections became components of their own
 * (docs/PROPOSAL_EDITOR_REDESIGN.md R4.5).
 */

export type MediaViewMode = "large" | "small" | "list";

export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
};

export const PanelIconButton: React.FC<{
  label: string;
  icon: React.ComponentProps<typeof IconButton>["icon"];
  onClick: (event: React.MouseEvent) => void;
  className?: string;
}> = ({ label, icon, onClick, className }) => (
  <IconButton
    label={label}
    icon={icon}
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={className}
  />
);

export const PanelButton: React.FC<{
  label: string;
  onClick: (event: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
  isDisabled?: boolean;
  children?: React.ReactNode;
}> = ({ label, onClick, className, style, isDisabled, children }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    disabled={isDisabled}
    className={className}
    style={style}
  >
    {children ?? label}
  </button>
);

export const MediaThumbnail: React.FC<{
  item: MediaItem;
  isSelected: boolean;
  viewMode: MediaViewMode;
  /** CSS aspect-ratio of a grid tile - the film's shape. */
  aspect?: string;
  onSelect: () => void;
  onDelete: () => void;
  onReplace: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onAddToTimeline: () => void;
  onKieAI?: () => void;
  onRetryKieAI?: () => void;
}> = ({
  item,
  isSelected,
  viewMode,
  aspect = "16 / 9",
  onSelect,
  onDelete,
  onReplace,
  onDragStart,
  onAddToTimeline,
  onKieAI,
  onRetryKieAI,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getIcon = () => {
    switch (item.type) {
      case "video":
        return Film;
      case "audio":
        return Music;
      case "image":
        return ImageIcon;
      default:
        return Film;
    }
  };

  const Icon = getIcon();

  const formatResolution = () => {
    if (item.metadata?.width && item.metadata?.height) {
      return `${item.metadata.width}×${item.metadata.height}`;
    }
    return null;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const iconColor = item.type === "audio"
    ? "text-primary/50"
    : item.type === "image"
      ? "text-primary/50"
      : "text-status-info/50";

  const borderClass = item.kieaiError
    ? "border-red-500 ring-1 ring-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]"
    : item.isPending
    ? "border-primary ring-1 ring-primary shadow-glow"
    : item.isPlaceholder
      ? "border-yellow-500 ring-1 ring-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]"
      : isSelected
        ? "border-transparent or-ring"
        : "border-glass-border hover:border-border-strong";

  const hoverOverlay = (
    <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center gap-2 animate-in fade-in duration-200">
      {item.kieaiError ? (
        <PanelIconButton
          label="Retry generation"
          icon={<RefreshCw size={14} className="text-red-400" />}
          onClick={(e) => { e.stopPropagation(); onRetryKieAI?.(); }}
          className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
        />
      ) : item.isPending ? (
        <div title="KieAI generation in progress…" className="p-2">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : item.isPlaceholder ? (
        <>
          <PanelIconButton
            label="Replace asset"
            icon={<RefreshCw size={14} className="text-yellow-500" />}
            onClick={(e) => { e.stopPropagation(); onReplace(); }}
            className="p-2 bg-yellow-500/20 rounded-full hover:bg-yellow-500/40 backdrop-blur-sm transition-colors"
          />
          <PanelIconButton
            label="Delete"
            icon={<Trash2 size={14} className="text-red-400" />}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          />
        </>
      ) : (
        <>
          {item.type === "image" && onKieAI && (
            <PanelIconButton
              label="Create with KieAI"
              icon={<Sparkles size={14} className="text-primary" />}
              onClick={(e) => { e.stopPropagation(); onKieAI(); }}
              className="p-2 bg-primary/20 rounded-full hover:bg-primary/40 backdrop-blur-sm transition-colors"
            />
          )}
          <PanelIconButton
            label="Add to timeline"
            icon={<Plus size={14} className="text-primary" />}
            onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
            className="p-2 bg-primary/20 rounded-full hover:bg-primary/40 backdrop-blur-sm transition-colors"
          />
          <PanelIconButton
            label="Delete"
            icon={<Trash2 size={14} className="text-red-400" />}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          />
        </>
      )}
    </div>
  );

  // --- List view ---
  if (viewMode === "list") {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-center gap-3 px-2 py-1.5 rounded-lg border-2 cursor-pointer transition-all group ${borderClass}`}
      >
        {/* Small thumbnail */}
        <div className="w-12 h-8 rounded-md bg-bg-2 relative overflow-hidden flex-shrink-0">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon size={14} className={iconColor} />
            </div>
          )}
          {item.kieaiError && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
              <AlertTriangle size={12} className="text-red-400" />
            </div>
          )}
          {!item.kieaiError && item.isPending && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/10">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {!item.kieaiError && !item.isPending && item.isPlaceholder && (
            <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
              <AlertTriangle size={12} className="text-yellow-500/70" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div
            className={`text-[12px] truncate font-medium ${isSelected ? "text-accent" : "text-fg-2"}`}
            title={item.name}
          >
            {item.name}
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-fg-muted">
            {item.metadata?.duration && <span>{formatDuration(item.metadata.duration)}</span>}
            {item.metadata?.duration && formatResolution() && <span>•</span>}
            {formatResolution() && <span>{formatResolution()}</span>}
            {(item.metadata?.duration || formatResolution()) && formatFileSize(item.metadata?.fileSize) && <span>•</span>}
            {formatFileSize(item.metadata?.fileSize) && <span>{formatFileSize(item.metadata?.fileSize)}</span>}
          </div>
        </div>

        {/* Hover actions */}
        {isHovered && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {item.kieaiError ? (
              <PanelIconButton
                label="Retry generation"
                icon={<RefreshCw size={12} className="text-red-400" />}
                onClick={(e) => { e.stopPropagation(); onRetryKieAI?.(); }}
                className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
              />
            ) : item.isPending ? (
              <div className="p-1" title="Generating…">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : item.isPlaceholder ? (
              <>
                <PanelIconButton
                  label="Replace asset"
                  icon={<RefreshCw size={12} className="text-yellow-500" />}
                  onClick={(e) => { e.stopPropagation(); onReplace(); }}
                  className="p-1 bg-yellow-500/20 rounded hover:bg-yellow-500/40 transition-colors"
                />
                <PanelIconButton
                  label="Delete"
                  icon={<Trash2 size={12} className="text-red-400" />}
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                />
              </>
            ) : (
              <>
                {item.type === "image" && onKieAI && (
                  <PanelIconButton
                    label="Create with KieAI"
                    icon={<Sparkles size={12} className="text-primary" />}
                    onClick={(e) => { e.stopPropagation(); onKieAI(); }}
                    className="p-1 bg-primary/20 rounded hover:bg-primary/40 transition-colors"
                  />
                )}
                <PanelIconButton
                  label="Add to timeline"
                  icon={<Plus size={12} className="text-primary" />}
                  onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
                  className="p-1 bg-primary/20 rounded hover:bg-primary/40 transition-colors"
                />
                <PanelIconButton
                  label="Delete"
                  icon={<Trash2 size={12} className="text-red-400" />}
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                />
              </>
            )}
          </div>
        )}

        {isSelected && (
          <div className="w-2 h-2 bg-accent rounded-full shadow-sm flex-shrink-0" />
        )}
      </div>
    );
  }

  // --- Grid view (large & small) ---
  const thumbnailIconSize = viewMode === "small" ? 16 : 24;

  return (
    <div className="flex flex-col">
      {/* Thumbnail container */}
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onAddToTimeline();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`bg-bg-2 rounded-tile border relative group cursor-pointer transition-all overflow-hidden ${borderClass}`}
        style={{ aspectRatio: aspect }}
      >
        {/* Thumbnail or placeholder */}
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-2">
            <Icon size={thumbnailIconSize} className={iconColor} />
          </div>
        )}

        {/* Audio waveform placeholder */}
        {item.type === "audio" && (
          <div className="absolute top-1/2 left-0 right-0 h-4 flex items-center gap-px px-2 -translate-y-1/2">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-primary/30 rounded-full"
                style={{ height: `${30 + ((i * 37 + item.id.length * 11) % 70)}%` }}
              />
            ))}
          </div>
        )}

        {/* KieAI Error Badge */}
        {item.kieaiError && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-red-500 rounded text-[8px] text-white font-bold flex items-center gap-1">
            <AlertTriangle size={8} />
            Failed
          </div>
        )}

        {/* Pending KieAI Badge */}
        {!item.kieaiError && item.isPending && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-primary rounded text-[8px] text-primary-foreground font-bold flex items-center gap-1">
            <div className="h-2 w-2 animate-spin rounded-full border border-white border-t-transparent" />
            AI
          </div>
        )}

        {/* Missing Asset Badge */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-yellow-500 rounded text-[8px] text-black font-bold flex items-center gap-1">
            <AlertTriangle size={10} />
            Missing
          </div>
        )}

        {/* Duration badge on thumbnail */}
        {item.metadata?.duration && (
          <div className="absolute bottom-1.5 right-1.5 px-[7px] py-px rounded-pill border border-control-border bg-capsule backdrop-blur-[18px] font-mono text-[10px] text-fg-strong tabular-nums">
            {formatDuration(item.metadata.duration)}
          </div>
        )}

        {/* Error overlay */}
        {item.kieaiError && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-red-400/60" />
          </div>
        )}

        {/* Pending overlay */}
        {!item.kieaiError && item.isPending && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary/10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {/* Warning icon overlay for placeholders */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-yellow-500/50" />
          </div>
        )}

        {/* Hover overlay with actions */}
        {isHovered && hoverOverlay}

      </div>

      {/* Filename below thumbnail */}
      <div
        className="text-[12px] truncate px-0.5 text-fg-2 mt-[7px]"
        title={item.name}
      >
        {item.name}
      </div>
    </div>
  );
};

export const EmptyState: React.FC<{ onImport: () => void }> = ({ onImport }) => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
    <div className="w-16 h-16 rounded-2xl bg-bg-2 border border-border flex items-center justify-center mb-4 shadow-inner">
      <Upload size={24} className="text-fg-muted" />
    </div>
    <Text type="body" color="secondary" weight="bold" display="block" className="mb-2 text-sm text-fg">
      No media imported
    </Text>
    <Text type="supporting" color="secondary" display="block" className="mb-6 text-xs text-fg-3">
      Drag files here or click to import
    </Text>
    <Button
      label="Import Media"
      variant="ghost"
      onClick={onImport}
      className="px-4 py-2 bg-bg-2 hover:bg-bg-3 border border-border text-fg-2 text-xs font-medium rounded-lg transition-all hover:border-accent/50"
    />
  </div>
);

export const LoadingIndicator: React.FC<{ message: string }> = ({ message }) => (
  <div className="absolute inset-0 bg-bg-1/90 backdrop-blur-sm flex flex-col items-center justify-center z-50">
    <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
    <Text type="body" color="secondary" display="block" className="text-sm text-fg-2">{message}</Text>
  </div>
);
