import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import type {
  CatalogueMoment,
  Moment,
  MomentKind,
  ProductMoment,
  PromotionMoment,
  QuizMoment,
} from "@openreel/core";
import {
  createCatalogueProduct,
  createMoment,
  createQuizOption,
  getMoment,
  MOMENT_KINDS,
  MOMENT_KIND_LABELS,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { InspectorSection } from "./shell/InspectorSection";
import { InspectorClipHeader } from "./shell/InspectorClipHeader";
import { getMomentRuleMessage } from "../../../utils/moment-rules";

const MIN_MOMENT_DURATION = 0.1;

/**
 * Text input that keeps a local draft while typing and commits on blur or
 * Enter, so a single edit produces a single undo entry.
 */
const CommittedTextInput: React.FC<{
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}> = ({ label, value, onCommit, placeholder, mono, type = "text" }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <ToolcraftTextInputControl
      label={label}
      size="sm"
      width="100%"
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          (event.target as HTMLInputElement).blur();
        } else if (event.key === "Escape") {
          setDraft(value);
        }
      }}
      inputClassName={mono ? "font-mono" : undefined}
    />
  );
};

const CommittedTextArea: React.FC<{
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  rows?: number;
}> = ({ label, value, onCommit, placeholder, rows = 3 }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <ToolcraftTextAreaControl
      label={label}
      size="sm"
      width="100%"
      rows={rows}
      value={draft}
      placeholder={placeholder}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
};

interface MomentInspectorProps {
  clipId: string;
}

