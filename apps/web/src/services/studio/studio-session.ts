/**
 * Clip Studio session: opens a studio project inside the editor, keeps the editor's
 * project document saved back to the studio, and uploads renders into the project.
 *
 * Opening = (1) ask the studio to synthesise any narration that is missing, (2) pull the
 * manifest, (3) either restore the previously saved editor document or lay the takes out
 * on a fresh timeline, (4) hydrate every media item from IndexedDB or, failing that, from
 * the studio's asset URLs. Saving = the same JSON the "Project JSON" dialog exports, plus
 * a `studio` block mapping media ids to studio assets so a fresh browser can re-download.
 */
import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  createProjectSerializer,
  createStorageEngine,
  getExportEngine,
  type MediaItem,
  type Project,
  type VideoExportSettings,
  type ExportResult,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { toast } from "../../stores/notification-store";
import { loadMediaBlob, saveMediaBlob } from "../media-storage";
import { createMissingMediaItem, restoreMediaItem } from "../../utils/media-recovery";
import {
  STUDIO_API,
  fetchManifest,
  fetchMediaBlob,
  fetchSavedDoc,
  pollJob,
  prepareNarration,
  putSavedDoc,
  uploadExport,
  type StudioManifest,
  type StudioMediaMap,
  type StudioSavedDoc,
  type StudioShot,
} from "./studio-client";

export type StudioStatus = "idle" | "opening" | "ready" | "saving" | "exporting" | "error";

export interface StudioSessionState {
  pid: string | null;
  name: string;
  status: StudioStatus;
  message: string;
  progress: number; // 0..1 while opening / exporting
  dirty: boolean;
  lastSavedAt: number | null;
  lastExport: { url: string; asset: string } | null;
  /** Wall-clock time of the last successful export (drives the "Saved!" pill). */
  lastExportAt: number | null;
  media: StudioMediaMap;
  error: string | null;
}

export const useStudioStore = create<StudioSessionState>()(() => ({
  pid: null,
  name: "",
  status: "idle",
  message: "",
  progress: 0,
  dirty: false,
  lastSavedAt: null,
  lastExport: null,
  lastExportAt: null,
  media: {},
  error: null,
}));

const set = useStudioStore.setState;
const get = useStudioStore.getState;

function progress(message: string, p?: number) {
  set((s) => ({ message, progress: p ?? s.progress }));
}

export function isStudioSession(): boolean {
  return get().pid !== null;
}

// ─── Opening ────────────────────────────────────────────────────────────────

let opening: Promise<void> | null = null;

/** Idempotent: a second call while the first is in flight returns the same promise. */
export function openStudioProject(pid: string): Promise<void> {
  if (opening && get().pid === pid) return opening;
  opening = doOpen(pid).finally(() => {
    opening = null;
  });
  return opening;
}

async function doOpen(pid: string): Promise<void> {
  stopAutosave();
  set({
    pid,
    status: "opening",
    message: "Contacting Clip Studio…",
    progress: 0,
    error: null,
    dirty: false,
    media: {},
  });
  try {
    // 1. narration the voice track needs (cached server-side by text + voice)
    const prep = await prepareNarration(pid);
    if (prep.queued && prep.job) {
      progress(`Synthesising narration (${prep.missing})…`, 0.05);
      await pollJob(pid, prep.job.id, (job) =>
        progress(`Narration: ${job.message}`, 0.05 + 0.2 * (job.progress || 0)),
      );
    }

    // 2. what the project looks like now
    const manifest = await fetchManifest(pid);
    set({ name: manifest.project.name });

    // 3. restore the saved edit, or lay out the takes for the first time
    const saved = manifest.editor_saved ? await fetchSavedDoc(pid) : null;
    if (saved && saved.studio?.app === "openreel") {
      await restoreSaved(saved, manifest);
    } else {
      await buildFromManifest(manifest);
    }

    set({ status: "ready", message: "", progress: 1, dirty: false });
    startAutosave();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    set({ status: "error", error: msg, message: "" });
    toast.error("Clip Studio", msg);
    throw e;
  }
}

/** Fetch a studio asset as a File the media importer accepts. */
async function fetchAsFile(url: string, name: string, type: string): Promise<File> {
  const blob = await fetchMediaBlob(url);
  return new File([blob], name, { type });
}

