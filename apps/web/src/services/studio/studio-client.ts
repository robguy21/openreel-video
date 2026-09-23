/**
 * HTTP client for Clip Studio (the FastAPI app that serves this editor under /edit).
 *
 * Same origin in production, so every URL is relative; VITE_STUDIO_API overrides the
 * prefix for `vite dev` against a studio on another port.
 */

export const STUDIO_API: string =
  (import.meta.env.VITE_STUDIO_API as string | undefined) ?? "/api";

/**
 * Which cut of a studio project this editor is working on. A film is parts, each with its
 * own saved edit and its own export, and every `/editor/*` route takes `?part=<id>`.
 * `part` null means "say nothing", which the studio reads as Part 1 - so this bundle
 * still works against a studio from before parts, and against the old app's Edit stage.
 */
export interface StudioRef {
  pid: string;
  part: string | null;
}

/** `/api/projects/<pid>/<path>`, with `?part=` when there is one. `path` may carry its own query. */
export function projectUrl(ref: StudioRef, path: string): string {
  const base = `${STUDIO_API}/projects/${encodeURIComponent(ref.pid)}/${path}`;
  if (!ref.part) return base;
  return `${base}${base.includes("?") ? "&" : "?"}part=${encodeURIComponent(ref.part)}`;
}

/**
 * Headers every call that changes something sends. With sign-in on, the studio refuses a
 * POST/PUT/PATCH/DELETE without `X-Clip-Studio-App: 1` (studio/server/auth.py); a
 * same-origin fetch is let through on the editor routes without it, but only because older
 * bundles could not send it, and it is the header that works from another origin too.
 */
export const MUTATING_HEADERS: Readonly<Record<string, string>> = { "X-Clip-Studio-App": "1" };

/** `fetch`'s second argument. */
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

/** The sign-in cookie goes with every call - also when VITE_STUDIO_API points elsewhere. */
const CREDENTIALS = "include" as const;

export interface StudioMediaRef {
  asset: string;
  url: string;
  duration_s: number;
  bytes: number;
}

export interface StudioShot {
  id: string;
  /** Position in the whole film's render order (not within the part). */
  order: number;
  /** [part, scene, shot], each 1-based: scenes counted within the part, shots within the
   *  scene. Absent from a studio that predates parts, null for a shot with no place. */
  number?: [number, number, number] | null;
  summary: string;
  length_frames: number | null;
  line: { kind?: string; text?: string; subject_id?: string };
  take_id: string | null;
  video: StudioMediaRef | null;
  narration: (Partial<StudioMediaRef> & { text: string; stale: boolean }) | null;
  include_vo: boolean;
  gap_s: number;
  crossfade_s: number;
  location_ref: string | null;
}

export interface StudioManifest {
  project: {
    id: string;
    name: string;
    /** The part this manifest is for. Absent from a studio that predates parts. */
    part?: {
      id: string;
      name: string;
      /** 1-based position of the part in the film. */
      number: number | null;
      /** "Part 2" or "Part 2 · The chase" - the studio's own way of saying it. */
      label?: string | null;
    };
  };
  fps: number;
  shots: StudioShot[];
  stitch_export: StudioMediaRef | null;
  editor_export: StudioMediaRef | null;
  editor_saved: boolean;
  editor_ts: number | null;
  generated: number;
}

export interface StudioJob {
  id: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  progress: number;
  message: string;
  error: string | null;
}

/** Media bookkeeping saved alongside the editor project: which studio asset each media
 *  item came from, so a fresh browser can re-download it. */
export interface StudioMediaMap {
  [mediaId: string]: { url: string; asset: string; name: string; type: "video" | "audio" | "image" };
}

export interface StudioSavedDoc {
  version: string;
  project: unknown;
  metadata?: unknown;
  studio: {
    pid: string;
    /** The part this edit belongs to; absent in edits saved before parts (Part 1). */
    part?: string;
    media: StudioMediaMap;
    savedAt: number;
    app: "openreel";
  };
  [key: string]: unknown;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* not json */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

export async function fetchManifest(ref: StudioRef): Promise<StudioManifest> {
  return json(
    await fetch(projectUrl(ref, "editor/manifest"), { cache: "no-store", credentials: CREDENTIALS }),
  );
}

export async function prepareNarration(
  ref: StudioRef,
): Promise<{ queued: boolean; missing: number; job?: StudioJob }> {
  return json(
    await fetch(projectUrl(ref, "editor/prepare"), {
      method: "POST",
      headers: { ...MUTATING_HEADERS },
      credentials: CREDENTIALS,
    }),
  );
}

export async function pollJob(
  pid: string,
  jobId: string,
  onTick?: (job: StudioJob) => void,
  intervalMs = 1500,
): Promise<StudioJob> {
  for (;;) {
    const snap = await json<{ jobs: StudioJob[]; current: StudioJob | null }>(
      await fetch(`${STUDIO_API}/jobs?project_id=${encodeURIComponent(pid)}`, {
        cache: "no-store",
        credentials: CREDENTIALS,
      }),
    );
    const job =
      snap.current?.id === jobId ? snap.current : snap.jobs.find((j) => j.id === jobId);
    if (job) {
      onTick?.(job);
      if (job.status === "done") return job;
      if (job.status === "error" || job.status === "cancelled") {
        throw new Error(job.error || `narration job ${job.status}`);
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function fetchSavedDoc(ref: StudioRef): Promise<StudioSavedDoc | null> {
  const res = await fetch(projectUrl(ref, "editor/doc"), {
    cache: "no-store",
    credentials: CREDENTIALS,
  });
  if (res.status === 404) return null;
  return json(res);
}

/** The request that saves the edit; `keepalive` for the one sent as the tab closes. */
export function putSavedDocRequest(
  ref: StudioRef,
  doc: StudioSavedDoc,
  keepalive = false,
): [string, FetchInit] {
  return [
    projectUrl(ref, "editor/doc"),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...MUTATING_HEADERS },
      credentials: CREDENTIALS,
      body: JSON.stringify(doc),
      keepalive,
    },
  ];
}

export async function putSavedDoc(ref: StudioRef, doc: StudioSavedDoc): Promise<{ ts: number }> {
  return json(await fetch(...putSavedDocRequest(ref, doc)));
}

export async function fetchMediaBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { cache: "force-cache", credentials: CREDENTIALS });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.blob();
}

export async function uploadExport(
  ref: StudioRef,
  blob: Blob,
  name: string,
  ext: string,
): Promise<{ export: string; url: string; bytes: number }> {
  const form = new FormData();
  form.append("name", name);
  form.append("file", blob, `${name}.${ext}`);
  return json(
    await fetch(projectUrl(ref, "editor/export"), {
      method: "POST",
      headers: { ...MUTATING_HEADERS },
      credentials: CREDENTIALS,
      body: form,
    }),
  );
}

/** Where "Back to Studio" goes: the studio's own UI, one level above /edit/. */
export function studioHomeUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.replace(/\/edit\/?$/, "/") || "/";
}
