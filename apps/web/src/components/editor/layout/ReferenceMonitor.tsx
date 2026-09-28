import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import {
  clampClipMark,
  clipMarks,
  useReferenceStore,
  type Marks,
  type ReferenceSource,
} from "../../../stores/reference-store";
import { useStudioStore } from "../../../services/studio/studio-session";
import { mediaPlaybackUrl } from "../../../services/media-playback-url";
import { getPlaybackBridge } from "../../../bridges/playback-bridge";

/**
 * The Reference monitor (docs/PROPOSAL_EDITOR_REDESIGN.md R5): the whole of one source,
 * in a plain `<video>` (an `<audio>` for sound, a picture for a still) - never the
 * engine - with its own transport, marks and scrub bar. It never moves the timeline's
 * playhead and the timeline never moves it; starting either monitor pauses the other,
 * and the keyboard drives whichever monitor was clicked last.
 *
 * What it holds is the reference store's: the part as Stitch cut it by default, a Media
 * item clicked once, or the take behind the selected timeline clip, whose in and out are
 * the marks - so moving a mark trims that clip (R5.5).
 */

export function formatTimecode(seconds: number, fps: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const rate = Math.max(1, Math.round(fps));
  const totalFrames = Math.round(safe * rate);
  const frames = totalFrames % rate;
  const totalSeconds = Math.floor(totalFrames / rate);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(m)}:${two(s)}:${two(frames)}`;
}

/** A failure's first line, short enough to read in a monitor: the studio's job error can
 *  carry a whole ffmpeg log after its sentence. */
export function firstLine(text: string, max = 160): string {
  const line = (text.split("\n").find((l) => l.trim()) ?? "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The header's line: what the monitor holds, and that it is whole. */
export function referenceSubtitle(source: ReferenceSource | null): string {
  if (!source) return "nothing picked";
  if (source.origin === "film") return `${source.name}, the part's cut`;
  return `${source.name}, whole`;
}

