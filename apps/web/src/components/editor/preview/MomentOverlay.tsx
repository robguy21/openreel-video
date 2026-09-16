import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  CatalogueMoment,
  Moment,
  MomentKind,
  ProductMoment,
  PromotionMoment,
  QuizMoment,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { getActiveMoments } from "./active-moments";

/**
 * Preview-only mock of the viewer's player UI for the moment under the
 * playhead. It is a DOM layer over the preview canvas: nothing here touches the
 * video engine frame or the export path.
 */

const KIND_BADGE: Record<MomentKind, string> = {
  quiz: "QUIZ",
  promotion: "PROMO",
  product: "PRODUCT",
  catalogue: "CATALOGUE",
};

const KIND_TINT: Record<MomentKind, string> = {
  quiz: "rgba(139, 92, 246, 0.85)",
  promotion: "rgba(236, 72, 153, 0.85)",
  product: "rgba(249, 115, 22, 0.85)",
  catalogue: "rgba(20, 184, 166, 0.85)",
};

/** Overlay box matching the letterboxed frame inside the canvas element. */
interface FrameBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function computeFrameBox(
  canvas: HTMLCanvasElement,
  projectWidth: number,
  projectHeight: number,
): FrameBox | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const canvasAspect = projectWidth / projectHeight;
  const elementAspect = rect.width / rect.height;
  let width = rect.width;
  let height = rect.height;
  let left = 0;
  let top = 0;
  if (elementAspect > canvasAspect) {
    height = rect.height;
    width = height * canvasAspect;
    left = (rect.width - width) / 2;
  } else {
    width = rect.width;
    height = width / canvasAspect;
    top = (rect.height - height) / 2;
  }
  return { left: canvas.offsetLeft + left, top: canvas.offsetTop + top, width, height };
}