function probeVideo(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const src = URL.createObjectURL(file);
    const done = (w: number, h: number) => {
      URL.revokeObjectURL(src);
      v.remove();
      resolve({ width: w || 1920, height: h || 1080 });
    };
    v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight);
    v.onerror = () => done(0, 0);
    v.src = src;
  });
}

function shotFileName(shot: StudioShot, suffix: string, ext: string): string {
  const n = String(shot.order + 1).padStart(2, "0");
  const slug = (shot.summary || "shot").replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "shot";
  return `${n}${suffix} ${slug}.${ext}`;
}

async function buildFromManifest(manifest: StudioManifest): Promise<void> {
  const shots = manifest.shots.filter((s) => s.video);
  if (!shots.length) {
    throw new Error("No shot has a rendered take yet - render at least one in Shots first.");
  }

  // Download everything first so the project canvas can match the first take.
  progress("Downloading takes…", 0.3);
  const files: { shot: StudioShot; video: File; narration: File | null }[] = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const video = await fetchAsFile(s.video!.url, shotFileName(s, "", "mp4"), "video/mp4");
    let narration: File | null = null;
    if (s.narration?.url && s.include_vo) {
      narration = await fetchAsFile(s.narration.url, shotFileName(s, " VO", "mp3"), "audio/mpeg");
    }
    files.push({ shot: s, video, narration });
    progress(`Downloading takes… ${i + 1}/${shots.length}`, 0.3 + 0.3 * ((i + 1) / shots.length));
  }
  const dims = await probeVideo(files[0].video);

  useProjectStore.getState().createNewProject(manifest.project.name, {
    width: dims.width,
    height: dims.height,
    frameRate: manifest.fps || 24,
  });

  // Import into the media library.
  progress("Importing media…", 0.6);
  const media: StudioMediaMap = {};
  const imported: { shot: StudioShot; videoId: string; narrationId: string | null }[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const vr = await useProjectStore.getState().importMedia(f.video);
    if (!vr.success || !vr.actionId) {
      throw new Error(`Could not import ${f.video.name}: ${vr.error?.message ?? "unknown error"}`);
    }
    media[vr.actionId] = {
      url: f.shot.video!.url,
      asset: f.shot.video!.asset,
      name: f.video.name,
      type: "video",
    };
    let narrationId: string | null = null;
    if (f.narration) {
      const nr = await useProjectStore.getState().importMedia(f.narration);
      if (nr.success && nr.actionId) {
        narrationId = nr.actionId;
        media[nr.actionId] = {
          url: f.shot.narration!.url!,
          asset: f.shot.narration!.asset!,
          name: f.narration.name,
          type: "audio",
        };
      }
    }
    imported.push({ shot: f.shot, videoId: vr.actionId, narrationId });
    progress(`Importing media… ${i + 1}/${files.length}`, 0.6 + 0.3 * ((i + 1) / files.length));
  }
  set({ media });

  // Lay out: one video track in shot order, narration on an audio track underneath,
  // the studio's per-shot gap and crossfade honoured.
  progress("Building timeline…", 0.92);
  const videoTrackId = `track-${uuidv4()}`;
  const audioTrackId = `track-${uuidv4()}`;
  await useProjectStore.getState().addTrack("video", undefined, { trackId: videoTrackId, name: "Shots" });
  if (imported.some((x) => x.narrationId)) {
    await useProjectStore.getState().addTrack("audio", undefined, { trackId: audioTrackId, name: "Narration" });
  }

  let t = 0;
  let prevClipId: string | null = null;
  let pendingCrossfade = 0;
  for (const x of imported) {
    const s = useProjectStore.getState();
    const dur = s.getMediaItem(x.videoId)?.metadata.duration || 0;
    const r = await s.addClip(videoTrackId, x.videoId, t);
    if (!r.success) throw new Error(`Could not place ${x.shot.summary}: ${r.error?.message ?? ""}`);
    const clip = findClipAt(videoTrackId, t);
    if (x.narrationId) {
      await useProjectStore.getState().addClip(audioTrackId, x.narrationId, t);
    }
    if (prevClipId && clip && pendingCrossfade > 0) {
      await addTransition(prevClipId, clip, "crossfade", pendingCrossfade);
    }
    prevClipId = clip;
    pendingCrossfade = x.shot.crossfade_s || 0;
    t += dur + (x.shot.gap_s || 0);
  }

  // First save so the studio knows an edit exists even if the user closes the tab now.
  await saveToStudio();
}

