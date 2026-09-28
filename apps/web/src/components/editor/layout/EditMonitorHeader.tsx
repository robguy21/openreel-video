import React from "react";
import { useProjectStore } from "../../../stores/project-store";
import { useStudioStore } from "../../../services/studio/studio-session";
import { ProjectSwitcher } from "../ProjectSwitcher";

/**
 * The Edit monitor's header, on the monitor's own glass (docs/PROPOSAL_EDITOR_REDESIGN.md
 * R6.1 and the Main board): "Edit" and what is being cut - the film and part inside a Clip
 * Studio session, where the film's name is the studio's; the editor's own project, which
 * can be renamed or switched there, outside one. With the top bar gone (Robert,
 * 2026-09-28) this is where the film is named.
 */
export function monitorSubtitle(name: string, partLabel: string): string {
  const film = partLabel ? `${name} · ${partLabel}` : name;
  return `${film}, as cut`;
}

export const EditMonitorHeader: React.FC = () => {
  const pid = useStudioStore((s) => s.pid);
  const name = useStudioStore((s) => s.name);
  const partLabel = useStudioStore((s) => s.partLabel);
  const projectName = useProjectStore((s) => s.project.name);

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 pl-5 pr-3">
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[color:var(--ring-color)]" aria-hidden="true" />
      <h2 className="text-[13px] font-semibold text-fg-strong">Edit</h2>
      {pid ? (
        <span className="min-w-0 truncate text-[12px] text-fg-2" title={monitorSubtitle(name, partLabel)}>
          {monitorSubtitle(name, partLabel)}
        </span>
      ) : (
        <>
          <span className="min-w-0 truncate text-[12px] text-fg-2" title={projectName}>
            {projectName}
          </span>
          <ProjectSwitcher />
        </>
      )}
    </div>
  );
};
