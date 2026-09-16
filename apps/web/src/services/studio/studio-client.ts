/**
 * HTTP client for Clip Studio (the FastAPI app that serves this editor under /edit).
 *
 * Same origin in production, so every URL is relative; VITE_STUDIO_API overrides the
 * prefix for `vite dev` against a studio on another port.
 */

export const STUDIO_API: string =
  (import.meta.env.VITE_STUDIO_API as string | undefined) ?? "/api";

export interface StudioMediaRef {
  asset: string;
  url: string;
  duration_s: number;
  bytes: number;
}

export interface StudioShot {
  id: string;
  order: number;
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
  project: { id: string; name: string };
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
  studio: { pid: string; media: StudioMediaMap; savedAt: number; app: "openreel" };
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

export async function fetchManifest(pid: string): Promise<StudioManifest> {
  return json(await fetch(`${STUDIO_API}/projects/${pid}/editor/manifest`, { cache: "no-store" }));
}

export async function prepareNarration(
  pid: string,
): Promise<{ queued: boolean; missing: number; job?: StudioJob }> {
  return json(await fetch(`${STUDIO_API}/projects/${pid}/editor/prepare`, { method: "POST" }));
}

export async function pollJob(
  pid: string,
  jobId: string,
  onTick?: (job: StudioJob) => void,
  intervalMs = 1500,
): Promise<StudioJob> {
  for (;;) {
    const snap = await json<{ jobs: StudioJob[]; current: StudioJob | null }>(
      await fetch(`${STUDIO_API}/jobs?project_id=${pid}`, { cache: "no-store" }),
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

export async function fetchSavedDoc(pid: string): Promise<StudioSavedDoc | null> {
  const res = await fetch(`${STUDIO_API}/projects/${pid}/editor/doc`, { cache: "no-store" });
  if (res.status === 404) return null;
  return json(res);
}

export async function putSavedDoc(pid: string, doc: StudioSavedDoc): Promise<{ ts: number }> {
  return json(
    await fetch(`${STUDIO_API}/projects/${pid}/editor/doc`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    }),
  );
}

export async function fetchMediaBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res.blob();
}

export async function uploadExport(
  pid: string,
  blob: Blob,
  name: string,
  ext: string,
): Promise<{ export: string; url: string; bytes: number }> {
  const form = new FormData();
  form.append("name", name);
  form.append("file", blob, `${name}.${ext}`);
  return json(await fetch(`${STUDIO_API}/projects/${pid}/editor/export`, { method: "POST", body: form }));
}

/** Where "Back to Studio" goes: the studio's own UI, one level above /edit/. */
export function studioHomeUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.replace(/\/edit\/?$/, "/") || "/";
}
