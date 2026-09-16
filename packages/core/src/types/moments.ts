/**
 * OneLink Moments — timed metadata events that live on a "moments" track.
 *
 * A moment is a normal timeline Clip whose mediaId starts with
 * MOMENT_MEDIA_PREFIX and whose payload lives in clip.metadata.moment. Moments
 * carry no media and never affect playback preview or export; they are
 * exported alongside the render as metadata.
 */
import type { Clip } from "./timeline";

export type MomentKind = "quiz" | "promotion" | "product" | "catalogue";

export interface QuizOption {
  id: string;
  text: string;
  correct: boolean;
}

export interface MomentBase {
  kind: MomentKind;
  label: string;
  key: string;
}

export interface QuizMoment extends MomentBase {
  kind: "quiz";
  question: string;
  options: QuizOption[];
  explanation?: string;
}

export interface PromotionMoment extends MomentBase {
  kind: "promotion";
  title: string;
  description: string;
  cta_label: string;
  url: string;
  code?: string;
}

export interface ProductMoment extends MomentBase {
  kind: "product";
  name: string;
  product_id: string;
  price: number;
  currency: string;
  url: string;
  image_url?: string;
  description?: string;
}

export interface CatalogueProduct {
  id: string;
  name: string;
  product_id: string;
  price: number;
  currency: string;
  url: string;
  image_url?: string;
}

export interface CatalogueMoment extends MomentBase {
  kind: "catalogue";
  title: string;
  products: CatalogueProduct[];
}

export type Moment =
  | QuizMoment
  | PromotionMoment
  | ProductMoment
  | CatalogueMoment;

export const MOMENT_KINDS: MomentKind[] = [
  "quiz",
  "promotion",
  "product",
  "catalogue",
];

/**
 * Which "moments" lane a kind lives on. Catalogues get their own lane so they
 * may coincide in time with a quiz, promotion or product.
 */
export type MomentLaneRole = "general" | "catalogue";

export function momentTrackRole(kind: MomentKind): MomentLaneRole {
  return kind === "catalogue" ? "catalogue" : "general";
}

/** Lane of a moments track; an unset role means the general lane. */
export function momentLaneRole(
  track: { readonly role?: string } | null | undefined,
): MomentLaneRole {
  return track?.role === "catalogue" ? "catalogue" : "general";
}

export const MOMENT_LANE_NAMES: Record<MomentLaneRole, string> = {
  general: "Moments",
  catalogue: "Catalogue",
};

export const MOMENT_MEDIA_PREFIX = "moment-";

export const MOMENT_KIND_LABELS: Record<MomentKind, string> = {
  quiz: "Quiz",
  promotion: "Promotion",
  product: "Product",
  catalogue: "Catalogue",
};

