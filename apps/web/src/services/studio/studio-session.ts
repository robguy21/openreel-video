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
  fetchManifest,
  fetchMediaBlob,
  fetchSavedDoc,
  pollJob,
  prepareNarration,
  putSavedDoc,
  putSavedDocRequest,
  uploadExport,
  type StudioManifest,
  type StudioMediaMap,
  type StudioRef,
  type StudioSavedDoc,
  type StudioShot,
} from "./studio-client";
import { planTimeline } from "./studio-layout";

export type StudioStatus = "idle" | "opening" | "ready" | "saving" | "exporting" | "error";

export interface StudioSessionState {
  pid: string | null;
  /** The part being cut, as the url named it; null = none named, which the studio reads
   *  as Part 1. Every studio call sends it back unchanged. */
  part: string | null;
  /** The project's name. */
  name: string;
  /** How the part is shown beside the name ("Part 2 · The chase"); "" when the studio
   *  did not say which part this is (a studio from before parts). */
  partLabel: string;
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
  part: null,
  name: "",
  partLabel: "",
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

/** What every studio call is about: this project, this part. */
function ref(): StudioRef | null {
  const { pid, part } = get();
  return pid ? { pid, part } : null;
}

/** "Part 2 · The chase", or "Part 2" for a part with no name typed: the studio's own
 *  `label` when it sends one, else drawn the same way here. */
export function partLabelOf(manifest: StudioManifest): string {
  const p = manifest.project.part;
  if (!p) return "";
  if (p.label) return p.label;
  const name = p.name?.trim() || "";
  if (!p.number) return name;
  const n = `Part ${p.number}`;
  return name ? `${n} · ${name}` : n;
}

/** The editor project's title: the film's name, and the part when there is one, so two
 *  parts' cuts are told apart in the editor and in the export's default name. */
export function editTitleOf(manifest: StudioManifest): string {
  const label = partLabelOf(manifest);
  const name = manifest.project.name || "";
  return label ? (name ? `${name} · ${label}` : label) : name;
}

// ─── Opening ────────────────────────────────────────────────────────────────

let opening: Promise<void> | null = null;

/**
 * Idempotent: a second call for the same project and part while the first is in flight
 * returns the same promise. `part` is the url's `part`, passed through as given; absent
 * means Part 1.
 */
export function openStudioProject(pid: string, part: string | null = null): Promise<void> {
  const want = part || null;
  if (opening && get().pid === pid && get().part === want) return opening;
  opening = doOpen({ pid, part: want }).finally(() => {
    opening = null;
  });
  return opening;
}

async function doOpen(at: StudioRef): Promise<void> {
  stopAutosave();
  const { pid } = at;
  set({
    pid,
    part: at.part,
    partLabel: "",
    status: "opening",
    message: "Contacting Clip Studio…",
    progress: 0,
    error: null,
    dirty: false,
    media: {},
  });
  try {
    // 1. narration the voice track needs (cached server-side by text + voice)
    const prep = await prepareNarration(at);
    if (prep.queued && prep.job) {
      progress(`Synthesising narration (${prep.missing})…`, 0.05);
      await pollJob(pid, prep.job.id, (job) =>
        progress(`Narration: ${job.message}`, 0.05 + 0.2 * (job.progress || 0)),
      );
    }

    // 2. what the project looks like now
    const manifest = await fetchManifest(at);
    set({ name: manifest.project.name, partLabel: partLabelOf(manifest) });

    // 3. restore the part's saved edit, or lay out its takes for the first time
    const saved = manifest.editor_saved ? await fetchSavedDoc(at) : null;
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

/**
 * The prefix a shot's files carry in the media library: `S01-03` = scene 1, shot 3, both
 * counted within the part (the manifest's `number`), which is unique within the part and
 * says the same number the studio's Film page does. A studio from before parts sends no
 * `number`, and then it is the film-wide position, `01`, as it always was.
 */
export function shotPrefix(shot: Pick<StudioShot, "order" | "number">): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (Array.isArray(shot.number) && shot.number.length === 3) {
    return `S${pad(shot.number[1])}-${pad(shot.number[2])}`;
  }
  return pad(shot.order + 1);
}

export function shotFileName(
  shot: Pick<StudioShot, "order" | "number" | "summary">,
  suffix: string,
  ext: string,
): string {
  const slug = (shot.summary || "shot").replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "shot";
  return `${shotPrefix(shot)}${suffix} ${slug}.${ext}`;
}

/** The extension of a studio asset's path, for the name it gets in the media library. */
function extOf(asset: string, fallback: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(asset);
  return m ? m[1].toLowerCase() : fallback;
}

const AUDIO_TYPES: Record<string, string> = {
  flac: "audio/flac",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
};

/**
 * The FIRST timeline of a part: every take in shot order, each trimmed to where the Film
 * stitch cuts it and each chained cut given the stitch's lead-in (`planTimeline`).
 *
 * This runs only when the part has no saved edit. An edit that exists is restored as it
 * was saved (`restoreSaved`), trims and all, and the manifest's cut points are not applied
 * to it again: a trim the author dragged is theirs, and the studio's rule is that an edit
 * keeps what it opened with until its owner asks for the swap. Asking is the studio's
 * "refresh the sources" (`api_editor_refresh_sources`), which archives the saved edit - so
 * the next open comes back through here and lays the takes, new or not, at the cut points
 * the manifest has THEN. There is no per-clip swap in this editor to re-lay one take on
 * its own; a take changed under a saved edit is shown as drift by the studio instead.
 */
async function buildFromManifest(manifest: StudioManifest): Promise<void> {
  const all = manifest.shots;
  const indices = all.map((s, i) => (s.video ? i : -1)).filter((i) => i >= 0);
  if (!indices.length) {
    throw new Error(
      manifest.project.part
        ? "No shot in this part has a rendered take yet - render at least one first."
        : "No shot has a rendered take yet - render at least one in Shots first.",
    );
  }
  const fps = manifest.fps || 24;
  // The shots whose sound is laid under the next one's start: known from the manifest
  // alone, so only those masters are downloaded.
  const soundFrom = new Set(
    planTimeline(all, fps, (s) => s.video?.duration_s || 0).leadIns.map((x) => x.from),
  );

  // Download everything first so the project canvas can match the first take.
  progress("Downloading takes…", 0.3);
  const files = new Map<number, { video: File; narration: File | null; sound: File | null }>();
  for (let n = 0; n < indices.length; n++) {
    const i = indices[n];
    const s = all[i];
    const video = await fetchAsFile(s.video!.url, shotFileName(s, "", "mp4"), "video/mp4");
    let narration: File | null = null;
    if (s.narration?.url && s.include_vo) {
      narration = await fetchAsFile(s.narration.url, shotFileName(s, " VO", "mp3"), "audio/mpeg");
    }
    let sound: File | null = null;
    if (soundFrom.has(i) && s.audio?.url) {
      const ext = extOf(s.audio.asset, "flac");
      sound = await fetchAsFile(s.audio.url, shotFileName(s, " sound", ext), AUDIO_TYPES[ext] || "audio/flac");
    }
    files.set(i, { video, narration, sound });
    progress(`Downloading takes… ${n + 1}/${indices.length}`, 0.3 + 0.3 * ((n + 1) / indices.length));
  }
  const dims = await probeVideo(files.get(indices[0])!.video);

  useProjectStore.getState().createNewProject(editTitleOf(manifest), {
    width: dims.width,
    height: dims.height,
    frameRate: fps,
  });

  // Import into the media library.
  progress("Importing media…", 0.6);
  const media: StudioMediaMap = {};
  const imported = new Map<number, { videoId: string; narrationId: string | null; soundId: string | null }>();
  const importOne = async (file: File, what: StudioMediaMap[string], required: boolean) => {
    const r = await useProjectStore.getState().importMedia(file);
    if (!r.success || !r.actionId) {
      if (required) {
        throw new Error(`Could not import ${file.name}: ${r.error?.message ?? "unknown error"}`);
      }
      return null;
    }
    media[r.actionId] = what;
    return r.actionId;
  };
  for (let n = 0; n < indices.length; n++) {
    const i = indices[n];
    const s = all[i];
    const f = files.get(i)!;
    const videoId = (await importOne(
      f.video,
      { url: s.video!.url, asset: s.video!.asset, name: f.video.name, type: "video" },
      true,
    ))!;
    const narrationId = f.narration
      ? await importOne(
          f.narration,
          { url: s.narration!.url!, asset: s.narration!.asset!, name: f.narration.name, type: "audio" },
          false,
        )
      : null;
    const soundId = f.sound
      ? await importOne(
          f.sound,
          { url: s.audio!.url, asset: s.audio!.asset, name: f.sound.name, type: "audio" },
          false,
        )
      : null;
    imported.set(i, { videoId, narrationId, soundId });
    progress(`Importing media… ${n + 1}/${indices.length}`, 0.6 + 0.3 * ((n + 1) / indices.length));
  }
  set({ media });

  // Lay out: one video track in shot order, each clip trimmed to its cut points, narration
  // on an audio track underneath, the lead-ins on one of their own, the studio's per-shot
  // gap and crossfade honoured where the seam is a cut.
  progress("Building timeline…", 0.92);
  const plan = planTimeline(all, fps, (s, i) => {
    const id = imported.get(i)?.videoId;
    return (id && useProjectStore.getState().getMediaItem(id)?.metadata.duration) || s.video?.duration_s || 0;
  });
  const leadIns = plan.leadIns.filter((x) => imported.get(x.from)?.soundId);
  const videoTrackId = `track-${uuidv4()}`;
  const audioTrackId = `track-${uuidv4()}`;
  const seamTrackId = `track-${uuidv4()}`;
  await useProjectStore.getState().addTrack("video", undefined, { trackId: videoTrackId, name: "Shots" });
  if ([...imported.values()].some((x) => x.narrationId)) {
    await useProjectStore.getState().addTrack("audio", undefined, { trackId: audioTrackId, name: "Narration" });
  }
  if (leadIns.length) {
    await useProjectStore.getState().addTrack("audio", undefined, { trackId: seamTrackId, name: "Seam sound" });
  }

  let prevClipId: string | null = null;
  for (const c of plan.clips) {
    const ids = imported.get(c.shot)!;
    const clip = await placeClip({
      trackId: videoTrackId,
      mediaId: ids.videoId,
      startTime: c.startTime,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
    });
    if (!clip) throw new Error(`Could not place ${all[c.shot].summary}`);
    if (ids.narrationId) {
      await useProjectStore.getState().addClip(audioTrackId, ids.narrationId, c.startTime);
    }
    if (prevClipId && c.crossfadeIn > 0) {
      await addTransition(prevClipId, clip, "crossfade", c.crossfadeIn);
    }
    prevClipId = clip;
  }
  for (const x of leadIns) {
    await placeClip({
      trackId: seamTrackId,
      mediaId: imported.get(x.from)!.soundId!,
      startTime: x.startTime,
      inPoint: x.inPoint,
      outPoint: x.inPoint + x.duration,
      fade: { fadeIn: 0, fadeOut: x.duration },
    });
  }

  // First save so the studio knows an edit exists even if the user closes the tab now.
  await saveToStudio();
}

/** A clip with its in and out points: `clip/add` through the executor, because the store's
 *  own `addClip` takes a start time only and would lay the whole take. Returns its id, or
 *  null when the executor refused it. */
async function placeClip(params: {
  trackId: string;
  mediaId: string;
  startTime: number;
  inPoint: number;
  outPoint: number;
  fade?: { fadeIn: number; fadeOut: number };
}): Promise<string | null> {
  const { project, actionExecutor } = useProjectStore.getState();
  const copy = structuredClone(project);
  const clipId = uuidv4();
  const result = await actionExecutor.execute(
    {
      type: "clip/add",
      id: uuidv4(),
      timestamp: Date.now(),
      params: { ...params, duration: params.outPoint - params.inPoint, clipId },
    },
    copy,
  );
  if (!result.success) return null;
  useProjectStore.setState({ project: { ...copy, modifiedAt: Date.now() } });
  return clipId;
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
    name: editTitleOf(manifest) || project.name,
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
  const at = ref();
  if (!get().dirty || !at) return;
  // keepalive lets the request outlive the tab; the document is small (media is by reference)
  try {
    void fetch(...putSavedDocRequest(at, buildSavedDoc(), true));
  } catch {
    /* best effort */
  }
}

function buildSavedDoc(): StudioSavedDoc {
  const full = useProjectStore.getState().getFullProject();
  const serializer = createProjectSerializer(createStorageEngine());
  const parsed = JSON.parse(serializer.exportToJsonWithMetadata(full, "Clip Studio edit")) as StudioSavedDoc;
  const { pid, part, media } = get();
  // Only keep mappings for media that still exists in the library.
  const live = new Set(full.mediaLibrary.items.map((m) => m.id));
  const kept: StudioMediaMap = {};
  for (const [id, m] of Object.entries(media)) if (live.has(id)) kept[id] = m;
  parsed.studio = { pid: pid!, media: kept, savedAt: Date.now(), app: "openreel" };
  if (part) parsed.studio.part = part;
  return parsed;
}

/** Serialised: a save started while another is in flight waits for it. */
export function saveToStudio(): Promise<void> {
  const at = ref();
  if (!at) return Promise.resolve();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveChain = saveChain.then(async () => {
    const before = get().status;
    if (before === "ready") set({ status: "saving" });
    try {
      const r = await putSavedDoc(at, buildSavedDoc());
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
  const at = ref();
  if (!at || get().status === "exporting") return;
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
    const r = await uploadExport(at, blob(), name || project.name || "edit", "mp4");
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
