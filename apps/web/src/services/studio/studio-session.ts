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
  archiveSavedEdit,
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
  type StudioSong,
} from "./studio-client";
import { planTimeline, type TimelinePlan } from "./studio-layout";
import {
  assetExt,
  partitionSongs,
  savedMediaMap,
  songFileName,
  songImportMessage,
} from "./studio-music";

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
  /** The part as the studio's Stitch cut it (the manifest's `stitch_export`), which the
   *  Reference monitor holds when nothing else is picked; null when the studio offers
   *  none (never stitched, or a film of several parts). */
  stitchFilm: { url: string; asset: string; duration: number; fps: number } | null;
  /** While the studio makes that cut (it does when the part is handed over and today's is
   *  not on disk): how far it has got, or why it could not be made. */
  stitchMaking: { progress: number; message: string; failed?: string } | null;
  /** True while the project's songs are being brought into the media library. */
  songsBusy: boolean;
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
  stitchFilm: null,
  stitchMaking: null,
  songsBusy: false,
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
  // The edit open now (if any) stops being editable and its unsaved changes are saved
  // BEFORE anything waits on it; then its song import is stopped (its download aborted)
  // and has let go of the project store before this one replaces it.
  const unsaved = get().pid !== null && (get().dirty || saveTimer !== null);
  stopAutosave();
  if (get().pid !== null) set({ status: "opening", message: "Contacting Clip Studio…" });
  if (unsaved) await saveToStudio();
  await stopSongs();
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
    set({
      name: manifest.project.name,
      partLabel: partLabelOf(manifest),
      stitchFilm: stitchFilmOf(manifest),
      stitchMaking: null,
    });

    // 3. restore the part's saved edit, or lay out its takes for the first time
    const saved = manifest.editor_saved ? await fetchSavedDoc(at) : null;
    if (saved && saved.studio?.app === "openreel") {
      await restoreSaved(saved, manifest);
    } else {
      await buildFromManifest(manifest);
    }

    set({ status: "ready", message: "", progress: 1, dirty: false });
    startAutosave();

    // The project's songs, into the media library in the background: the editor does not
    // wait for them.
    void startSongs("open", manifest);

    // 4. the part as Stitch cuts it, if the studio is still making it: waited for AFTER the
    // editor is open, so an encode of minutes never holds the timeline back.
    if (prep.stitch_job) void awaitStitchFilm(at, prep.stitch_job.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    set({ status: "error", error: msg, message: "" });
    toast.error("Clip Studio", msg);
    throw e;
  }
}

/**
 * "Rebuild from the film" (R8.8), after the reader has confirmed it: the part's saved edit
 * is put aside in the studio (kept there as a file) and the part is laid out fresh from
 * the manifest by the first-build path - takes at the film's cut points, each take's
 * sound on its own row. A saved edit is otherwise opened exactly as saved and never
 * upgraded on its own.
 */
