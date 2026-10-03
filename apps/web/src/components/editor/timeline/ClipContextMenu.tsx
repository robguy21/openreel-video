import React from "react";
import type { ToolcraftContextMenuOption as ContextMenuOption } from "@openreel/ui";
import {
  Copy,
  Layers,
  Trash2,
  Scissors,
  Music,
  Sparkles,
  Volume2,
  Film,
  Image,
  ArrowLeftToLine,
  ListChecks,
  Link,
  Unlink,
} from "@/icons/lucide-compat";
import type { Clip, Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { getTimelineTrackSelection } from "../../../utils/timeline-item-actions";
import { partnerOf } from "../../../stores/project/linked-clips";

interface ClipContextMenuProps {
  clip: Clip;
  track: Track;
  onClose?: () => void;
}

export function useClipContextMenuItems({
  clip,
  track,
  onClose,
}: ClipContextMenuProps): ContextMenuOption[] {
  const {
    copyClips,
    duplicateClip,
    removeClip,
    rippleDeleteClip,
    splitClip,
    separateAudio,
    getMediaItem,
    copyEffects,
    pasteEffects,
    copiedEffects,
    closeGapBeforeClip,
    linkClips,
    unlinkClip,
  } = useProjectStore();
  const isPlayheadOnClip = useTimelineStore(
    (s) =>
      s.playheadPosition >= clip.startTime &&
      s.playheadPosition <= clip.startTime + clip.duration,
  );
  const selectMultiple = useUIStore((state) => state.selectMultiple);
  const selectedItems = useUIStore((state) => state.selectedItems);

  const hasGapBeforeClip = React.useMemo(() => {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    const idx = sorted.findIndex((c) => c.id === clip.id);
    if (idx < 0) return false;
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const target = prev ? prev.startTime + prev.duration : 0;
    return clip.startTime - target > 0.0001;
  }, [track.clips, clip.id, clip.startTime]);

  const mediaItem = getMediaItem(clip.mediaId);
  const clipMediaType = mediaItem?.type ?? track.type;
  const isVideo = clipMediaType === "video";
  const isAudio = clipMediaType === "audio";
  const isImage = clipMediaType === "image";
  const isVideoWithAudio =
    isVideo &&
    mediaItem?.type === "video" &&
    mediaItem?.metadata?.channels &&
    mediaItem.metadata.channels > 0;

  // Linked clips (R8.6): this clip's partner, and - for Link - the one other clip selected,
  // when the two are one picture and one sound.
  const partner = partnerOf(useProjectStore.getState().project, clip.id);
  const linkCandidate = React.useMemo(() => {
    if (partner) return null;
    const others = selectedItems.filter((s) => s.type === "clip" && s.id !== clip.id);
    if (others.length !== 1 || !selectedItems.some((s) => s.id === clip.id)) return null;
    const store = useProjectStore.getState();
    const other = store.getClip(others[0].id);
    if (!other) return null;
    const kindOf = (c: Clip) => store.getMediaItem(c.mediaId)?.type;
    const kinds = [kindOf(clip), kindOf(other)];
    const onePicture = kinds.filter((k) => k === "video" || k === "image").length === 1;
    const oneSound = kinds.filter((k) => k === "audio").length === 1;
    return onePicture && oneSound ? other : null;
  }, [partner, selectedItems, clip]);

  const hasEffects = clip.effects && clip.effects.length > 0;
  const hasCopiedEffects = copiedEffects && copiedEffects.length > 0;

  const handleCopy = () => {
    copyClips(partner ? [clip.id, partner.id] : [clip.id]);
    onClose?.();
  };

  const handleUnlink = async () => {
    await unlinkClip(clip.id);
    onClose?.();
  };

  const handleLink = async () => {
    if (linkCandidate) await linkClips(clip.id, linkCandidate.id);
    onClose?.();
  };

  const handleDuplicate = async () => {
    await duplicateClip(clip.id);
    onClose?.();
  };

  const handleSelectTrackClips = () => {
    const project = useProjectStore.getState().getFullProject();
    selectMultiple(getTimelineTrackSelection(project, track.id));
    onClose?.();
  };

  const handleDelete = async () => {
    await removeClip(clip.id);
    onClose?.();
  };

  const handleRippleDelete = async () => {
    await rippleDeleteClip(clip.id);
    onClose?.();
  };

  const handleSplit = async () => {
    if (isPlayheadOnClip) {
      await splitClip(clip.id, useTimelineStore.getState().playheadPosition);
    }
    onClose?.();
  };

  const handleCloseGap = async () => {
    await closeGapBeforeClip(clip.id);
    onClose?.();
  };

  const handleSeparateAudio = async () => {
    await separateAudio(clip.id);
    onClose?.();
  };

  const handleCopyEffects = () => {
    copyEffects(clip.id);
    onClose?.();
  };

  const handlePasteEffects = async () => {
    await pasteEffects(clip.id);
    onClose?.();
  };

  const getClipTypeLabel = () => {
    if (isVideo) return "Video Clip";
    if (isAudio) return "Audio Clip";
    if (isImage) return "Image Clip";
    return "Clip";
  };

  const getClipTypeIcon = () => {
    if (isVideo) return <Film size={14} className="text-primary" aria-hidden />;
    if (isAudio) return <Volume2 size={14} className="text-blue-400" aria-hidden />;
    if (isImage) return <Image size={14} className="text-primary" aria-hidden />;
    return null;
  };

  const items: ContextMenuOption[] = [
    {
      type: "section",
      title: getClipTypeLabel(),
      items: [
        {
          label: getClipTypeLabel(),
          icon: getClipTypeIcon() ?? undefined,
          isDisabled: true,
        },
      ],
    },
    { type: "divider" },
    {
      label: "Copy Clip",
      icon: <Copy size={14} aria-hidden />,
      onClick: handleCopy,
    },
    {
      label: "Duplicate",
      icon: <Layers size={14} aria-hidden />,
      onClick: handleDuplicate,
    },
    {
      label: "Select All Clips on Track",
      icon: <ListChecks size={14} aria-hidden />,
      onClick: handleSelectTrackClips,
    },
    { type: "divider" },
    {
      label: "Split at Playhead",
      icon: <Scissors size={14} aria-hidden />,
      isDisabled: !isPlayheadOnClip,
      onClick: handleSplit,
    },
    {
      label: "Close Gap to Previous",
      icon: <ArrowLeftToLine size={14} aria-hidden />,
      isDisabled: !hasGapBeforeClip,
      onClick: handleCloseGap,
    },
  ];

  if (isVideo || isImage) {
    items.push({
      type: "section",
      title: "Effects",
      items: [
        {
          label: "Copy Effects",
          icon: <Sparkles size={14} aria-hidden />,
          isDisabled: !hasEffects,
          onClick: handleCopyEffects,
        },
        {
          label: "Paste Effects",
          icon: <Sparkles size={14} aria-hidden />,
          isDisabled: !hasCopiedEffects,
          onClick: handlePasteEffects,
        },
      ],
    });
  }

  if (partner) {
    items.push({
      label: "Unlink",
      icon: <Unlink size={14} aria-hidden />,
      onClick: handleUnlink,
    });
  } else if (linkCandidate) {
    items.push({
      label: "Link",
      icon: <Link size={14} aria-hidden />,
      onClick: handleLink,
    });
  }

  // A picture that already has its sound on a row of its own has nothing to separate.
  if (isVideoWithAudio && !partner) {
    items.push({
      label: "Separate Audio",
      icon: <Music size={14} aria-hidden />,
      onClick: handleSeparateAudio,
    });
  }

  if (isAudio) {
    items.push({
      type: "section",
      title: "Audio",
      items: [
        {
          label: "Copy Audio Effects",
          icon: <Volume2 size={14} aria-hidden />,
          isDisabled: !hasEffects,
          onClick: handleCopyEffects,
        },
        {
          label: "Paste Audio Effects",
          icon: <Volume2 size={14} aria-hidden />,
          isDisabled: !hasCopiedEffects,
          onClick: handlePasteEffects,
        },
      ],
    });
  }

  items.push(
    { type: "divider" },
    {
      label: "Ripple Delete",
      icon: <Trash2 size={14} aria-hidden />,
      onClick: handleRippleDelete,
    },
    {
      label: "Delete",
      icon: <Trash2 size={14} aria-hidden />,
      onClick: handleDelete,
    },
  );

  return items;
}

export const ClipContextMenu: React.FC<ClipContextMenuProps> = (props) => {
  useClipContextMenuItems(props);
  return null;
};
