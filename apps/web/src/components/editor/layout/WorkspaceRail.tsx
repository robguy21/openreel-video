import React from "react";
import { useUIStore, type WorkspaceTab } from "../../../stores/ui-store";
import { RailLabel, railItemClass } from "./RailItem";

/**
 * The editor's one sidebar rail (docs/PROPOSAL_EDITOR_REDESIGN.md R4.1): a tall glass
 * pill, 72 px wide, holding the workspace tabs in order - Media first, then the tools,
 * a divider, and Assistant and History. The chosen one is lit. The icons are the
 * boards' own (docs/mockups/editor-redesign/Main.dc.html).
 */

interface RailItem {
  tab: WorkspaceTab;
  label: string;
  icon: React.ReactNode;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const Glyph: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    {children}
  </svg>
);

export const RAIL_TOOLS: ReadonlyArray<RailItem> = [
  {
    tab: "media",
    label: "Media",
    icon: (
      <Glyph>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 9.5v5l4-2.5z" />
      </Glyph>
    ),
  },
  {
    tab: "properties",
    label: "Properties",
    icon: (
      <Glyph>
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
      </Glyph>
    ),
  },
  {
    tab: "text",
    label: "Text",
    icon: (
      <Glyph>
        <path d="M5 7V4h14v3M12 4v16M9 20h6" />
      </Glyph>
    ),
  },
  {
    tab: "graphics",
    label: "Graphics",
    icon: (
      <Glyph>
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <circle cx="17" cy="17" r="4" />
        <path d="M17 3l4 7h-8z" />
      </Glyph>
    ),
  },
  {
    tab: "effects",
    label: "Effects",
    icon: (
      <Glyph>
        <path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z" />
        <path d="M19 15v5M16.5 17.5h5" />
      </Glyph>
    ),
  },
  {
    tab: "transitions",
    label: "Transitions",
    icon: (
      <Glyph>
        <rect x="2" y="6" width="9" height="12" rx="1" />
        <rect x="13" y="6" width="9" height="12" rx="1" />
        <path d="M9 12h6M13 10l2 2-2 2" />
      </Glyph>
    ),
  },
  {
    tab: "moments",
    label: "Moments",
    icon: (
      <Glyph>
        <path d="M7 4h10v16l-5-4-5 4z" />
      </Glyph>
    ),
  },
  {
    tab: "audio",
    label: "Audio",
    icon: (
      <Glyph>
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
      </Glyph>
    ),
  },
  {
    tab: "templates",
    label: "Templates",
    icon: (
      <Glyph>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 9v12" />
      </Glyph>
    ),
  },
];

export const RAIL_HELPERS: ReadonlyArray<RailItem> = [
  {
    tab: "assistant",
    label: "Assistant",
    icon: (
      <Glyph>
        <path d="M4 5h16v11H9l-5 4z" />
      </Glyph>
    ),
  },
  {
    tab: "history",
    label: "History",
    icon: (
      <Glyph>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </Glyph>
    ),
  },
];

/** Every tab's title, as the workspace panel heads it. */
export const WORKSPACE_TITLES: Record<WorkspaceTab, string> = Object.fromEntries(
  [...RAIL_TOOLS, ...RAIL_HELPERS].map((item) => [item.tab, item.label]),
) as Record<WorkspaceTab, string>;

const TabButton: React.FC<{
  item: RailItem;
  active: boolean;
  onPick: (tab: WorkspaceTab) => void;
}> = ({ item, active, onPick }) => (
  <button
    type="button"
    aria-pressed={active}
    aria-label={item.label}
    title={item.label}
    onClick={() => onPick(item.tab)}
    className={railItemClass(active)}
  >
    {item.icon}
    <RailLabel>{item.label}</RailLabel>
  </button>
);

const Divider: React.FC = () => (
  <div className="my-1 h-px w-8 shrink-0 bg-glass-border" aria-hidden="true" />
);

/**
 * `top` is drawn above the tabs (the way back to the studio) and `foot` pinned below
 * them (Save, Export, "..."), since the editor has no top bar (Robert, 2026-09-28). The
 * tabs scroll between the two on a short window.
 */
export const WorkspaceRail: React.FC<{ top?: React.ReactNode; foot?: React.ReactNode }> = ({
  top,
  foot,
}) => {
  const workspaceTab = useUIStore((s) => s.workspaceTab);
  const setWorkspaceTab = useUIStore((s) => s.setWorkspaceTab);

  return (
    <nav
      aria-label="Workspace"
      data-tour="toolbar"
      className="or-glass flex min-h-0 w-full flex-col items-center rounded-pill py-2"
    >
      {top && (
        <div className="flex shrink-0 flex-col items-center">
          {top}
          <Divider />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden scrollbar-none">
        {RAIL_TOOLS.map((item) => (
          <TabButton
            key={item.tab}
            item={item}
            active={workspaceTab === item.tab}
            onPick={setWorkspaceTab}
          />
        ))}
        <Divider />
        {RAIL_HELPERS.map((item) => (
          <TabButton
            key={item.tab}
            item={item}
            active={workspaceTab === item.tab}
            onPick={setWorkspaceTab}
          />
        ))}
      </div>
      {foot && (
        <div className="flex shrink-0 flex-col items-center gap-0.5">
          <Divider />
          {foot}
        </div>
      )}
    </nav>
  );
};