export async function rebuildFromFilm(): Promise<void> {
  const at = ref();
  if (!at || get().status !== "ready") return;
  stopAutosave();
  set({ status: "opening", message: "Rebuilding from the film…", progress: 0.05, error: null });
  try {
    await stopSongs();
    await saveChain;
    await archiveSavedEdit(at);
    const manifest = await fetchManifest(at);
    set({ name: manifest.project.name, partLabel: partLabelOf(manifest), stitchFilm: stitchFilmOf(manifest) });
    await buildFromManifest(manifest);
    set({ status: "ready", message: "", progress: 1, dirty: false });
    startAutosave();
    void startSongs("open", manifest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    set({ status: "error", error: msg, message: "" });
    toast.error("Rebuild from the film failed", msg);
  }
}

/** The manifest's `stitch_export` as the Reference monitor's film, or null. */
export function stitchFilmOf(manifest: StudioManifest): StudioSessionState["stitchFilm"] {
  const ex = manifest.stitch_export;
  return ex ? { url: ex.url, asset: ex.asset, duration: ex.duration_s, fps: manifest.fps || 24 } : null;
}

/**
 * Follow the studio's job making the part's cut, then take the file from a fresh manifest.
 * Nothing here blocks the editor, and a result that arrives after another part or film
 * has been opened is dropped.
 */
async function awaitStitchFilm(at: StudioRef, jobId: string): Promise<void> {
  const still = () => get().pid === at.pid && get().part === at.part;
  set({ stitchMaking: { progress: 0, message: "Making the part's cut…" } });
  try {
    await pollJob(at.pid, jobId, (job) => {
      if (still()) {
        set({ stitchMaking: { progress: job.progress || 0, message: job.message || "Making the part's cut…" } });
      }
    });
    if (!still()) return;
    const manifest = await fetchManifest(at);
    if (!still()) return;
    set({ stitchFilm: stitchFilmOf(manifest), stitchMaking: null });
  } catch (e) {
    if (still()) {
      set({
        stitchMaking: {
          progress: 0,
          message: "",
          failed: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }
}

/** Fetch a studio asset as a File the media importer accepts. */
async function fetchAsFile(url: string, name: string, type: string, signal?: AbortSignal): Promise<File> {
  const blob = await fetchMediaBlob(url, signal);
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
  const timing = {
    narrationDelayMs: manifest.narration_delay_ms,
    narrationDuck: manifest.narration_duck,
  };

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
    // Every take's own sound, for its row beside the picture (R8.1) - once, and the same
    // item serves the seam sound under the next shot.
    let sound: File | null = null;
    if (s.audio?.url) {
      const ext = assetExt(s.audio.asset, "flac");
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

  // Lay out: the shots in order on one video track, each trimmed to its cut points, and a
  // track above it wherever a crossfade overlaps two of them; narration on an audio track
  // underneath, the lead-ins on one of their own. Every time and level is `planTimeline`'s,
  // which is the Film stitch's rule.
  progress("Building timeline…", 0.92);
  const plan = planTimeline(
    all,
    fps,
    (s, i) => {
      const id = imported.get(i)?.videoId;
      return (id && useProjectStore.getState().getMediaItem(id)?.metadata.duration) || s.video?.duration_s || 0;
    },
    { ...timing, narrated: (_s, i) => Boolean(imported.get(i)?.narrationId) },
  );
  const leadIns = plan.leadIns.filter((x) => imported.get(x.from)?.soundId);
  const tracks = studioTrackPlan(plan, (shot) => Boolean(imported.get(shot)?.soundId), leadIns.length > 0);
  const trackIds = new Map<string, string>();
  for (const t of tracks) {
    const trackId = `track-${uuidv4()}`;
    trackIds.set(t.key, trackId);
    await useProjectStore.getState().addTrack(t.type, t.position, { trackId, name: t.name });
  }
  const laneTrack = (lane: number) => trackIds.get(`picture:${lane}`)!;
  const soundTrack = (lane: number) => trackIds.get(`sound:${lane}`);

  // Each planned clip is a linked pair (R8.3): the picture on its lane, silent and with no
  // sound fade, and the take's own sound on the matching sound row at the plan's times,
  // level and fades. A shot with no separate sound keeps its sound in the picture clip,
  // exactly as before (R8.4), and says so once.
  for (const c of plan.clips) {
    const ids = imported.get(c.shot)!;
    const soundRow = ids.soundId ? soundTrack(c.lane) : undefined;
    const fade =
      c.soundFadeIn || c.soundFadeOut ? { fadeIn: c.soundFadeIn, fadeOut: c.soundFadeOut } : undefined;
    const clip = await placeClip({
      trackId: laneTrack(c.lane),
      mediaId: ids.videoId,
      startTime: c.startTime,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      volume: soundRow ? 0 : c.volume,
      fade: soundRow ? undefined : fade,
    });
    if (!clip) throw new Error(`Could not place ${all[c.shot].summary}`);
    if (c.pictureIn > 0) await addEdgeFade(clip, "in", c.pictureIn);
    if (c.pictureOut > 0) await addEdgeFade(clip, "out", c.pictureOut);
    if (!soundRow) {
      console.warn(`[studio] ${all[c.shot].summary}: no separate sound, kept in the picture clip`);
      continue;
    }
    const sound = await placeClip({
      trackId: soundRow,
      mediaId: ids.soundId!,
      startTime: c.startTime,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      volume: c.volume,
      fade,
    });
    if (!sound) throw new Error(`Could not place the sound of ${all[c.shot].summary}`);
    await useProjectStore.getState().linkClips(clip, sound);
  }
  const audioTrackId = trackIds.get("narration")!;
  const seamTrackId = trackIds.get("seam")!;
  for (const n of plan.narrations) {
    const id = imported.get(n.shot)?.narrationId;
    if (id) await useProjectStore.getState().addClip(audioTrackId, id, n.startTime);
  }
  for (const x of leadIns) {
    await placeClip({
      trackId: seamTrackId,
      mediaId: imported.get(x.from)!.soundId!,
      startTime: x.startTime,
      inPoint: x.inPoint,
      outPoint: x.inPoint + x.duration,
      volume: x.volume,
      fade: { fadeIn: 0, fadeOut: x.duration },
    });
  }

  // First save so the studio knows an edit exists even if the user closes the tab now.
  await saveToStudio();
}

export interface StudioTrack {
  /** "picture:<lane>", "sound:<lane>", "narration" or "seam". */
  key: string;
  type: "video" | "audio";
  name: string;
  /** Where `addTrack` puts it: undefined appends, 0 is the top. */
  position?: number;
}

/**
 * The rows of a laid-out studio film, in the order they are added (R8.2). Top to bottom
 * they read: `Crossfades` (`Crossfades N` when there are several), `Shots`, `Shot sound`,
 * `Crossfade sound` (one per crossfade lane, `Crossfade sound N` when there are several),
 * `Narration`, `Seam sound`. A crossfaded shot's picture is on a Crossfades lane, so its
 * sound is on the matching Crossfade sound row: two sounds that overlap never share a row.
 * A row nothing is laid on is not made.
 */
export function studioTrackPlan(
  plan: Pick<TimelinePlan, "clips" | "lanes" | "narrations">,
  hasSound: (shot: number) => boolean,
  hasLeadIns: boolean,
): StudioTrack[] {
  const out: StudioTrack[] = [{ key: "picture:0", type: "video", name: "Shots" }];
  // Each lane above the first is a track above the one before it (the first track in the
  // list is drawn on top), so a clip that fades in over another is always the upper one.
  for (let lane = 1; lane < plan.lanes; lane++) {
    out.push({
      key: `picture:${lane}`,
      type: "video",
      name: plan.lanes > 2 ? `Crossfades ${lane}` : "Crossfades",
      position: 0,
    });
  }
  const soundLanes = new Set(plan.clips.filter((c) => hasSound(c.shot)).map((c) => c.lane));
  for (let lane = 0; lane < plan.lanes; lane++) {
    if (!soundLanes.has(lane)) continue;
    out.push({
      key: `sound:${lane}`,
      type: "audio",
      name: lane === 0 ? "Shot sound" : plan.lanes > 2 ? `Crossfade sound ${lane}` : "Crossfade sound",
    });
  }
  if (plan.narrations.length) out.push({ key: "narration", type: "audio", name: "Narration" });
  if (hasLeadIns) out.push({ key: "seam", type: "audio", name: "Seam sound" });
  return out;
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
  volume?: number;
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

/**
 * The picture half of a crossfade: the fork's own edge transition on the clip on top, so it
 * fades in over (or out over) whatever is under it - the clip it overlaps, or black. The
 * sound half is each clip's own fade (`placeClip`), so `audioFade` stays off here rather
 * than fading the top clip's sound a second time.
 */
async function addEdgeFade(clipId: string, edge: "in" | "out", duration: number) {
  await useProjectStore.getState().addClipTransition({
    id: `transition-${uuidv4()}`,
    clipAId: clipId,
    edge,
    type: "crossfade",
    duration,
    params: { audioFade: false },
  });
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

// ─── Songs (the manifest's `music`) ─────────────────────────────────────────
//
// Songs come into the media library AFTER the editor is open, in the background, one at a
// time (a song is tens of megabytes; one in memory at once). Only one song run exists at a
// time, and it is mutually exclusive with everything that replaces the project under it:
// opening a project or part and Rebuild from the film CANCEL it and wait until it has let go
// of the project store (`stopSongs`) before they touch anything; Send to Studio WAITS for it
// to finish, so the export carries what it brought in. After every await the run checks that
// it is still the run for this project and part (`still`) and abandons quietly when not, and
// each song's mapping goes into the live store the moment it is imported - never a snapshot
// written back at the end, which would land an old map over a newer one.

const SONGS_TITLE = "Import Audio Creations";

let songGen = 0;
let songRun: Promise<void> | null = null;
/** Which kind of run `songRun` is. */
let songRunMode: "open" | "menu" | null = null;
/** The download the running import is waiting on, aborted by `stopSongs`. */
let songAbort: AbortController | null = null;
/** Import Audio Creations asked for while the open-time run was going: started when it ends. */
let menuQueued = false;

/** Cancel the running song import, if any - aborting the download it is waiting on - and
 *  wait until it has stopped touching the project. A queued menu run is dropped. What
 *  `doOpen` and `rebuildFromFilm` do before anything else. */
async function stopSongs(): Promise<void> {
  songGen++;
  menuQueued = false;
  songAbort?.abort();
  const run = songRun;
  if (run) await run.catch(() => undefined);
}

/** Wait for the running song import to finish (Send to Studio). */
async function settleSongs(): Promise<void> {
  const run = songRun;
  if (run) await run.catch(() => undefined);
}

/** For tests: the running song import, or a settled promise. */
export function songsSettled(): Promise<void> {
  return songRun ?? Promise.resolve();
}

/** The live media ids of the open edit. */
function libraryIds(): Set<string> {
  return new Set(useProjectStore.getState().project.mediaLibrary.items.map((m) => m.id));
}

async function fetchSong(song: StudioSong, signal?: AbortSignal): Promise<File> {
  const ext = assetExt(song.asset, "flac");
  return fetchAsFile(song.url, songFileName(song), AUDIO_TYPES[ext] || "audio/flac", signal);
}

/** Whether a library item's file is really here: in memory and in this browser's store. */
async function hasBlob(mediaId: string): Promise<boolean> {
  const item = useProjectStore.getState().getMediaItem(mediaId);
  if (!item || item.isPlaceholder || !(item.blob instanceof Blob)) return false;
  try {
    return (await loadMediaBlob(mediaId)) !== null;
  } catch {
    return false;
  }
}

/** Whether this browser's media store holds the item's file (false when the write failed,
 *  e.g. over quota: the song is in the edit all the same, from memory). */
async function kept(mediaId: string): Promise<boolean> {
  try {
    return (await loadMediaBlob(mediaId)) !== null;
  } catch {
    return false;
  }
}

/** Record one song's media id in the LIVE map, and drop any tombstone for the same song. */
function recordSong(mediaId: string, song: StudioSong, name: string) {
  set((s) => {
    const media: StudioMediaMap = {};
    for (const [id, m] of Object.entries(s.media)) {
      if (m.asset === song.asset && (m.deleted || m.song) && id !== mediaId) continue;
      media[id] = m;
    }
    media[mediaId] = { url: song.url, asset: song.asset, name, type: "audio", song: true };
    return { media };
  });
}

function startSongs(mode: "open" | "menu", manifest?: StudioManifest): Promise<void> {
  const at = ref();
  if (!at) return Promise.resolve();
  const gen = ++songGen;
  const abort = new AbortController();
  const run: Promise<void> = doSongs(mode, at, gen, manifest, abort.signal).finally(() => {
    if (songRun !== run) return;
    songRun = null;
    songRunMode = null;
    songAbort = null;
    set({ songsBusy: false });
    // A menu click that arrived during the open-time run: its turn now, unless the run was
    // stopped (another part opened, a rebuild) - `stopSongs` dropped it then.
    if (menuQueued) {
      menuQueued = false;
      if (gen === songGen && ref()) startMenuRun();
    }
  });
  songRun = run;
  songRunMode = mode;
  songAbort = abort;
  set({ songsBusy: true });
  return run;
}

/**
 * One song run. `open` (after the editor opens or is rebuilt): import every song the edit
 * has never had, and say nothing when there is none. `menu` (Import Audio Creations): ask
 * the studio again, fetch again any song the library has whose file is gone, bring back
 * songs the reader deleted, import the missing ones, and always say what happened. Never
 * the timeline, never a removal. A song that cannot be fetched or imported is skipped with
 * a warning and counted.
 */
async function doSongs(
  mode: "open" | "menu",
  at: StudioRef,
  gen: number,
  given?: StudioManifest,
  signal?: AbortSignal,
): Promise<void> {
  const still = () => gen === songGen && get().pid === at.pid && get().part === at.part;
  const n = (k: number) => `${k} song${k === 1 ? "" : "s"}`;
  try {
    const manifest = given ?? (await fetchManifest(at));
    if (!still()) return;
    const { present, missing, deleted } = partitionSongs(manifest.music, get().media, libraryIds());
    const lost: { song: StudioSong; mediaId: string }[] = [];
    if (mode === "menu") {
      for (const p of present) {
        if (!(await hasBlob(p.mediaId))) lost.push(p);
        if (!still()) return;
      }
    }
    const toImport = mode === "menu" ? [...missing, ...deleted] : missing;
    const total = partitionSongs(manifest.music, {}, new Set()).missing.length;
    const work = lost.length + toImport.length;
    if (mode === "open" && !work) return;
    if (work) toast.info(SONGS_TITLE, `Bringing in ${n(work)}…`);

    let imported = 0;
    let refetched = 0;
    let failed = 0;
    let notKept = 0;
    for (const { song, mediaId } of lost) {
      try {
        const file = await fetchSong(song, signal);
        if (!still()) return;
        const r = await useProjectStore.getState().replaceMediaAsset(mediaId, file);
        if (!r.success) throw new Error(r.error?.message ?? "could not import");
        const item = useProjectStore.getState().getMediaItem(mediaId);
        try {
          await saveMediaBlob(useProjectStore.getState().project.id, mediaId, file, item!.metadata);
        } catch {
          notKept++;
        }
        recordSong(mediaId, song, file.name);
        refetched++;
      } catch (e) {
        if (!still()) return;
        console.warn("[studio] song not brought in again:", song.asset, e);
        failed++;
      }
      if (!still()) return;
    }
    for (const song of toImport) {
      try {
        const file = await fetchSong(song, signal);
        if (!still()) return;
        const r = await useProjectStore.getState().importMedia(file);
        if (!r.success || !r.actionId) throw new Error(r.error?.message ?? "could not import");
        recordSong(r.actionId, song, file.name);
        imported++;
        if (!(await kept(r.actionId))) notKept++;
      } catch (e) {
        if (!still()) return;
        console.warn("[studio] song skipped:", song.asset, e);
        failed++;
      }
      if (!still()) return;
    }
    if (imported || refetched) await saveToStudio();
    if (!still()) return;
    const message = songImportMessage({ total, imported, refetched, failed, notKept });
    if (failed || notKept) toast.warning(SONGS_TITLE, message);
    else toast.success(SONGS_TITLE, message);
  } catch (e) {
    if (!still()) return;
    console.warn("[studio] songs:", e);
    toast.error(SONGS_TITLE, e instanceof Error ? e.message : String(e));
  }
}

/**
 * "Import Audio Creations" (the More menu): ask the studio for the project's songs now and
 * bring every one into the media library - see `doSongs`. A second click while songs are
 * still coming in says so rather than starting again; while the editor is opening,
 * rebuilding or exporting it says it is busy.
 */
export function importAudioCreations(): Promise<void> {
  if (!ref()) return Promise.resolve();
  if (songRun) {
    if (songRunMode === "menu") {
      toast.info(SONGS_TITLE, "Songs are already being brought in.");
      return songRun;
    }
    // The open-time run brings in new songs only; the reader asked for the whole look
    // (lost files, deleted songs), so it runs next. One queued run at most.
    menuQueued = true;
    toast.info(SONGS_TITLE, "Will look again once the songs coming in now are in.");
    return songRun;
  }
  const status = get().status;
  if (status !== "ready" && status !== "saving") {
    toast.info(SONGS_TITLE, "The editor is busy - try again in a moment.");
    return Promise.resolve();
  }
  return startMenuRun();
}

function startMenuRun(): Promise<void> {
  toast.info(SONGS_TITLE, "Looking for songs in the studio…");
  return startSongs("menu");
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
  // Only keep mappings for media that still exists in the library - and a tombstone for a
  // song the reader deleted, so reopening the edit does not bring it back.
  const kept = savedMediaMap(media, new Set(full.mediaLibrary.items.map((m) => m.id)));
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
  if (songRun) {
    // Songs still coming in: the export carries the library as it is once they are in.
    set({ status: "exporting", progress: 0, message: "Waiting for songs…", error: null });
    await settleSongs();
  }
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
