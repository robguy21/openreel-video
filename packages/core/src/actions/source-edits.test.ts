import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Project } from "../types/project";
import type { Action } from "../types/actions";

/**
 * Insert and Overwrite (docs/PROPOSAL_EDITOR_REDESIGN.md R7): a studio film's shape -
 * Shots with two linked shot sounds under them, and a Narration clip crossing the cut.
 *
 *   Shots       [ s1 0-4 ][ s2 4-10 ]
 *   Shot sound  [ a1 0-4 ][ a2 4-10 ]     (s1-a1, s2-a2 linked)
 *   Narration        [ n 3-6 ]
 */

function clip(id: string, trackId: string, startTime: number, duration: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    mediaId: `m-${id}`,
    trackId,
    startTime,
    duration,
    inPoint: 1,
    outPoint: 1 + duration,
    effects: [],
    audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 },
    volume: 1,
    keyframes: [],
    ...extra,
  };
}

function film(): Project {
  const track = (id: string, type: string, name: string, clips: unknown[], transitions: unknown[] = []) => ({
    id, type, name, clips, transitions, locked: false, hidden: false, muted: false, solo: false,
  });
  const ids = ["s1", "s2", "a1", "a2", "n", "src", "src-sound"];
  return {
    id: "p", name: "Film", createdAt: 0, modifiedAt: 0,
    settings: { width: 1080, height: 1920, frameRate: 24, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 10, subtitles: [], markers: [],
      tracks: [
        track("shots", "video", "Shots", [
          clip("s1", "shots", 0, 4, { linkedClipId: "a1" }),
          clip("s2", "shots", 4, 6, { linkedClipId: "a2" }),
        ], [{ id: "x", clipAId: "s1", clipBId: "s2", type: "crossfade", duration: 0.5, params: {} }]),
        track("sound", "audio", "Shot sound", [
          clip("a1", "sound", 0, 4, { linkedClipId: "s1" }),
          clip("a2", "sound", 4, 6, { linkedClipId: "s2" }),
        ]),
        track("narr", "audio", "Narration", [clip("n", "narr", 3, 3)]),
      ],
    },
    mediaLibrary: { items: ids.map((id) => ({ id: `m-${id}`, name: id, type: "video", metadata: { duration: 20 } })) },
  } as unknown as Project;
}

const span = (at: number, extra: Record<string, unknown> = {}) => ({
  at,
  clips: [
    { clipId: "new-pic", trackId: "shots", mediaId: "m-src", inPoint: 2, outPoint: 4 },
    { clipId: "new-snd", trackId: "sound", mediaId: "m-src-sound", inPoint: 2, outPoint: 4 },
  ],
  ...extra,
});
const act = (type: string, params: Record<string, unknown>, id = type) =>
  ({ id, type, timestamp: Date.now(), params }) as unknown as Action;

/** Each track's clips as "id@start+duration[in]->partner", in time order. */
function layout(p: Project): Record<string, string[]> {
  return Object.fromEntries(
    p.timeline.tracks.map((t) => [
      t.name,
      [...t.clips]
        .sort((a, b) => a.startTime - b.startTime)
        .map((c) => `${c.id}@${+c.startTime.toFixed(3)}+${+c.duration.toFixed(3)}[${+c.inPoint.toFixed(3)}]${c.linkedClipId ? `->${c.linkedClipId}` : ""}`),
    ]),
  );
}

describe("clip/insertEdit", () => {
  it("at a cut: places the linked pair and moves everything after it right on every track", async () => {
    const p = film();
    const ex = new ActionExecutor();
    expect((await ex.execute(act("clip/insertEdit", span(4)), p)).success).toBe(true);
    expect(layout(p)).toEqual({
      Shots: ["s1@0+4[1]->a1", "new-pic@4+2[2]->new-snd", "s2@6+6[1]->a2"],
      "Shot sound": ["a1@0+4[1]->s1", "new-snd@4+2[2]->new-pic", "a2@6+6[1]->s2"],
      // the narration crossing the playhead is cut there, and its second half moves on
      Narration: expect.arrayContaining(["n@3+1[1]"]) as unknown as string[],
    });
    const narr = layout(p).Narration;
    expect(narr).toHaveLength(2);
    expect(narr[1]).toMatch(/@6\+2\[2\]$/);
  });

  it("mid-shot: cuts the shot and its sound, and links the two right-hand pieces", async () => {
    const p = film();
    const ex = new ActionExecutor();
    await ex.execute(act("clip/insertEdit", span(6)), p);
    const l = layout(p);
    expect(l.Shots[1]).toBe("s2@4+2[1]->a2");
    expect(l.Shots[2]).toBe("new-pic@6+2[2]->new-snd");
    const right = l.Shots[3];
    const rightSound = l["Shot sound"][3];
    expect(right).toMatch(/@8\+4\[3\]->/);
    expect(rightSound).toMatch(/@8\+4\[3\]->/);
    // each right-hand piece names the other
    const id = (s: string) => s.split("@")[0];
    expect(right.endsWith(`->${id(rightSound)}`)).toBe(true);
    expect(rightSound.endsWith(`->${id(right)}`)).toBe(true);
  });

  it("is one undo step that puts every track back exactly, and redo makes the same clips", async () => {
    const p = film();
    const before = JSON.stringify(p.timeline.tracks);
    const ex = new ActionExecutor();
    await ex.execute(act("clip/insertEdit", span(6)), p);
    const after = JSON.stringify(p.timeline.tracks);
    await ex.undo(p);
    expect(JSON.stringify(p.timeline.tracks)).toBe(before);
    await ex.redo(p);
    expect(JSON.stringify(p.timeline.tracks)).toBe(after);
  });
});

