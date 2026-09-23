import React, { useCallback } from "react";
import { useStudioStore, saveToStudio } from "../../services/studio/studio-session";
import { studioHomeUrl } from "../../services/studio/studio-client";

/**
 * Toolbar strip shown only when the editor was opened from Clip Studio: which project
 * this is, whether the edit is saved back there, and the last render. Exporting to the
 * studio lives on the toolbar's Export button.
 */
export const StudioBar: React.FC = () => {
  const pid = useStudioStore((s) => s.pid);
  const name = useStudioStore((s) => s.name);
  const partLabel = useStudioStore((s) => s.partLabel);
  const status = useStudioStore((s) => s.status);
  const dirty = useStudioStore((s) => s.dirty);
  const message = useStudioStore((s) => s.message);
  const progress = useStudioStore((s) => s.progress);
  const error = useStudioStore((s) => s.error);
  const lastExport = useStudioStore((s) => s.lastExport);

  const onSave = useCallback(() => void saveToStudio(), []);

  if (!pid) return null;

  // Inside the studio's Edit page the editor is an iframe; the studio's own top bar is
  // the way back, so the link would only navigate the frame to the studio's home.
  const embedded = typeof window !== "undefined" && window.self !== window.top;

  const busy = status === "opening" || status === "exporting";
  const saveLabel =
    status === "saving" ? "Saving…" : dirty ? "Save to Studio" : error ? "Retry save" : "Saved";

  const btn =
    "flex items-center gap-1.5 rounded-[8px] px-[12px] py-[7px] text-[12px] font-semibold disabled:opacity-50";

  return (
    <div
      className="flex items-center gap-2 shrink-0 rounded-[10px] bg-bg-2 px-2 py-1 border border-border"
      data-testid="studio-bar"
    >
      {embedded ? null : (
        <a
          href={studioHomeUrl()}
          className="text-[12px] text-fg-3 hover:text-fg-1 whitespace-nowrap"
          title="Back to Clip Studio"
        >
          ← Studio
        </a>
      )}
      <span
        className="text-[12px] text-fg-2 max-w-[240px] truncate"
        title={partLabel ? `${name} · ${partLabel}` : name}
      >
        {name}
        {partLabel ? <span className="text-fg-3"> · {partLabel}</span> : null}
      </span>

      {busy ? (
        <span className="text-[12px] text-fg-3 whitespace-nowrap" title={message}>
          {message || (status === "exporting" ? "Rendering…" : "Opening…")}
          {progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : ""}
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={onSave}
            disabled={status === "saving" || (!dirty && !error)}
            className={`${btn} ${dirty || error ? "bg-bg-3 text-fg-1" : "bg-transparent text-fg-3"}`}
            title={
              error
                ? `Last save failed: ${error}`
                : "Saves the edit into the Clip Studio project (also happens automatically)"
            }
          >
            {saveLabel}
          </button>
          {lastExport ? (
            <a
              href={lastExport.url}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-fg-3 hover:text-fg-1 whitespace-nowrap"
              title={lastExport.asset}
            >
              last render ↗
            </a>
          ) : null}
        </>
      )}
    </div>
  );
};