function findClipAt(trackId: string, startTime: number): string | null {
  const track = useProjectStore.getState().project.timeline.tracks.find((tr) => tr.id === trackId);
  const clip = track?.clips.find((c) => Math.abs(c.startTime - startTime) < 1e-3);
  return clip?.id ?? null;
}

async function addTransition(clipAId: string, clipBId: string, transitionType: string, duration: number) {
  const { project, actionExecutor } = useProjectStore.getState();
  const copy = structuredClone(project);
  const result = await actionExecutor.execute(
    {
      type: "transition/add",
      id: uuidv4(),
      timestamp: Date.now(),
      params: { clipAId, clipBId, transitionType, duration },
    },
    copy,
  );
  if (result.success) {
    useProjectStore.setState({ project: { ...copy, modifiedAt: Date.now() } });
  }
}

// ─── Restoring a saved edit ─────────────────────────────────────────────────

async function restoreSaved(saved: StudioSavedDoc, manifest: StudioManifest): Promise<void> {
  progress("Restoring your edit…", 0.3);
  const serializer = createProjectSerializer(createStorageEngine());
  const { project, validation } = serializer.importFromJsonWithValidation(JSON.stringify(saved));
  if (!project) {
    throw new Error(`Saved edit is not readable: ${validation.errors.join("; ")}`);
  }
  const media: StudioMediaMap = { ...(saved.studio.media || {}) };

  // Hydrate: IndexedDB first (same browser), then the studio's asset URL.
  const items: MediaItem[] = [];
  const all = project.mediaLibrary.items;
  for (let i = 0; i < all.length; i++) {
    const item = all[i];
    progress(`Loading media… ${i + 1}/${all.length}`, 0.3 + 0.6 * ((i + 1) / all.length));
    let blob: Blob | null = item.blob instanceof Blob ? item.blob : null;
    if (!blob) {
      try {
        blob = await loadMediaBlob(item.id);
      } catch {
        blob = null;
      }
    }
    const ref = media[item.id];
    if (!blob && ref) {
      try {
        blob = await fetchMediaBlob(ref.url);
        await saveMediaBlob(project.id, item.id, blob, item.metadata);
      } catch (e) {
        console.warn("[studio] could not re-download", ref.url, e);
      }
    }
    if (blob) {
      const restored = await restoreMediaItem(item, blob);
      items.push({ ...restored, originalUrl: ref?.url ?? item.originalUrl });
    } else {
      items.push(createMissingMediaItem(item));
    }
  }

  useProjectStore.getState().loadProject({
    ...project,
    name: manifest.project.name || project.name,
    mediaLibrary: { ...project.mediaLibrary, items },
  });
  set({ media });
}

// ─── Saving ─────────────────────────────────────────────────────────────────

let unsubscribe: (() => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();

function startAutosave() {
  stopAutosave();
  unsubscribe = useProjectStore.subscribe(
    (s) => s.project,
    () => {
      if (get().status === "opening") return;
      set({ dirty: true });
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void saveToStudio(), 2000);
    },
  );
  window.addEventListener("beforeunload", flushOnUnload);
}

function stopAutosave() {
  unsubscribe?.();
  unsubscribe = null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  window.removeEventListener("beforeunload", flushOnUnload);
}

function flushOnUnload() {
  const { dirty, pid } = get();
  if (!dirty || !pid) return;
  // keepalive lets the request outlive the tab; the document is small (media is by reference)
  try {
    void fetch(`${STUDIO_API}/projects/${pid}/editor/doc`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSavedDoc()),
      keepalive: true,
    });
  } catch {
    /* best effort */
  }
}

function buildSavedDoc(): StudioSavedDoc {
  const full = useProjectStore.getState().getFullProject();
  const serializer = createProjectSerializer(createStorageEngine());
  const parsed = JSON.parse(serializer.exportToJsonWithMetadata(full, "Clip Studio edit")) as StudioSavedDoc;
  const { pid, media } = get();
  // Only keep mappings for media that still exists in the library.
  const live = new Set(full.mediaLibrary.items.map((m) => m.id));
  const kept: StudioMediaMap = {};
  for (const [id, ref] of Object.entries(media)) if (live.has(id)) kept[id] = ref;
  parsed.studio = { pid: pid!, media: kept, savedAt: Date.now(), app: "openreel" };
  return parsed;
}

