import { CODEC_MAP, type VideoExportSettings, type AudioExportSettings, type ExportError } from "./types";
import type { Project } from "../types/project";
import type { EncoderBackend } from "./encoder-backend";
import { rebuildAvcDescription } from "./avc-config";

type MediaBunnyModule = typeof import("mediabunny");
type AudioBufferSourceInstance = InstanceType<MediaBunnyModule["AudioBufferSource"]>;
type VideoSampleSourceInstance = InstanceType<MediaBunnyModule["VideoSampleSource"]>;
type OutputInstance = InstanceType<MediaBunnyModule["Output"]>;
type HardwarePreference = "prefer-hardware" | "prefer-software" | "no-preference";
type VideoCodecName = Parameters<
  MediaBunnyModule["getFirstEncodableVideoCodec"]
>[0][number];

export interface WebCodecsBackendOptions {
  hardwareAcceleration?: HardwarePreference;
  videoCodecs?: VideoCodecName[];
  // The resolution clamp (export-engine) exists to bound browser-tab memory.
  // On desktop, frames stream to disk one at a time and the hardware encoder
  // handles high resolutions, so callers can opt out to export at full size.
  clampResolution?: boolean;
}

export class WebCodecsBackend implements EncoderBackend {
  readonly requiresWebCodecsClamping: boolean;
  readonly needsFrameThrottling = true;
  readonly normalizesProResToH264 = true;
  readonly audioBeforeVideo = true;

  private readonly mediabunny: MediaBunnyModule;
  private readonly hardwareAcceleration: HardwarePreference;
  private readonly videoCodecPreference?: VideoCodecName[];
  private output: OutputInstance | null = null;
  private videoSource: VideoSampleSourceInstance | null = null;
  private audioSource: AudioBufferSourceInstance | null = null;
  private writableStream: FileSystemWritableFileStream | null = null;
  private bytesWritten = 0;

  constructor(mediabunny: MediaBunnyModule, options?: WebCodecsBackendOptions) {
    this.mediabunny = mediabunny;
    this.hardwareAcceleration = options?.hardwareAcceleration ?? "prefer-hardware";
    this.videoCodecPreference = options?.videoCodecs;
    this.requiresWebCodecsClamping = options?.clampResolution ?? true;
  }

  getBytesWritten(): number {
    return this.bytesWritten;
  }

