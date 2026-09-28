import React, { useCallback, useState } from "react";
import {
  Sparkles, Video, Type, Shapes, Wand2, LayoutTemplate, Zap, Shuffle,
} from "@/icons/lucide-compat";
import { AIGenTab } from "./AIGenTab";
import { RecipesTab } from "./panels/RecipesTab";
import { TemplatesTab } from "./panels/TemplatesTab";
import {
  EffectsPanel,
  TransitionsPanel,
} from "./panels/EffectsTransitionsPanel";
import { MomentsPanel } from "./panels/MomentsPanel";
import { useTtsAudioStore } from "../../stores/tts-store";
import { toast } from "../../stores/notification-store";
import { MediaSection } from "./assets/MediaSection";
import { TextSection } from "./assets/TextSection";
import { GraphicsSection } from "./assets/GraphicsSection";

export { DEFAULT_TITLE_STYLE, TEXT_STYLE_PRESETS } from "./assets/TextSection";

type AssetsTab =
  | "media"
  | "text"
  | "graphics"
  | "effects"
  | "transitions"
  | "ai"
  | "recipes"
  | "templates"
  | "moments";

const ASSETS_TABS: ReadonlyArray<{
  value: AssetsTab;
  label: string;
  description: string;
}> = [
  {
    value: "media",
    label: "Media",
    description: "Import footage, audio, and stills.",
  },
  {
    value: "text",
    label: "Text",
    description: "Add title presets and caption elements.",
  },
  {
    value: "graphics",
    label: "Graphics",
    description: "Create shapes, arrows, and SVG overlays.",
  },
  {
    value: "effects",
    label: "Effects",
    description: "Drag effects onto a clip to apply them.",
  },
  {
    value: "transitions",
    label: "Transitions",
    description: "Drag transitions onto a clip's edge.",
  },
  {
    value: "ai",
    label: "AI Generate",
    description: "Generate clips, captions, and assisted edits.",
  },
  {
    value: "recipes",
    label: "Recipes",
    description: "Apply clip-scoped looks, overlays, and text stacks.",
  },
  {
    value: "moments",
    label: "Moments",
    description: "OneLink Moments: timed quiz, promotion, and product events.",
  },
  {
    value: "templates",
    label: "Project Templates",
    description: "Load full-project starter layouts and presets.",
  },
] as const;

const TAB_ICONS: Record<AssetsTab, React.ElementType> = {
  media: Video,
  text: Type,
  graphics: Shapes,
  effects: Zap,
  transitions: Shuffle,
  ai: Sparkles,
  recipes: Wand2,
  templates: LayoutTemplate,
  moments: Sparkles,
};

export const AssetsPanel: React.FC = () => {
  const [activeTab, setActiveTabRaw] = useState<AssetsTab>("media");
  const ttsHasUnsaved = useTtsAudioStore((s) => s.generatedAudio !== null && !s.isAudioSaved);

  const setActiveTab = useCallback((tab: AssetsTab) => {
    if (activeTab === "ai" && tab !== "ai" && ttsHasUnsaved) {
      toast.warning("Unsaved audio discarded", "Save to media or download next time to keep it.");
    }
    setActiveTabRaw(tab);
  }, [activeTab, ttsHasUnsaved]);

  const renderSectionContent = (tab: AssetsTab): React.ReactNode => {
    switch (tab) {
      case "media":
        return <MediaSection />;
      case "graphics":
        return <GraphicsSection />;
      case "text":
        return <TextSection />;
      case "effects":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-bg-1">
            <EffectsPanel />
          </div>
        );
      case "transitions":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-bg-1">
            <TransitionsPanel />
          </div>
        );
      case "moments":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-bg-1">
            <MomentsPanel />
          </div>
        );
      case "ai":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <AIGenTab />
          </div>
        );
      case "recipes":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <RecipesTab />
          </div>
        );
      case "templates":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <TemplatesTab />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      data-tour="assets"
      className="w-full h-full bg-bg-1 overflow-hidden flex flex-row relative"
    >
      {/* ── Vertical tool rail (icon + label, left) ───────────── */}
      <div className="flex flex-col items-center gap-1 px-0 py-[14px] border-r border-border bg-bg-1 overflow-y-auto scrollbar-none shrink-0 w-[92px]">
        {ASSETS_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.value];
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              aria-label={tab.label}
              aria-pressed={isActive}
              title={tab.label}
              onClick={() => setActiveTab(tab.value)}
              className={`group flex h-16 w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] px-1 py-2 text-[10px] leading-tight tracking-tight transition-colors ${
                isActive
                  ? "bg-selected text-accent font-semibold"
                  : "text-fg-muted font-medium"
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 1.8 : 1.7} />
              <span className="block max-w-full text-center leading-[11px]">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Body: section content fills the remaining space ──── */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-bg-1 relative">
        {/* Dynamic Section Content */}
        <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden">
          {activeTab !== "media" && (
            <div className="min-w-0 px-4 pt-[18px] pb-0 shrink-0">
              <div
                className="truncate font-bold text-[18px] text-fg"
                title={ASSETS_TABS.find((t) => t.value === activeTab)?.label}
              >
                {ASSETS_TABS.find((t) => t.value === activeTab)?.label}
              </div>
            </div>
          )}
          {renderSectionContent(activeTab)}
        </div>
      </div>
    </div>
  );
};

export default AssetsPanel;