/** Serialised: a save started while another is in flight waits for it. */
export function saveToStudio(): Promise<void> {
  const pid = get().pid;
  if (!pid) return Promise.resolve();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveChain = saveChain.then(async () => {
    const before = get().status;
    if (before === "ready") set({ status: "saving" });
    try {
      const r = await putSavedDoc(pid, buildSavedDoc());
      set({ dirty: false, lastSavedAt: r.ts * 1000, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg });
      toast.error("Save to Clip Studio failed", msg);
    } finally {
      if (get().status === "saving") set({ status: "ready" });
    }
  });
  return saveChain;
}

// ─── Export back into the studio project ────────────────────────────────────

/** An in-memory FileSystemWritableFileStream: the muxer seeks and writes, we keep bytes. */
function createBlobWritable(mime: string): { writable: FileSystemWritableFileStream; blob: () => Blob } {
  let buffer = new Uint8Array(16 * 1024 * 1024);
  let length = 0;
  let cursor = 0;
  const grow = (needed: number) => {
    if (needed <= buffer.length) return;
    let size = buffer.length;
    while (size < needed) size *= 2;
    const next = new Uint8Array(size);
    next.set(buffer.subarray(0, length));
    buffer = next;
  };
  const writeBytes = (bytes: Uint8Array, position: number) => {
    const end = position + bytes.byteLength;
    grow(end);
    buffer.set(bytes, position);
    if (end > length) length = end;
    cursor = end;
  };
  const writable = {
    seek(position: number) {
      cursor = position;
      return Promise.resolve();
    },
    async write(data: unknown) {
      if (data instanceof ArrayBuffer) writeBytes(new Uint8Array(data), cursor);
      else if (ArrayBuffer.isView(data)) {
        writeBytes(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), cursor);
      } else if (data instanceof Blob) writeBytes(new Uint8Array(await data.arrayBuffer()), cursor);
    },
    close() {
      return Promise.resolve();
    },
    abort() {
      return Promise.resolve();
    },
    truncate(size: number) {
      length = Math.min(length, size);
      return Promise.resolve();
    },
  } as unknown as FileSystemWritableFileStream;
  return { writable, blob: () => new Blob([buffer.slice(0, length)], { type: mime }) };
}

/**
 * Render the timeline and store the MP4 in the Clip Studio project's exports.
 * Defaults to H.264 MP4 at project size; `settingsOverride` lets a caller pick
 * another quality while keeping this as the single implementation.
 */
export async function exportToStudio(
  name?: string,
  settingsOverride: Partial<VideoExportSettings> = {},
): Promise<void> {
  const pid = get().pid;
  if (!pid || get().status === "exporting") return;
  const project: Project = useProjectStore.getState().getFullProject();
  const settings: Partial<VideoExportSettings> = {
    width: project.settings.width,
    height: project.settings.height,
    frameRate: project.settings.frameRate,
    format: "mp4",
    codec: "h264",
    bitrate: 12000,
    quality: 85,
    ...settingsOverride,
  };
  set({ status: "exporting", progress: 0, message: "Preparing export…", error: null });
  try {
    await saveToStudio();
    const engine = getExportEngine();
    await engine.initialize();
    const { writable, blob } = createBlobWritable("video/mp4");
    const gen = engine.exportVideo(project, settings, writable);
    let result: ExportResult | undefined;
    for (;;) {
      const { value, done } = await gen.next();
      if (done) {
        result = value;
        break;
      }
      progress(`Rendering… ${Math.round(value.progress * 100)}%`, value.progress);
    }
    if (!result?.success) throw new Error(result?.error?.message || "Export failed");
    progress("Uploading to Clip Studio…", 1);
    const r = await uploadExport(pid, blob(), name || project.name || "edit", "mp4");
    set({ lastExport: { url: r.url, asset: r.export }, lastExportAt: Date.now() });
    toast.success("Sent to Clip Studio", `${(r.bytes / 1e6).toFixed(1)} MB saved as ${r.export}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    set({ error: msg });
    toast.error("Export to Clip Studio failed", msg);
  } finally {
    set({ status: "ready", message: "", progress: 0 });
  }
}

/** Clear a failed studio export so the toolbar returns to its idle state. */
export function dismissStudioError(): void {
  set({ error: null });
}
