import React, { useCallback, useEffect } from "react";
import { useStudioStore, saveToStudio } from "../../../services/studio/studio-session";
import { studioHomeUrl } from "../../../services/studio/studio-client";
import { RailGlyph, RailLabel, RailButton, railItemClass } from "./RailItem";

/**
 * The rail's two Clip Studio items, shown only when the editor was opened from a studio
 * film: the way back to the studio at the top, and Save at the foot (the old top bar's
 * studio strip, moved; Robert, 2026-09-28). Saving itself is unchanged - these call the
 * same `saveToStudio` the strip did.
 */

/** What the editor posts to the studio page holding it when "Studio" is pressed: the
 *  studio navigates back to the part on Film itself, keeping this frame (and the cut in
 *  it) alive. The studio listens for the same literal (studio/frontend
 *  `components/Editor.jsx`, `EDITOR_BACK`). */
export const EDITOR_BACK = "clip-studio:editor-back";

/** What the editor posts to the studio page holding it once this item is showing: the
 *  studio gives the frame the whole window only after it, so an editor without its own
 *  way back is never left without the studio's (studio/frontend `EDITOR_CHROME`). */
export const EDITOR_CHROME = "clip-studio:editor-chrome";

const BackGlyph = (
  <RailGlyph>
    <path d="M15 5l-7 7 7 7" />
  </RailGlyph>
);

export const StudioBackItem: React.FC = () => {
  const pid = useStudioStore((s) => s.pid);
  // Inside the studio's Edit page the editor is a frame, and the studio gives it the
  // whole window, so this is the way back there: the studio is asked to navigate.
  const embedded = typeof window !== "undefined" && window.self !== window.top;
  useEffect(() => {
    if (pid && embedded) window.parent.postMessage({ type: EDITOR_CHROME }, window.location.origin);
  }, [pid, embedded]);
  if (!pid) return null;
  if (embedded) {
    return (
      <RailButton
        icon={BackGlyph}
        label="Studio"
        aria-label="Back to Clip Studio"
        title="Back to Clip Studio"
        onClick={() => window.parent.postMessage({ type: EDITOR_BACK }, window.location.origin)}
      />
    );
  }
  return (
    <a href={studioHomeUrl()} title="Back to Clip Studio" aria-label="Back to Clip Studio" className={railItemClass(false)}>
      {BackGlyph}
      <RailLabel>Studio</RailLabel>
    </a>
  );
};

export const StudioSaveItem: React.FC = () => {
  const pid = useStudioStore((s) => s.pid);
  const status = useStudioStore((s) => s.status);
  const dirty = useStudioStore((s) => s.dirty);
  const error = useStudioStore((s) => s.error);
  const message = useStudioStore((s) => s.message);
  const onSave = useCallback(() => void saveToStudio(), []);
  if (!pid) return null;

  const label =
    status === "opening"
      ? "Opening"
      : status === "saving"
        ? "Saving…"
        : error
          ? "Retry"
          : dirty
            ? "Save"
            : "Saved";
  const title =
    status === "opening"
      ? message || "Opening…"
      : error
        ? `Last save failed: ${error}`
        : dirty
          ? "Save the edit into the Clip Studio project"
          : "The edit is saved in the Clip Studio project";

  return (
    <RailButton
      icon={
        <RailGlyph>
          {dirty || error ? (
            <>
              <path d="M5 4h11l3 3v13H5z" />
              <path d="M8 4v5h7V4M8 20v-6h8v6" />
            </>
          ) : (
            <path d="M5 12.5l4.5 4.5L19 7" />
          )}
        </RailGlyph>
      }
      label={label}
      title={title}
      aria-label={title}
      lit={dirty || Boolean(error)}
      onClick={onSave}
      disabled={status === "saving" || status === "opening" || status === "exporting" || (!dirty && !error)}
    />
  );
};