export const MomentInspector: React.FC<MomentInspectorProps> = ({ clipId }) => {
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const setClipMetadata = useProjectStore((state) => state.setClipMetadata);
  const moveClip = useProjectStore((state) => state.moveClip);
  const trimClip = useProjectStore((state) => state.trimClip);

  const clip = useMemo(
    () => tracks.flatMap((t) => t.clips).find((c) => c.id === clipId),
    [tracks, clipId],
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  useEffect(() => {
    setStartError(null);
    setEndError(null);
  }, [clipId]);
  const moment = useMemo(() => getMoment(clip), [clip]);

  /** Keys used by every other moment in the project, for duplicate warnings. */
  const otherKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const track of tracks) {
      if (track.type !== "moments") continue;
      for (const other of track.clips) {
        if (other.id === clipId) continue;
        const m = getMoment(other);
        if (m?.key) keys.add(m.key);
      }
    }
    return keys;
  }, [tracks, clipId]);

  const commitMoment = useCallback(
    (next: Moment) => {
      void setClipMetadata(clipId, { moment: next });
    },
    [clipId, setClipMetadata],
  );

  const patch = useCallback(
    (fields: Partial<Moment>) => {
      if (!moment) return;
      commitMoment({ ...moment, ...fields } as Moment);
    },
    [moment, commitMoment],
  );

  const handleKindChange = useCallback(
    (kind: MomentKind) => {
      if (!moment || kind === moment.kind) return;
      commitMoment(createMoment(kind, { label: moment.label, key: moment.key }));
    },
    [moment, commitMoment],
  );

  const handleStartChange = useCallback(
    (value: number) => {
      if (!clip) return;
      const start = Math.max(0, value);
      if (Math.abs(start - clip.startTime) < 1e-6) return;
      void moveClip(clipId, start).then((result) => {
        setStartError(
          result.success
            ? null
            : getMomentRuleMessage(result) ?? result.error?.message ?? "Rejected",
        );
      });
    },
    [clip, clipId, moveClip],
  );

  const handleEndChange = useCallback(
    (value: number) => {
      if (!clip) return;
      const duration = Math.max(MIN_MOMENT_DURATION, value - clip.startTime);
      if (Math.abs(duration - clip.duration) < 1e-6) return;
      // clip/trim with only outPoint keeps startTime fixed and recomputes
      // duration = outPoint - inPoint (inPoint is 0 for moments).
      void trimClip(clipId, undefined, clip.inPoint + duration).then((result) => {
        setEndError(
          result.success
            ? null
            : getMomentRuleMessage(result) ?? result.error?.message ?? "Rejected",
        );
      });
    },
    [clip, clipId, trimClip],
  );

  if (!clip || !moment) {
    return (
      <Text type="supporting" color="muted" className="block text-[11px]">
        This clip has no moment payload.
      </Text>
    );
  }

  const keyTrimmed = moment.key.trim();
  const keyWarning = !keyTrimmed
    ? "Key is required; it identifies this moment in the export."
    : otherKeys.has(moment.key)
      ? "Another moment already uses this key."
      : null;

  // Switching to or from "catalogue" would change lanes, so the select only
  // offers same-lane kinds and is locked for catalogue moments.
  const isCatalogue = moment.kind === "catalogue";
  const kindOptions = MOMENT_KINDS.filter((kind) =>
    isCatalogue ? kind === "catalogue" : kind !== "catalogue",
  ).map((kind) => ({
    value: kind,
    label: MOMENT_KIND_LABELS[kind],
  }));

  return (
    <div className="-mx-5 -mt-[18px]">
      <InspectorClipHeader
        name={moment.label || MOMENT_KIND_LABELS[moment.kind]}
        durationSeconds={clip.duration}
        typeLabel="moment"
      />
      <div className="space-y-4 px-5 pt-4">
        <InspectorSection title="Moment" sectionId="moment-general" defaultOpen>
          <div className="space-y-3">
            <div className="space-y-1">
              <Selector
                label="Kind"
                size="sm"
                width="100%"
                value={moment.kind}
                options={kindOptions}
                isDisabled={isCatalogue}
                onChange={handleKindChange}
              />
              {isCatalogue && (
                <Text type="supporting" color="muted" className="block text-[10px]">
                  Catalogues have their own track; add a Quiz, Promotion or
                  Product from the Moments panel instead.
                </Text>
              )}
            </div>
            <CommittedTextInput
              label="Label"
              value={moment.label}
              placeholder={MOMENT_KIND_LABELS[moment.kind]}
              onCommit={(label) => patch({ label })}
            />
            <div className="space-y-1">
              <CommittedTextInput
                label="Key"
                mono
                value={moment.key}
                placeholder="unique-key"
                onCommit={(key) => patch({ key: key.trim() })}
              />
              {keyWarning && (
                <Text type="supporting" color="danger" className="block text-[10px]">
                  {keyWarning}
                </Text>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <ToolcraftNumberInputControl
                  key={`start-${clip.startTime}`}
                  label="Start"
                  size="sm"
                  width="100%"
                  value={Number(clip.startTime.toFixed(3))}
                  min={0}
                  step={0.1}
                  unit="s"
                  onChange={handleStartChange}
                />
                {startError && (
                  <Text type="supporting" color="danger" className="block text-[10px]">
                    {startError}
                  </Text>
                )}
              </div>
              <div className="space-y-1">
                <ToolcraftNumberInputControl
                  key={`end-${clip.startTime}-${clip.duration}`}
                  label="End"
                  size="sm"
                  width="100%"
                  value={Number((clip.startTime + clip.duration).toFixed(3))}
                  min={clip.startTime + MIN_MOMENT_DURATION}
                  step={0.1}
                  unit="s"
                  onChange={handleEndChange}
                />
                {endError && (
                  <Text type="supporting" color="danger" className="block text-[10px]">
                    {endError}
                  </Text>
                )}
              </div>
            </div>
          </div>
        </InspectorSection>

        {moment.kind === "quiz" && (
          <QuizFields moment={moment} onChange={commitMoment} />
        )}
        {moment.kind === "promotion" && (
          <PromotionFields moment={moment} onChange={commitMoment} />
        )}
        {moment.kind === "product" && (
          <ProductFields moment={moment} onChange={commitMoment} />
        )}
        {moment.kind === "catalogue" && (
          <CatalogueFields moment={moment} onChange={commitMoment} />
        )}
      </div>
    </div>
  );
};

const QuizFields: React.FC<{
  moment: QuizMoment;
  onChange: (next: Moment) => void;
}> = ({ moment, onChange }) => {
  const update = (fields: Partial<QuizMoment>) =>
    onChange({ ...moment, ...fields });

  const setOptions = (options: QuizMoment["options"]) => update({ options });

  return (
    <InspectorSection title="Quiz" sectionId="moment-quiz" defaultOpen>
      <div className="space-y-3">
        <CommittedTextArea
          label="Question"
          value={moment.question}
          placeholder="What does the viewer need to answer?"
          onCommit={(question) => update({ question })}
        />
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Text type="label" color="secondary" className="text-[11px]">
              Options
            </Text>
            <Button
              label="Add option"
              icon={<Plus size={12} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={() => setOptions([...moment.options, createQuizOption()])}
            />
          </div>
          {moment.options.length === 0 && (
            <Text type="supporting" color="muted" className="block text-[10px]">
              Add at least two options and mark the correct one.
            </Text>
          )}
          {moment.options.map((option, index) => (
            <div key={option.id} className="flex items-center gap-2">
              <input
                type="radio"
                name={`moment-correct-${moment.key}`}
                aria-label={`Option ${index + 1} is correct`}
                title="Correct answer"
                className="h-3.5 w-3.5 shrink-0 accent-accent"
                checked={option.correct}
                onChange={() =>
                  setOptions(
                    moment.options.map((o) => ({
                      ...o,
                      correct: o.id === option.id,
                    })),
                  )
                }
              />
              <div className="min-w-0 flex-1">
                <CommittedTextInput
                  label={`Option ${index + 1}`}
                  value={option.text}
                  placeholder={`Option ${index + 1}`}
                  onCommit={(text) =>
                    setOptions(
                      moment.options.map((o) =>
                        o.id === option.id ? { ...o, text } : o,
                      ),
                    )
                  }
                />
              </div>
              <IconButton
                label={`Remove option ${index + 1}`}
                icon={<Trash2 size={12} aria-hidden />}
                variant="ghost"
                size="sm"
                className="mt-4 shrink-0"
                onClick={() =>
                  setOptions(moment.options.filter((o) => o.id !== option.id))
                }
              />
            </div>
          ))}
        </div>
        <CommittedTextArea
          label="Explanation (optional)"
          value={moment.explanation ?? ""}
          placeholder="Shown after the viewer answers."
          rows={2}
          onCommit={(explanation) =>
            update({ explanation: explanation || undefined })
          }
        />
      </div>
    </InspectorSection>
  );
};

const PromotionFields: React.FC<{
  moment: PromotionMoment;
  onChange: (next: Moment) => void;
}> = ({ moment, onChange }) => {
  const update = (fields: Partial<PromotionMoment>) =>
    onChange({ ...moment, ...fields });
  return (
    <InspectorSection title="Promotion" sectionId="moment-promotion" defaultOpen>
      <div className="space-y-3">
        <CommittedTextInput
          label="Title"
          value={moment.title}
          onCommit={(title) => update({ title })}
        />
        <CommittedTextArea
          label="Description"
          value={moment.description}
          onCommit={(description) => update({ description })}
        />
        <CommittedTextInput
          label="CTA label"
          value={moment.cta_label}
          placeholder="Shop now"
          onCommit={(cta_label) => update({ cta_label })}
        />
        <CommittedTextInput
          label="URL"
          type="url"
          value={moment.url}
          placeholder="https://"
          onCommit={(url) => update({ url })}
        />
        <CommittedTextInput
          label="Promo code (optional)"
          mono
          value={moment.code ?? ""}
          onCommit={(code) => update({ code: code || undefined })}
        />
      </div>
    </InspectorSection>
  );
};

const ProductFields: React.FC<{
  moment: ProductMoment;
  onChange: (next: Moment) => void;
}> = ({ moment, onChange }) => {
  const update = (fields: Partial<ProductMoment>) =>
    onChange({ ...moment, ...fields });
  return (
    <InspectorSection title="Product" sectionId="moment-product" defaultOpen>
      <div className="space-y-3">
        <CommittedTextInput
          label="Name"
          value={moment.name}
          onCommit={(name) => update({ name })}
        />
        <CommittedTextInput
          label="Product ID"
          mono
          value={moment.product_id}
          onCommit={(product_id) => update({ product_id })}
        />
        <div className="grid grid-cols-2 gap-2">
          <ToolcraftNumberInputControl
            label="Price"
            size="sm"
            width="100%"
            value={Number.isFinite(moment.price) ? moment.price : 0}
            min={0}
            step={0.01}
            onChange={(price) => update({ price: Math.max(0, price) })}
          />
          <CommittedTextInput
            label="Currency"
            mono
            value={moment.currency}
            placeholder="ZAR"
            onCommit={(currency) =>
              update({ currency: currency.trim().toUpperCase() })
            }
          />
        </div>
        <CommittedTextInput
          label="URL"
          type="url"
          value={moment.url}
          placeholder="https://"
          onCommit={(url) => update({ url })}
        />
        <CommittedTextInput
          label="Image URL (optional)"
          type="url"
          value={moment.image_url ?? ""}
          placeholder="https://"
          onCommit={(image_url) => update({ image_url: image_url || undefined })}
        />
        <CommittedTextArea
          label="Description (optional)"
          value={moment.description ?? ""}
          rows={2}
          onCommit={(description) =>
            update({ description: description || undefined })
          }
        />
      </div>
    </InspectorSection>
  );
};

const CatalogueFields: React.FC<{
  moment: CatalogueMoment;
  onChange: (next: Moment) => void;
}> = ({ moment, onChange }) => {
  const update = (fields: Partial<CatalogueMoment>) =>
    onChange({ ...moment, ...fields });
  const setProducts = (products: CatalogueMoment["products"]) =>
    update({ products });
  const patchProduct = (
    id: string,
    fields: Partial<CatalogueMoment["products"][number]>,
  ) =>
    setProducts(
      moment.products.map((p) => (p.id === id ? { ...p, ...fields } : p)),
    );

  return (
    <InspectorSection title="Catalogue" sectionId="moment-catalogue" defaultOpen>
      <div className="space-y-3">
        <CommittedTextInput
          label="Title"
          value={moment.title}
          placeholder="Featured products"
          onCommit={(title) => update({ title })}
        />
        <div className="flex items-center justify-between">
          <Text type="label" color="secondary" className="text-[11px]">
            Products
          </Text>
          <Button
            label="Add product"
            icon={<Plus size={12} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() =>
              setProducts([...moment.products, createCatalogueProduct()])
            }
          />
        </div>
        {moment.products.length === 0 && (
          <Text type="supporting" color="muted" className="block text-[10px]">
            Add at least one product to the catalogue.
          </Text>
        )}
        {moment.products.map((product, index) => (
          <div
            key={product.id}
            className="space-y-2 rounded-md border border-border bg-bg-2/40 p-2"
          >
            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary" className="text-[10px]">
                Product {index + 1}
              </Text>
              <IconButton
                label={`Remove product ${index + 1}`}
                icon={<Trash2 size={12} aria-hidden />}
                variant="ghost"
                size="sm"
                onClick={() =>
                  setProducts(moment.products.filter((p) => p.id !== product.id))
                }
              />
            </div>
            <CommittedTextInput
              label="Name"
              value={product.name}
              onCommit={(name) => patchProduct(product.id, { name })}
            />
            <CommittedTextInput
              label="Product ID"
              mono
              value={product.product_id}
              onCommit={(product_id) => patchProduct(product.id, { product_id })}
            />
            <div className="grid grid-cols-2 gap-2">
              <ToolcraftNumberInputControl
                label="Price"
                size="sm"
                width="100%"
                value={Number.isFinite(product.price) ? product.price : 0}
                min={0}
                step={0.01}
                onChange={(price) =>
                  patchProduct(product.id, { price: Math.max(0, price) })
                }
              />
              <CommittedTextInput
                label="Currency"
                mono
                value={product.currency}
                placeholder="ZAR"
                onCommit={(currency) =>
                  patchProduct(product.id, {
                    currency: currency.trim().toUpperCase(),
                  })
                }
              />
            </div>
            <CommittedTextInput
              label="URL"
              type="url"
              value={product.url}
              placeholder="https://"
              onCommit={(url) => patchProduct(product.id, { url })}
            />
            <CommittedTextInput
              label="Image URL (optional)"
              type="url"
              value={product.image_url ?? ""}
              placeholder="https://"
              onCommit={(image_url) =>
                patchProduct(product.id, { image_url: image_url || undefined })
              }
            />
          </div>
        ))}
      </div>
    </InspectorSection>
  );
};

export default MomentInspector;
