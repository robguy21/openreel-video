import { describe, expect, it } from "vitest";
import { rebuildAvcDescription } from "./avc-config";

const hex = (s: string) => new Uint8Array(s.split(" ").map((b) => parseInt(b, 16)));
const withLength = (nal: Uint8Array) => [0, 0, nal.length >> 8, nal.length & 0xff, ...nal];

const sps = hex("67 64 00 28 ac 2c ac 07 80 22 7e 58 40 00 00 03 00 40 00 00 0f 03 68 22 11 4e");
const pps = hex("68 ce 3c 30");
const brokenDescription = hex(
  "01 64 00 28 03 01 00 1b 67 67 64 00 28 ac 2c ac 07 80 22 7e 58 40 00 00 03 00 40 00 00 0f 03 68 22 11 4e 01 00 05 68 68 ce 3c 30",
);
const keyPacket = new Uint8Array([
  ...withLength(hex("09 10")),
  ...withLength(sps),
  ...withLength(pps),
  ...withLength(hex("65 88 80 40")),
]);

describe("rebuildAvcDescription", () => {
  it("rebuilds a malformed encoder avcC from the in-band SPS and PPS", () => {
    const rebuilt = rebuildAvcDescription(keyPacket, brokenDescription);
    expect(rebuilt).toEqual(
      new Uint8Array([
        0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, sps.length, ...sps,
        0x01, 0x00, pps.length, ...pps,
        0xfd, 0xf8, 0xf8, 0x00,
      ]),
    );
  });

  it("returns null when the packet carries no parameter sets", () => {
    const packet = new Uint8Array(withLength(hex("65 88 80 40")));
    expect(rebuildAvcDescription(packet, brokenDescription)).toBeNull();
  });
});
