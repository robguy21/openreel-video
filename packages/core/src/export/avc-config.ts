const NAL_SPS = 7;
const NAL_PPS = 8;
const HIGH_PROFILES = [100, 110, 122, 144];

function toBytes(source: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
}

function readChromaFields(sps: Uint8Array): [number, number, number] | null {
  const rbsp: number[] = [];
  for (let i = 1; i < sps.length; i++) {
    if (i >= 3 && sps[i] === 3 && sps[i - 1] === 0 && sps[i - 2] === 0) continue;
    rbsp.push(sps[i]);
  }
  let bit = 24;
  const readBit = () => {
    if (bit >= rbsp.length * 8) throw new Error("SPS truncated");
    const value = (rbsp[bit >> 3] >> (7 - (bit & 7))) & 1;
    bit++;
    return value;
  };
  const readUe = () => {
    let zeros = 0;
    while (readBit() === 0) zeros++;
    let value = 0;
    for (let i = 0; i < zeros; i++) value = value * 2 + readBit();
    return 2 ** zeros - 1 + value;
  };
  try {
    readUe();
    const chromaFormat = readUe();
    if (chromaFormat === 3) readBit();
    return [chromaFormat, readUe(), readUe()];
  } catch {
    return null;
  }
}

export function rebuildAvcDescription(
  packet: Uint8Array,
  description: AllowSharedBufferSource,
): Uint8Array | null {
  const current = toBytes(description);
  if (current.length < 5) return null;
  const lengthSize = (current[4] & 3) + 1;

  const spsList: Uint8Array[] = [];
  const ppsList: Uint8Array[] = [];
  let offset = 0;
  while (offset + lengthSize <= packet.length) {
    let size = 0;
    for (let i = 0; i < lengthSize; i++) size = size * 256 + packet[offset + i];
    offset += lengthSize;
    if (size === 0 || offset + size > packet.length) return null;
    const nal = packet.subarray(offset, offset + size);
    const type = nal[0] & 0x1f;
    if (type === NAL_SPS) spsList.push(nal);
    else if (type === NAL_PPS) ppsList.push(nal);
    offset += size;
  }
  if (spsList.length === 0 || ppsList.length === 0 || spsList[0].length < 4) return null;

  const sps = spsList[0];
  const bytes: number[] = [1, sps[1], sps[2], sps[3], 0xfc | (lengthSize - 1), 0xe0 | spsList.length];
  for (const nal of spsList) bytes.push(nal.length >> 8, nal.length & 0xff, ...nal);
  bytes.push(ppsList.length);
  for (const nal of ppsList) bytes.push(nal.length >> 8, nal.length & 0xff, ...nal);

  if (HIGH_PROFILES.includes(sps[1])) {
    const chroma = readChromaFields(sps);
    if (!chroma) return null;
    bytes.push(0xfc | chroma[0], 0xf8 | chroma[1], 0xf8 | chroma[2], 0);
  }
  return new Uint8Array(bytes);
}