describe("clip/overwriteEdit", () => {
  it("covers the span on the target tracks only and moves nothing", async () => {
    const p = film();
    const ex = new ActionExecutor();
    expect((await ex.execute(act("clip/overwriteEdit", span(3)), p)).success).toBe(true);
    expect(layout(p)).toEqual({
      Shots: ["s1@0+3[1]->a1", "new-pic@3+2[2]->new-snd", "s2@5+5[2]->a2"],
      "Shot sound": ["a1@0+3[1]->s1", "new-snd@3+2[2]->new-pic", "a2@5+5[2]->s2"],
      Narration: ["n@3+3[1]"],
    });
    // the transition between the two shots is kept: both its clips are still there
    expect(p.timeline.tracks[0].transitions).toHaveLength(1);
  });

  it("inside one shot: cuts it in two around the span and links the pieces after it", async () => {
    const p = film();
    const ex = new ActionExecutor();
    await ex.execute(act("clip/overwriteEdit", span(5)), p);
    const l = layout(p);
    expect(l.Shots[1]).toBe("s2@4+1[1]->a2");
    expect(l.Shots[2]).toBe("new-pic@5+2[2]->new-snd");
    expect(l.Shots[3]).toMatch(/@7\+3\[4\]->/);
    expect(l["Shot sound"][3]).toMatch(/@7\+3\[4\]->/);
  });

  it("removes what it covers whole, and drops the transition and links that pointed at it", async () => {
    const p = film();
    const ex = new ActionExecutor();
    await ex.execute(
      act("clip/overwriteEdit", {
        at: 0,
        clips: [{ clipId: "long", trackId: "shots", mediaId: "m-src", inPoint: 0, outPoint: 5 }],
      }),
      p,
    );
    const l = layout(p);
    expect(l.Shots).toEqual(["long@0+5[0]", "s2@5+5[2]->a2"]);
    // a1's picture is gone, so a1 is nobody's partner now
    expect(l["Shot sound"][0]).toBe("a1@0+4[1]");
    expect(p.timeline.tracks[0].transitions).toHaveLength(0);
    await ex.undo(p);
    expect(layout(p).Shots).toEqual(["s1@0+4[1]->a1", "s2@4+6[1]->a2"]);
    expect(p.timeline.tracks[0].transitions).toHaveLength(1);
  });

  it("refuses a span with no length, a locked track, an unknown source or a reused id", async () => {
    const ex = new ActionExecutor();
    const bad = async (params: Record<string, unknown>) =>
      (await ex.execute(act("clip/overwriteEdit", params), film())).success;
    expect(await bad({ at: 0, clips: [{ clipId: "q", trackId: "shots", mediaId: "m-src", inPoint: 3, outPoint: 3 }] })).toBe(false);
    expect(await bad({ at: 0, clips: [{ clipId: "q", trackId: "nope", mediaId: "m-src", inPoint: 0, outPoint: 1 }] })).toBe(false);
    expect(await bad({ at: 0, clips: [{ clipId: "q", trackId: "shots", mediaId: "m-none", inPoint: 0, outPoint: 1 }] })).toBe(false);
    expect(await bad({ at: 0, clips: [{ clipId: "s1", trackId: "shots", mediaId: "m-src", inPoint: 0, outPoint: 1 }] })).toBe(false);
    const locked = film();
    (locked.timeline.tracks[0] as { locked: boolean }).locked = true;
    expect((await ex.execute(act("clip/overwriteEdit", span(0), "l"), locked)).success).toBe(false);
  });
});