const Glyph: React.FC<{ children: React.ReactNode; fill?: boolean }> = ({ children, fill }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const TransportButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
> = ({ label, children, className, ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`or-focus grid h-[34px] w-[34px] place-items-center rounded-pill text-fg-2 hover:text-fg-strong disabled:opacity-40 ${className ?? ""}`}
    {...rest}
  >
    {children}
  </button>
);

export const ReferenceMonitor: React.FC<{ onHide: () => void }> = ({ onHide }) => {
  const source = useReferenceStore((s) => s.source);
  const storedMarks = useReferenceStore((s) => (s.source ? s.marks[s.source.key] : undefined));
  const seekNonce = useReferenceStore((s) => s.seekNonce);
  const focus = useReferenceStore((s) => s.focus);
  const setFocus = useReferenceStore((s) => s.setFocus);
  const setMarks = useReferenceStore((s) => s.setMarks);
  const load = useReferenceStore((s) => s.load);
  const stitchFilm = useStudioStore((s) => s.stitchFilm);
  const stitchMaking = useStudioStore((s) => s.stitchMaking);
  const filmName = useStudioStore((s) => s.name);
  const partLabel = useStudioStore((s) => s.partLabel);
  const project = useProjectStore((s) => s.project);
  const trimClip = useProjectStore((s) => s.trimClip);

  const mediaItem = useMemo(
    () =>
      source?.mediaId
        ? project.mediaLibrary.items.find((m) => m.id === source.mediaId) ?? null
        : null,
    [project.mediaLibrary.items, source?.mediaId],
  );
  const clip = useMemo(() => {
    if (!source?.clipId) return null;
    for (const track of project.timeline.tracks) {
      const found = track.clips.find((c) => c.id === source.clipId);
      if (found) return { clip: found, track };
    }
    return null;
  }, [project.timeline.tracks, source?.clipId]);

  // The address to play: the film's url, or the media item's (an object url is revoked
  // when the item changes or the monitor goes).
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!source) {
      setUrl(null);
      return;
    }
    if (source.url) {
      setUrl(source.url);
      return;
    }
    const made = mediaPlaybackUrl(mediaItem);
    setUrl(made.url);
    return made.revoke;
  }, [source, mediaItem]);

  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(source?.duration ?? 0);
  const [playing, setPlaying] = useState(false);
  const fps = source?.fps || project.settings.frameRate || 24;
  const frame = 1 / fps;
  const kind = source?.kind ?? "video";

  // A clip's marks are the clip itself, read live, so an undo shows here at once.
  const marks: Marks = useMemo(
    () => (clip ? clipMarks(clip.clip) : storedMarks ?? { in: null, out: null }),
    [clip, storedMarks],
  );
  const isClip = Boolean(clip);

  // Start where the source asks (a clip's current frame), each time it is loaded.
  useEffect(() => {
    const el = mediaRef.current;
    setPlaying(false);
    setDuration(source?.duration ?? 0);
    const start = source?.startAt ?? 0;
    setTime(start);
    if (!el) return;
    const seek = () => {
      el.currentTime = start;
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener("loadedmetadata", seek, { once: true });
  }, [seekNonce, source, url]);

  // The time shown follows the player; a frame loop keeps it smooth while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const el = mediaRef.current;
      if (el) setTime(el.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Starting the Edit monitor pauses this one.
  useEffect(
    () =>
      useTimelineStore.subscribe((state, prev) => {
        if (state.playbackState === "playing" && prev.playbackState !== "playing") {
          mediaRef.current?.pause();
        }
      }),
    [],
  );

  const seek = useCallback(
    (t: number) => {
      const el = mediaRef.current;
      const end = duration || el?.duration || 0;
      const next = Math.min(Math.max(t, 0), end || t);
      if (el) el.currentTime = next;
      setTime(next);
    },
    [duration],
  );

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el || kind === "image") return;
    if (el.paused) {
      // Starting this monitor pauses the Edit monitor.
      try {
        getPlaybackBridge().pause();
      } catch {
        useTimelineStore.getState().pause();
      }
      void el.play();
    } else {
      el.pause();
    }
  }, [kind]);

  const step = useCallback(
    (frames: number) => {
      mediaRef.current?.pause();
      seek(Math.round((time + frames * frame) / frame) * frame);
    },
    [frame, seek, time],
  );

  const markAt = useCallback(
    async (which: "in" | "out") => {
      if (!source || kind === "image") return;
      const at = Math.round(time / frame) * frame;
      if (clip) {
        const sourceDuration = mediaItem?.metadata?.duration || duration || Infinity;
        const value = clampClipMark(which, at, clip.clip, clip.track.clips, sourceDuration, frame);
        if (value === null) return;
        await trimClip(clip.clip.id, which === "in" ? value : undefined, which === "out" ? value : undefined);
        return;
      }
      const next: Marks = { ...marks, [which]: at };
      // A mark that crosses the other one clears it.
      if (next.in !== null && next.out !== null && next.out <= next.in) {
        if (which === "in") next.out = null;
        else next.in = null;
      }
      setMarks(source.key, next);
    },
    [clip, duration, frame, kind, marks, mediaItem, setMarks, source, time, trimClip],
  );

  const fullScreen = useCallback(() => {
    void frameRef.current?.requestFullscreen?.();
  }, []);

  // The keyboard drives the monitor clicked last (R5.4): Space or K plays, the arrows
  // step a frame, I and O mark. Only while this monitor has it, and never in a field.
  useEffect(() => {
    if (focus !== "reference") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      let handled = true;
      if (key === " " || key === "k") togglePlay();
      else if (key === "arrowleft") step(-1);
      else if (key === "arrowright") step(1);
      else if (key === "i") void markAt("in");
      else if (key === "o") void markAt("out");
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [focus, markAt, step, togglePlay]);

  const length = duration || mediaItem?.metadata?.duration || 0;
  const pct = (t: number | null) => (t === null || !length ? null : Math.min(100, Math.max(0, (t / length) * 100)));
  const inPct = pct(marks.in);
  const outPct = pct(marks.out);
  const nowPct = pct(time) ?? 0;
  const spanFrom = inPct ?? 0;
  const spanTo = outPct ?? 100;
  const hasMarks = marks.in !== null || marks.out !== null;

  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubTo = (clientX: number) => {
    const bar = scrubRef.current;
    if (!bar || !length) return;
    const r = bar.getBoundingClientRect();
    seek(((clientX - r.left) / r.width) * length);
  };

  const film =
    stitchFilm && {
      key: "film",
      origin: "film" as const,
      name: partLabel ? `${filmName} · ${partLabel}` : filmName,
      kind: "video" as const,
      url: stitchFilm.url,
      duration: stitchFilm.duration,
      fps: stitchFilm.fps,
    };

  const empty = !source || !url;

  return (
    <section
      aria-label="Reference monitor"
      onPointerDownCapture={() => setFocus("reference")}
      className={`or-glass flex min-h-0 min-w-0 flex-col overflow-hidden ${
        focus === "reference" ? "outline outline-1 outline-[color:var(--glass-border)]" : ""
      }`}
    >
      <div className="flex h-[52px] shrink-0 items-center gap-2 pl-5 pr-3">
        <span
          className={`h-[7px] w-[7px] shrink-0 rounded-full ${focus === "reference" ? "bg-[color:var(--ring-color)]" : "bg-transparent"}`}
          aria-hidden="true"
        />
        <h2 className="text-[13px] font-semibold text-fg-strong">Reference</h2>
        <span className="min-w-0 truncate text-[12px] text-fg-2" title={referenceSubtitle(source)}>
          {referenceSubtitle(source)}
        </span>
        <div className="flex-1" />
        {film && source?.origin !== "film" && (
          <button
            type="button"
            onClick={() => load(film)}
            className="or-control or-focus h-[30px] shrink-0 px-3 text-[12px]"
            title="Show the part's cut"
          >
            Film
          </button>
        )}
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide the Reference monitor"
          title="Hide the Reference monitor"
          className="or-focus grid h-[30px] w-[30px] shrink-0 place-items-center rounded-pill text-fg-3 hover:text-fg-2"
        >
          <Glyph>
            <path d="M4 12h16" />
          </Glyph>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-3.5 pb-3 pt-0.5">
        <div
          ref={frameRef}
          className="or-field flex h-full w-full items-center justify-center overflow-hidden p-1.5"
          style={{ borderRadius: 20 }}
        >
          {empty ? (
            <p className="max-w-[260px] text-center text-[12px] leading-relaxed text-fg-3" aria-live="polite">
              {stitchMaking?.failed
                ? `The part's cut could not be made: ${firstLine(stitchMaking.failed)}`
                : stitchMaking
                  ? `Making the part's cut for the Reference… ${Math.round(stitchMaking.progress * 100)}%`
                  : "Pick a clip on the timeline or an item in Media to see its whole source here."}
            </p>
          ) : kind === "image" ? (
            <img src={url} alt={source?.name ?? ""} className="max-h-full max-w-full rounded-picture object-contain" />
          ) : kind === "audio" ? (
            <div className="flex w-full flex-col items-center gap-3 px-6">
              <div className="flex h-16 w-full items-center gap-[2px]" aria-hidden="true">
                {Array.from({ length: 48 }, (_, i) => {
                  const w = mediaItem?.waveformData;
                  const v = w && w.length ? Math.abs(w[Math.floor((i / 48) * w.length)] ?? 0) : 0.3;
                  return (
                    <span
                      key={i}
                      className="flex-1 rounded-sm bg-waveform"
                      style={{ height: `${Math.max(6, Math.min(100, v * 100))}%`, opacity: (i / 48) * 100 < nowPct ? 1 : 0.45 }}
                    />
                  );
                })}
              </div>
              <audio
                ref={mediaRef}
                src={url}
                preload="metadata"
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                onPlay={() => setPlaying(true)}
                onPause={() => {
                  setPlaying(false);
                  setTime(mediaRef.current?.currentTime ?? 0);
                }}
                onSeeked={(e) => setTime(e.currentTarget.currentTime)}
              />
            </div>
          ) : (
            <video
              ref={mediaRef}
              src={url}
              preload="auto"
              playsInline
              className="max-h-full max-w-full rounded-picture object-contain"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              onPlay={() => setPlaying(true)}
              onPause={() => {
                setPlaying(false);
                setTime(mediaRef.current?.currentTime ?? 0);
              }}
              onSeeked={(e) => setTime(e.currentTarget.currentTime)}
              onClick={togglePlay}
            />
          )}
        </div>
      </div>

      {kind !== "image" && (
        <div className="shrink-0 px-5 pt-0.5">
          <div
            ref={scrubRef}
            role="slider"
            aria-label="Reference position"
            aria-valuemin={0}
            aria-valuemax={Math.round(length * 1000) / 1000}
            aria-valuenow={Math.round(time * 1000) / 1000}
            aria-valuetext={formatTimecode(time, fps)}
            tabIndex={0}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              scrubTo(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) scrubTo(e.clientX);
            }}
            className="relative h-1.5 cursor-pointer rounded-pill bg-[rgba(0,0,0,0.35)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
          >
            {hasMarks && (
              <div
                className="absolute bottom-0 top-0 bg-[rgba(127,168,255,0.3)]"
                style={{ left: `${spanFrom}%`, width: `${Math.max(0, spanTo - spanFrom)}%` }}
              />
            )}
            {inPct !== null && (
              <div className="absolute -top-[5px] h-4 w-0.5 rounded-sm bg-accent-text" style={{ left: `${inPct}%` }} />
            )}
            {outPct !== null && (
              <div className="absolute -top-[5px] h-4 w-0.5 rounded-sm bg-accent-text" style={{ left: `calc(${outPct}% - 2px)` }} />
            )}
            <div
              className="absolute -top-[5px] h-4 w-4 rounded-full bg-fg-strong shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
              style={{ left: `calc(${nowPct}% - 8px)` }}
            />
          </div>
          <div className="mt-2 flex justify-between gap-2 text-[11px] text-fg-3">
            <span>{marks.in !== null ? `In ${formatTimecode(marks.in, fps)}` : "No In"}</span>
            <span className="truncate">
              {isClip ? "the part the film keeps" : hasMarks ? "marked" : "the whole source"}
            </span>
            <span>{marks.out !== null ? `Out ${formatTimecode(marks.out, fps)}` : "No Out"}</span>
          </div>
        </div>
      )}

      {/* Three columns, the outer two equal, so the transport is centred under the picture
          whatever sits either side of it. */}
      <div className="grid h-[58px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 px-4 pb-1">
        <div className="flex min-w-0 items-baseline gap-1 whitespace-nowrap font-mono text-[11px] tracking-tight">
          <span className="text-fg-strong">{formatTimecode(time, fps)}</span>
          <span className="truncate text-fg-3">/ {formatTimecode(length, fps)}</span>
        </div>
        <div className="flex items-center justify-center gap-0.5">
          <TransportButton label="Mark in (I)" onClick={() => void markAt("in")} disabled={empty || kind === "image"}>
            <Glyph>
              <path d="M10 4H6v16h4" />
            </Glyph>
          </TransportButton>
          <TransportButton label="Back one frame" onClick={() => step(-1)} disabled={empty || kind === "image"}>
            <Glyph fill>
              <path d="M6 5h2v14H6zM20 5v14L9 12z" />
            </Glyph>
          </TransportButton>
          <button
            type="button"
            aria-label={playing ? "Pause the reference" : "Play the reference"}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            onClick={togglePlay}
            disabled={empty || kind === "image"}
            className="or-control or-focus grid h-[42px] w-[42px] place-items-center !rounded-full disabled:opacity-40"
          >
            <Glyph fill>{playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}</Glyph>
          </button>
          <TransportButton label="Forward one frame" onClick={() => step(1)} disabled={empty || kind === "image"}>
            <Glyph fill>
              <path d="M16 5h2v14h-2zM4 5v14l11-7z" />
            </Glyph>
          </TransportButton>
          <TransportButton label="Mark out (O)" onClick={() => void markAt("out")} disabled={empty || kind === "image"}>
            <Glyph>
              <path d="M14 4h4v16h-4" />
            </Glyph>
          </TransportButton>
        </div>
        <div className="flex justify-end">
          <TransportButton label="Full screen" onClick={fullScreen} disabled={empty}>
            <Glyph>
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </Glyph>
          </TransportButton>
        </div>
      </div>
    </section>
  );
};