  async start(
    settings: VideoExportSettings,
    project: Project,
    writableStream?: FileSystemWritableFileStream,
    durationSec?: number,
  ): Promise<void> {
    if (!writableStream) {
      throw new Error("No writable stream provided. Export requires a file destination.");
    }

    const {
      Output,
      StreamTarget,
      Mp4OutputFormat,
      WebMOutputFormat,
      MovOutputFormat,
      VideoSampleSource,
      AudioBufferSource,
      getFirstEncodableVideoCodec,
      QUALITY_MEDIUM,
    } = this.mediabunny;

    this.writableStream = writableStream;
    const diskWriter = writableStream;
    const self = this;
    const chunkWriter = new WritableStream<{ data: Uint8Array; position: number }>({
      async write(chunk) {
        await diskWriter.seek(chunk.position);
        await diskWriter.write(chunk.data as unknown as FileSystemWriteChunkType);
        self.bytesWritten += chunk.data.byteLength;
      },
    });

    const fastStart = durationSec ? "reserve" : "in-memory";
    let outputFormat;
    switch (settings.format) {
      case "webm":
        outputFormat = new WebMOutputFormat();
        break;
      case "mov":
        outputFormat = new MovOutputFormat({ fastStart });
        break;
      case "mp4":
      default:
        outputFormat = new Mp4OutputFormat({ fastStart });
        break;
    }

    const target = new StreamTarget(chunkWriter, {
      chunked: true,
      chunkSize: 4 * 1024 * 1024,
    });
    const output = new Output({ format: outputFormat, target });

    const supportedVideoCodecs = outputFormat.getSupportedVideoCodecs();
    const requestedVideoCodec = CODEC_MAP[settings.codec] as VideoCodecName | undefined;
    const requestedVideoCodecs =
      this.videoCodecPreference ?? (requestedVideoCodec ? [requestedVideoCodec] : []);
    const preferredVideoCodecs = requestedVideoCodecs.filter((codec) =>
      supportedVideoCodecs.includes(codec),
    );
    const videoCodecCandidates =
      preferredVideoCodecs && preferredVideoCodecs.length > 0
        ? [
            ...preferredVideoCodecs,
            ...supportedVideoCodecs.filter(
              (codec: VideoCodecName) => !preferredVideoCodecs.includes(codec),
            ),
          ]
        : supportedVideoCodecs;
    const targetVideoBitrate = settings.bitrate ? settings.bitrate * 1000 : QUALITY_MEDIUM;
    const hardwarePreferences: HardwarePreference[] =
      this.hardwareAcceleration === "no-preference"
        ? ["no-preference"]
        : [this.hardwareAcceleration, "no-preference"];
    let selectedHardwareAcceleration: HardwarePreference = "no-preference";
    let videoCodec: VideoCodecName | null = null;

    for (const hardwareAcceleration of hardwarePreferences) {
      const encodeOptions = {
        width: settings.width,
        height: settings.height,
        bitrate: targetVideoBitrate,
        hardwareAcceleration,
      } as unknown as Parameters<typeof getFirstEncodableVideoCodec>[1];
      videoCodec = await getFirstEncodableVideoCodec(videoCodecCandidates, encodeOptions);
      if (videoCodec) {
        selectedHardwareAcceleration = hardwareAcceleration;
        break;
      }
    }

    if (!videoCodec) {
      const error: ExportError = {
        code: "UNSUPPORTED_CODEC",
        message: "No supported video codec found",
        phase: "preparing",
        recoverable: false,
      };
      throw error;
    }

    const audioCodecResult = await this.findSupportedAudioCodec(
      outputFormat,
      settings.audioSettings,
      settings.format === "webm",
    );

    const videoSource = new VideoSampleSource({
      codec: videoCodec,
      bitrate: targetVideoBitrate,
      keyFrameInterval: settings.keyframeInterval / settings.frameRate,
      hardwareAcceleration: selectedHardwareAcceleration,
      onEncodedPacket: (packet, meta) => {
        const description = meta?.decoderConfig?.description;
        if (videoCodec !== "avc" || packet.type !== "key" || !description) return;
        const rebuilt = rebuildAvcDescription(packet.data, description);
        if (rebuilt) meta.decoderConfig!.description = rebuilt;
      },
    });
    const audioSource = new AudioBufferSource({
      codec: audioCodecResult.codec as "aac" | "opus" | "mp3",
      bitrate: audioCodecResult.bitrate,
    });
    output.addVideoTrack(
      videoSource,
      durationSec ? { maximumPacketCount: Math.ceil(durationSec * settings.frameRate) + 64 } : undefined,
    );
    output.addAudioTrack(
      audioSource,
      durationSec ? { maximumPacketCount: Math.ceil(durationSec * 100) + 256 } : undefined,
    );
    output.setMetadataTags({
      title: project.name,
      date: new Date(),
    });

    await output.start();

    this.output = output;
    this.videoSource = videoSource;
    this.audioSource = audioSource;
  }

  async addAudioBuffer(buffer: AudioBuffer): Promise<void> {
    if (!this.audioSource) {
      throw new Error("Encoder backend not started");
    }
    await this.audioSource.add(buffer);
  }

  async closeAudio(): Promise<void> {
    this.audioSource?.close();
  }

  async addVideoFrame(
    frame: ImageBitmap,
    timestampSec: number,
    durationSec: number,
  ): Promise<void> {
    if (!this.videoSource) {
      throw new Error("Encoder backend not started");
    }
    const { VideoSample } = this.mediabunny;
    const videoSample = new VideoSample(frame, {
      timestamp: timestampSec,
      duration: durationSec,
    });

    await this.videoSource.add(videoSample);
    videoSample.close();
    frame.close();
  }

  async finalize(): Promise<void> {
    this.videoSource?.close();
    await this.output?.finalize();
    await this.writableStream?.close();
  }

  async abort(): Promise<void> {
    try {
      await this.writableStream?.abort();
    } catch {}
  }

  private async findSupportedAudioCodec(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputFormat: { getSupportedAudioCodecs: () => any[] },
    audioSettings: AudioExportSettings,
    isWebm: boolean,
  ): Promise<{ codec: string; bitrate: number }> {
    const { canEncodeAudio } = this.mediabunny;
    const options = {
      numberOfChannels: audioSettings.channels,
      sampleRate: audioSettings.sampleRate,
    };

    if (!isWebm && !(await canEncodeAudio("aac", options))) {
      const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
      registerAacEncoder();
    }

    const candidates: string[] = isWebm ? outputFormat.getSupportedAudioCodecs() : ["aac"];
    const bitrates = [audioSettings.bitrate * 1000, 192000, 128000, 96000].filter(
      (b, i, arr) => arr.indexOf(b) === i,
    );

    for (const codec of candidates) {
      for (const bitrate of bitrates) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (await canEncodeAudio(codec as any, { ...options, bitrate })) {
          return { codec, bitrate };
        }
      }
    }

    const error: ExportError = {
      code: "UNSUPPORTED_CODEC",
      message: "No supported audio codec found",
      phase: "preparing",
      recoverable: false,
    };
    throw error;
  }
}
