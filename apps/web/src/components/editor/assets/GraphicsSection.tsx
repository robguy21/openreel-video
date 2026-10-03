import React, { useCallback, useState } from "react";
import {
  Square, Circle, Triangle, Star, ArrowRight, Hexagon, FileCode, Plus, Palette,
} from "@/icons/lucide-compat";
import {
  BACKGROUND_PRESETS,
  generateBackgroundBlob,
  type BackgroundPreset,
} from "../../../services/background-generator";
import type { ShapeType } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { StickerPickerPanel } from "../inspector/StickerPickerPanel";
import { insertTimelineOverlay } from "../../../stores/project/insert-timeline-overlay";
import { PanelButton } from "./shared";

/**
 * The Graphics section: generated backgrounds, shapes, 3D objects, SVG import and
 * stickers. Moved out of AssetsPanel.tsx unchanged (docs/PROPOSAL_EDITOR_REDESIGN.md
 * R4.5); the editor's sidebar shows it as the Graphics tab.
 */
export const GraphicsSection: React.FC = () => {
  const { select } = useUIStore();
  const { project, importMedia } = useProjectStore();
  const [generatingBackground, setGeneratingBackground] = useState<
    string | null
  >(null);
  const [backgroundCategory, setBackgroundCategory] = useState<
    "all" | "solid" | "gradient" | "pattern" | "mesh"
  >("all");

  const handleImportBackground = useCallback(
    async (preset: BackgroundPreset) => {
      setGeneratingBackground(preset.id);
      try {
        const { width, height } = project.settings;
        const blob = await generateBackgroundBlob(preset, width, height);
        const file = new File([blob], `${preset.name}_${width}x${height}.png`, {
          type: "image/png",
        });
        const result = await importMedia(file);
        if (result.success && result.actionId) {
          const { addClipToNewTrack } = useProjectStore.getState();
          await addClipToNewTrack(result.actionId);
        }
      } catch (error) {
        console.error("Failed to generate background:", error);
      } finally {
        setGeneratingBackground(null);
      }
    },
    [importMedia, project.settings],
  );

  const filteredBackgrounds = BACKGROUND_PRESETS.filter(
    (preset) =>
      backgroundCategory === "all" || preset.category === backgroundCategory,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border/70">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-4 py-4">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <Text type="label" color="secondary" weight="bold" display="block" className="flex items-center gap-1.5 text-xs">
                <Palette size={12} />
                Backgrounds
              </Text>
            </div>
            <div className="flex gap-1.5 mb-3 flex-wrap">
              {(["all", "solid", "gradient", "mesh", "pattern"] as const).map(
                (cat) => (
                  <SelectableCard
                    key={cat}
                    label={cat.charAt(0).toUpperCase() + cat.slice(1)}
                    isSelected={backgroundCategory === cat}
                    onChange={() => setBackgroundCategory(cat)}
                    onClick={() => setBackgroundCategory(cat)}
                    padding={1}
                    variant={backgroundCategory === cat ? "green" : "muted"}
                    className={`px-2.5 py-1 text-[10px] rounded-md transition-all ${
                      backgroundCategory === cat
                        ? "bg-primary text-white"
                        : "bg-background-tertiary text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </SelectableCard>
                ),
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {filteredBackgrounds.map((preset) => (
                <PanelButton
                  key={preset.id}
                  label={preset.name}
                  onClick={() => handleImportBackground(preset)}
                  isDisabled={generatingBackground !== null}
                  className="aspect-square rounded-lg border border-border hover:border-primary/50 transition-all overflow-hidden relative group disabled:opacity-50"
                >
                  <span className="absolute inset-0" style={{ background: preset.thumbnail }} />
                  {generatingBackground === preset.id && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Plus size={16} className="text-white" />
                  </div>
                  <span className="absolute bottom-0 left-0 right-0 text-[8px] text-white bg-black/60 py-0.5 px-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                    {preset.name}
                  </span>
                </PanelButton>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <Text type="label" color="secondary" weight="bold" display="block" className="mb-3 text-xs">
              Shapes
            </Text>
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  type: "rectangle" as ShapeType,
                  icon: Square,
                  label: "Rectangle",
                },
                { type: "circle" as ShapeType, icon: Circle, label: "Circle" },
                {
                  type: "triangle" as ShapeType,
                  icon: Triangle,
                  label: "Triangle",
                },
                { type: "star" as ShapeType, icon: Star, label: "Star" },
                {
                  type: "arrow" as ShapeType,
                  icon: ArrowRight,
                  label: "Arrow",
                },
                {
                  type: "polygon" as ShapeType,
                  icon: Hexagon,
                  label: "Polygon",
                },
              ].map((shape) => (
                <PanelButton
                  key={shape.type}
                  label={shape.label}
                  onClick={async () => {
                    const created = await insertTimelineOverlay(
                      useTimelineStore.getState().playheadPosition,
                      5,
                      (trackId) =>
                        useProjectStore
                          .getState()
                          .createShapeClip(
                            trackId,
                            useTimelineStore.getState().playheadPosition,
                            shape.type,
                          ),
                    );
                    if (created) {
                      select({
                        type: "shape-clip",
                        id: created.id,
                        trackId: created.trackId,
                      });
                    }
                  }}
                  className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1 group"
                >
                  <shape.icon
                    size={20}
                    className="text-text-secondary group-hover:text-primary transition-colors"
                  />
                  <span className="text-[9px] text-text-muted group-hover:text-text-secondary">
                    {shape.label}
                  </span>
                </PanelButton>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <Text type="label" color="secondary" weight="bold" display="block" className="mb-3 text-xs">
              3D Objects
            </Text>
            <div className="grid grid-cols-3 gap-2">
              {([
                { type: "mesh-cube" as ShapeType, label: "Cube", icon: "□" },
                { type: "mesh-sphere" as ShapeType, label: "Sphere", icon: "○" },
                { type: "mesh-torus" as ShapeType, label: "Torus", icon: "◯" },
                { type: "mesh-cone" as ShapeType, label: "Cone", icon: "△" },
                { type: "mesh-cylinder" as ShapeType, label: "Cylinder", icon: "▯" },
                { type: "mesh-icosahedron" as ShapeType, label: "Icosahedron", icon: "◆" },
              ]).map((mesh) => (
                <PanelButton
                  key={mesh.type}
                  label={mesh.label}
                  onClick={async () => {
                    const created = await insertTimelineOverlay(
                      useTimelineStore.getState().playheadPosition,
                      5,
                      (trackId) =>
                        useProjectStore
                          .getState()
                          .createShapeClip(
                            trackId,
                            useTimelineStore.getState().playheadPosition,
                            mesh.type,
                          ),
                    );
                    // Nudge the rotation so the 3D depth is visible from
                    // the get-go (otherwise a head-on cube looks flat).
                    if (created) {
                      useProjectStore.getState().updateClipRotate3D(
                        created.id,
                        { x: -18, y: 28, z: 0 },
                      );
                      select({
                        type: "shape-clip",
                        id: created.id,
                        trackId: created.trackId,
                      });
                    }
                  }}
                  className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1 group"
                >
                  <span className="text-2xl text-text-secondary group-hover:text-primary transition-colors leading-none">
                    {mesh.icon}
                  </span>
                  <span className="text-[9px] text-text-muted group-hover:text-text-secondary">
                    {mesh.label}
                  </span>
                </PanelButton>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <Text type="label" color="secondary" weight="bold" display="block" className="mb-3 text-xs">
              SVG Import
            </Text>
            <PanelButton
              label="Import SVG File"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = ".svg";
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) {
                    const content = await file.text();
                    const created = await insertTimelineOverlay(
                      useTimelineStore.getState().playheadPosition,
                      5,
                      (trackId) =>
                        useProjectStore
                          .getState()
                          .importSVG(content, trackId, useTimelineStore.getState().playheadPosition),
                    );
                    if (created) {
                      select({
                        type: "shape-clip",
                        id: created.id,
                        trackId: created.trackId,
                      });
                    }
                  }
                };
                input.click();
              }}
              className="w-full py-3 bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-center gap-2 group"
            >
              <FileCode
                size={16}
                className="text-text-secondary group-hover:text-primary transition-colors"
              />
              <span className="text-xs text-text-secondary group-hover:text-text-primary">
                Import SVG File
              </span>
            </PanelButton>
          </div>

          <div className="mb-6">
            <StickerPickerPanel />
          </div>
        </div>
      </div>
    </div>
  );
};
