/**
 * Minimal PCM WAV reading and writing.
 *
 * Every engine in the pipeline wants 16 kHz mono 16-bit audio. Slicing a chunk
 * out of samples already in memory is exact to the sample, where asking ffmpeg
 * to seek inside a WAV lands on its own rounding — and a chunk that starts a
 * few milliseconds off shifts every word timestamp inside it by the same amount.
 */

export interface PcmAudio {
  samples: Int16Array;
  sampleRate: number;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/** Reads a 16-bit PCM WAV, downmixing to mono. Returns null for anything else. */
export const parseWavPcm16 = (bytes: Uint8Array): PcmAudio | null => {
  if (bytes.length < 44) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataStart = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ' && body + 16 <= bytes.length) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // the real format code of an extensible header lives in its sub-format GUID
      if (format === WAVE_FORMAT_EXTENSIBLE && size >= 26 && body + 26 <= bytes.length) {
        format = view.getUint16(body + 24, true);
      }
    } else if (id === 'data') {
      dataStart = body;
      // a WAV written to a pipe declares 0xFFFFFFFF bytes; trust the file instead
      dataLength = Math.min(size, bytes.length - body);
      break;
    }

    offset = body + size + (size % 2);
  }

  if (format !== WAVE_FORMAT_PCM || bits !== 16 || channels < 1 || sampleRate <= 0 || dataStart < 0) {
    return null;
  }

  const frames = Math.floor(dataLength / (2 * channels));
  const samples = new Int16Array(frames);

  if (channels === 1) {
    for (let i = 0; i < frames; i++) samples[i] = view.getInt16(dataStart + i * 2, true);
  } else {
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += view.getInt16(dataStart + (i * channels + c) * 2, true);
      samples[i] = Math.round(sum / channels);
    }
  }

  return { samples, sampleRate };
};

/** A mono 16-bit PCM WAV file holding these samples. */
export const encodeWavPcm16 = (samples: Int16Array, sampleRate: number): Uint8Array => {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };

  write(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  return out;
};

/** The samples between two times, as a view rather than a copy. */
export const sliceSeconds = (audio: PcmAudio, start: number, end: number): Int16Array => {
  const from = Math.max(0, Math.floor(start * audio.sampleRate));
  const to = Math.min(audio.samples.length, Math.ceil(end * audio.sampleRate));
  return audio.samples.subarray(from, Math.max(from, to));
};

export const durationOf = (audio: PcmAudio): number =>
  audio.sampleRate > 0 ? audio.samples.length / audio.sampleRate : 0;
