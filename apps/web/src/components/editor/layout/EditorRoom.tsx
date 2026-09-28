import React, { useState } from "react";
import { STUDIO_API } from "../../../services/studio/studio-client";
import { useStudioStore } from "../../../services/studio/studio-session";

/**
 * The room behind the editor (docs/PROPOSAL_EDITOR_REDESIGN.md R1.2), as the studio
 * draws it behind its own pages (studio/frontend/src/components/Room.jsx): the film's
 * look picture, which the studio has already blurred and widened, scaled 1.15 so its
 * soft edge never shows, under a deep scrim - or, when the film has no look picture
 * (the studio answers 404) and outside a studio film, the gradient under a lighter one.
 * Nothing here blurs a full-size bitmap.
 */
export function roomUrl(pid: string | null): string | null {
  return pid ? `${STUDIO_API}/projects/${encodeURIComponent(pid)}/look/room` : null;
}

export const EditorRoom: React.FC = () => {
  const pid = useStudioStore((s) => s.pid);
  const src = roomUrl(pid);
  // A src that failed once (a 404: no look picture) is remembered, not retried.
  const [missing, setMissing] = useState<string | null>(null);
  const picture = src && src !== missing ? src : null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-bg">
      {picture ? (
        <img
          key={picture}
          src={picture}
          alt=""
          onError={() => setMissing(picture)}
          className="absolute inset-0 h-full w-full scale-[1.15] object-cover"
        />
      ) : (
        <div className="absolute inset-0" style={{ background: "var(--room-gradient)" }} />
      )}
      <div
        className="absolute inset-0"
        style={{ background: picture ? "var(--room-scrim-look)" : "var(--room-scrim)" }}
      />
    </div>
  );
};