function formatPrice(price: number, currency: string): string {
  const amount = Number.isFinite(price) ? price : 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "ZAR",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency ? `${currency.toUpperCase()} ` : ""}${amount.toFixed(2)}`;
  }
}

const Placeholder: React.FC<{ text: string }> = ({ text }) => (
  <span className="italic opacity-60">{text}</span>
);

const Caption: React.FC<{ moment: Moment }> = ({ moment }) => (
  <div
    className="flex items-center gap-[0.5em] text-[0.55em] leading-none text-white/60"
    data-testid="moment-overlay-caption"
  >
    <span
      className="rounded-[0.3em] px-[0.5em] py-[0.25em] font-bold uppercase tracking-wider text-white"
      style={{ background: KIND_TINT[moment.kind] }}
    >
      {KIND_BADGE[moment.kind]}
    </span>
    <span className="truncate font-semibold text-white/80">
      {moment.label || <Placeholder text="Label…" />}
    </span>
    <span className="truncate font-mono">{moment.key}</span>
  </div>
);

const glass =
  "border border-white/15 bg-black/55 shadow-[0_0.4em_2em_rgba(0,0,0,0.45)] backdrop-blur-md text-white";

const PromotionBar: React.FC<{ moment: PromotionMoment }> = ({ moment }) => (
  <motion.div
    key="promotion"
    data-testid="moment-overlay-promotion"
    initial={{ y: "120%", opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    exit={{ y: "120%", opacity: 0 }}
    transition={{ duration: 0.25, ease: "easeOut" }}
    className={`absolute inset-x-[3%] bottom-[3%] flex h-[18%] items-center gap-[1.2em] rounded-[0.8em] px-[1.4em] py-[0.8em] ${glass}`}
  >
    <div className="flex min-w-0 flex-1 flex-col gap-[0.35em]">
      <Caption moment={moment} />
      <div className="truncate text-[1.15em] font-bold leading-tight">
        {moment.title || <Placeholder text="Title…" />}
      </div>
      <div className="truncate text-[0.8em] leading-tight text-white/80">
        {moment.description || <Placeholder text="Description…" />}
      </div>
    </div>
    {moment.code ? (
      <div className="shrink-0 rounded-[0.5em] border-[0.12em] border-dashed border-white/70 px-[0.8em] py-[0.4em] font-mono text-[0.85em] font-semibold tracking-widest">
        {moment.code}
      </div>
    ) : null}
    <div className="shrink-0 rounded-full bg-white px-[1.2em] py-[0.5em] text-[0.85em] font-bold text-black">
      {moment.cta_label || "Learn more"}
    </div>
  </motion.div>
);

const ProductCard: React.FC<{ moment: ProductMoment }> = ({ moment }) => (
  <motion.div
    key="product"
    data-testid="moment-overlay-product"
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.9 }}
    transition={{ duration: 0.25, ease: "easeOut" }}
    className={`absolute bottom-[4%] right-[3%] flex w-[30%] flex-col gap-[0.6em] rounded-[0.8em] p-[0.9em] ${glass}`}
  >
    <Caption moment={moment} />
    <div className="flex gap-[0.8em]">
      <div className="h-[4.5em] w-[4.5em] shrink-0 overflow-hidden rounded-[0.5em] bg-white/10">
        {moment.image_url ? (
          <img
            src={moment.image_url}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.04))]" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[0.3em]">
        <div className="truncate text-[1em] font-bold leading-tight">
          {moment.name || <Placeholder text="Product name…" />}
        </div>
        <div className="text-[0.95em] font-semibold text-white/90">
          {formatPrice(moment.price, moment.currency)}
        </div>
        {moment.description ? (
          <div className="truncate text-[0.7em] text-white/70">{moment.description}</div>
        ) : null}
      </div>
    </div>
    <div className="rounded-full bg-white py-[0.45em] text-center text-[0.8em] font-bold text-black">
      View
    </div>
  </motion.div>
);

const QuizCard: React.FC<{ moment: QuizMoment }> = ({ moment }) => (
  <motion.div
    key="quiz"
    data-testid="moment-overlay-quiz"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.25, ease: "easeOut" }}
    className={`absolute left-1/2 top-1/2 flex w-[60%] -translate-x-1/2 -translate-y-1/2 flex-col gap-[0.8em] rounded-[1em] p-[1.2em] ${glass}`}
  >
    <Caption moment={moment} />
    <div className="text-[1.2em] font-bold leading-snug">
      {moment.question || <Placeholder text="Question…" />}
    </div>
    <div className="grid grid-cols-2 gap-[0.6em]">
      {(moment.options.length > 0
        ? moment.options
        : [{ id: "a", text: "" }, { id: "b", text: "" }]
      ).map((option, index) => (
        <div
          key={option.id}
          className="truncate rounded-full border border-white/25 bg-white/10 px-[1em] py-[0.5em] text-center text-[0.85em] font-semibold"
        >
          {option.text || <Placeholder text={`Option ${index + 1}…`} />}
        </div>
      ))}
    </div>
  </motion.div>
);

const CatalogueStrip: React.FC<{
  moment: CatalogueMoment;
  /** Lift the strip above the promotion bar when both are live. */
  abovePromotion: boolean;
}> = ({ moment, abovePromotion }) => (
  <motion.div
    data-testid="moment-overlay-catalogue"
    initial={{ y: "120%", opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    exit={{ y: "120%", opacity: 0 }}
    transition={{ duration: 0.25, ease: "easeOut" }}
    className={`absolute inset-x-[3%] flex items-stretch gap-[1em] rounded-[0.8em] px-[1.2em] py-[0.8em] ${glass}`}
    style={{ bottom: abovePromotion ? "24%" : "3%" }}
  >
    <div className="flex w-[22%] shrink-0 flex-col justify-center gap-[0.4em]">
      <Caption moment={moment} />
      <div className="line-clamp-2 text-[1em] font-bold leading-tight">
        {moment.title || <Placeholder text="Title…" />}
      </div>
    </div>
    <div className="flex min-w-0 flex-1 gap-[0.7em] overflow-hidden">
      {(moment.products.length > 0
        ? moment.products
        : [createPlaceholderProduct("a"), createPlaceholderProduct("b")]
      ).map((product, index) => (
        <div
          key={product.id}
          className="flex w-[7.5em] shrink-0 flex-col gap-[0.35em] rounded-[0.5em] bg-white/10 p-[0.5em]"
        >
          <div className="h-[3.6em] w-full overflow-hidden rounded-[0.35em] bg-white/10">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="h-full w-full bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.04))]" />
            )}
          </div>
          <div className="truncate text-[0.7em] font-semibold leading-tight">
            {product.name || <Placeholder text={`Product ${index + 1}…`} />}
          </div>
          <div className="text-[0.65em] text-white/80">
            {formatPrice(product.price, product.currency)}
          </div>
        </div>
      ))}
    </div>
  </motion.div>
);

function createPlaceholderProduct(id: string): CatalogueMoment["products"][number] {
  return { id, name: "", product_id: "", price: 0, currency: "ZAR", url: "" };
}

export interface MomentOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  projectWidth: number;
  projectHeight: number;
  /** Overrides the playhead (tests). */
  currentTime?: number;
}

export const MomentOverlay: React.FC<MomentOverlayProps> = ({
  canvasRef,
  projectWidth,
  projectHeight,
  currentTime,
}) => {
  const enabled = useUIStore((state) => state.showMomentOverlays);
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const time = currentTime ?? playhead;
  const [box, setBox] = useState<FrameBox | null>(null);

  // Track the letterboxed frame rect inside the canvas element so the overlay
  // hugs the rendered picture, not the whole player area.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const update = () =>
      setBox(computeFrameBox(canvas, projectWidth, projectHeight));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, projectWidth, projectHeight]);

  const active = useMemo(
    () => (enabled ? getActiveMoments(tracks, time) : []),
    [enabled, tracks, time],
  );

  // Typography and spacing scale with the frame: 1em = 2.2% of the frame width,
  // so a 480p and a 1080p project look proportionally identical.
  const scaleWidth = box?.width ?? projectWidth;
  const fontSize = Math.max(6, scaleWidth * 0.022);
  const style: React.CSSProperties = box
    ? { left: box.left, top: box.top, width: box.width, height: box.height, fontSize }
    : { inset: 0, fontSize };

  return (
    <div
      aria-label="Moment overlays"
      data-testid="moment-overlay"
      className="pointer-events-none absolute z-20 overflow-hidden"
      style={style}
    >
      <AnimatePresence>
        {active.map(({ clip, moment }) =>
          moment.kind === "promotion" ? (
            <PromotionBar key={clip.id} moment={moment} />
          ) : moment.kind === "product" ? (
            <ProductCard key={clip.id} moment={moment} />
          ) : moment.kind === "catalogue" ? (
            <CatalogueStrip
              key={clip.id}
              moment={moment}
              abovePromotion={active.some(
                (entry) => entry.moment.kind === "promotion",
              )}
            />
          ) : (
            <QuizCard key={clip.id} moment={moment} />
          ),
        )}
      </AnimatePresence>
    </div>
  );
};

export default MomentOverlay;