function randomSuffix(length = 4): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${randomSuffix(8)}`;
}

/** Lower-case, dash-separated version of a label suitable for a moment key. */
export function slugifyMomentLabel(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createQuizOption(
  overrides: Partial<QuizOption> = {},
): QuizOption {
  return { id: randomId(), text: "", correct: false, ...overrides };
}

export function createCatalogueProduct(
  overrides: Partial<CatalogueProduct> = {},
): CatalogueProduct {
  return {
    id: randomId(),
    name: "",
    product_id: "",
    price: 0,
    currency: "ZAR",
    url: "",
    ...overrides,
  };
}

type MomentOverrides = Partial<
  Omit<QuizMoment, "kind"> &
    Omit<PromotionMoment, "kind"> &
    Omit<ProductMoment, "kind"> &
    Omit<CatalogueMoment, "kind">
>;

/**
 * Build a moment of the given kind with sensible defaults. `overrides` may
 * carry label/key (preserved when switching kinds) plus any kind-specific
 * fields.
 */
export function createMoment(
  kind: MomentKind,
  overrides: MomentOverrides = {},
): Moment {
  const label = overrides.label ?? MOMENT_KIND_LABELS[kind];
  const key =
    overrides.key ?? `${slugifyMomentLabel(label) || kind}-${randomSuffix()}`;

  switch (kind) {
    case "quiz":
      return {
        kind: "quiz",
        label,
        key,
        question: overrides.question ?? "",
        options: overrides.options ?? [createQuizOption(), createQuizOption()],
        ...(overrides.explanation !== undefined
          ? { explanation: overrides.explanation }
          : {}),
      };
    case "promotion":
      return {
        kind: "promotion",
        label,
        key,
        title: overrides.title ?? "",
        description: overrides.description ?? "",
        cta_label: overrides.cta_label ?? "",
        url: overrides.url ?? "",
        ...(overrides.code !== undefined ? { code: overrides.code } : {}),
      };
    case "product":
      return {
        kind: "product",
        label,
        key,
        name: overrides.name ?? "",
        product_id: overrides.product_id ?? "",
        price: overrides.price ?? 0,
        currency: overrides.currency ?? "ZAR",
        url: overrides.url ?? "",
        ...(overrides.image_url !== undefined
          ? { image_url: overrides.image_url }
          : {}),
        ...(overrides.description !== undefined
          ? { description: overrides.description }
          : {}),
      };
    case "catalogue":
      return {
        kind: "catalogue",
        label,
        key,
        title: overrides.title ?? "",
        products: overrides.products ?? [
          createCatalogueProduct(),
          createCatalogueProduct(),
        ],
      };
  }
}

/** Kind of the moment carried by a clip-like value, or null. */
export function getMomentKind(
  clip: Pick<Clip, "mediaId" | "metadata"> | null | undefined,
): MomentKind | null {
  return getMoment(clip)?.kind ?? null;
}

export function isMomentMediaId(mediaId: string | undefined): boolean {
  return typeof mediaId === "string" && mediaId.startsWith(MOMENT_MEDIA_PREFIX);
}

export function isMomentClip(
  clip: Pick<Clip, "mediaId"> | null | undefined,
): boolean {
  return Boolean(clip && isMomentMediaId(clip.mediaId));
}

export function getMoment(
  clip: Pick<Clip, "mediaId" | "metadata"> | null | undefined,
): Moment | null {
  if (!clip || !isMomentMediaId(clip.mediaId)) return null;
  const moment = clip.metadata?.moment;
  if (!moment || typeof moment !== "object") return null;
  const kind = (moment as { kind?: unknown }).kind;
  if (
    kind !== "quiz" &&
    kind !== "promotion" &&
    kind !== "product" &&
    kind !== "catalogue"
  ) {
    return null;
  }
  return moment as Moment;
}

/** User-facing messages for the Moments track rules (shared by validator and UI). */
export const MOMENT_RULE_MESSAGES = {
  ONLY_ONE_TRACK: "Only one Moments track per project",
  ONLY_ONE_CATALOGUE_TRACK: "Only one Catalogue track per project",
  OWN_TRACK: "Catalogues have their own track",
  NO_OVERLAP: "Moments can't overlap",
  ONLY_MOMENTS: "Only moments can go on the Moments track",
  STAY_ON_TRACK: "Moments stay on the Moments track",
} as const;

const MOMENT_OVERLAP_EPSILON = 0.0001;

export interface MomentInterval {
  readonly id?: string;
  readonly startTime: number;
  readonly duration: number;
}

export function momentIntervalsOverlap(
  a: MomentInterval,
  b: MomentInterval,
): boolean {
  return (
    a.startTime < b.startTime + b.duration - MOMENT_OVERLAP_EPSILON &&
    b.startTime < a.startTime + a.duration - MOMENT_OVERLAP_EPSILON
  );
}

/**
 * First clip in `clips` whose interval intersects `candidate` (ignoring the
 * clip with the candidate's own id), or null when the slot is free.
 */
export function findMomentOverlap<T extends MomentInterval>(
  clips: readonly T[],
  candidate: MomentInterval,
): T | null {
  for (const clip of clips) {
    if (candidate.id !== undefined && clip.id === candidate.id) continue;
    if (momentIntervalsOverlap(clip, candidate)) return clip;
  }
  return null;
}

/** True when any two clips in the list intersect. */
export function momentsOverlap(clips: readonly MomentInterval[]): boolean {
  for (let i = 0; i < clips.length; i++) {
    for (let j = i + 1; j < clips.length; j++) {
      if (momentIntervalsOverlap(clips[i], clips[j])) return true;
    }
  }
  return false;
}
