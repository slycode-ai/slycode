/**
 * WebM/Opus → OGG/Opus remuxer (pure JS, no ffmpeg).
 *
 * Extracts Opus packets from a WebM container and wraps them in a valid
 * OGG Opus stream per RFC 7845. Only handles single-track audio-only WebM
 * from browser MediaRecorder — not arbitrary Matroska files.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Decoder: EbmlDecoder } = require('ebml');

// --- OGG CRC-32 (polynomial 0x04C11DB7, no bit reversal) ---

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let j = 0; j < 8; j++) {
    r = r & 0x80000000 ? ((r << 1) ^ 0x04C11DB7) : (r << 1);
    r = r >>> 0; // keep unsigned 32-bit
  }
  crcTable[i] = r;
}

function oggCrc32(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ crcTable[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
  }
  return crc;
}

// --- Opus packet duration parsing ---

function getOpusPacketDuration48k(packet: Uint8Array): number {
  if (packet.length < 1) return 960; // fallback: 20ms

  const toc = packet[0];
  const config = (toc >> 3) & 0x1f;
  const frameCountCode = toc & 0x03;

  // Frame size in 48kHz samples based on config number
  let frameSamples: number;
  if (config <= 11) {
    // SILK: 10ms, 20ms, 40ms, 60ms
    frameSamples = [480, 960, 1920, 2880][config % 4];
  } else if (config <= 15) {
    // Hybrid: 10ms, 20ms
    frameSamples = [480, 960][(config - 12) % 2];
  } else {
    // CELT: 2.5ms, 5ms, 10ms, 20ms
    frameSamples = [120, 240, 480, 960][(config - 16) % 4];
  }

  // Number of frames per packet
  let frameCount: number;
  switch (frameCountCode) {
    case 0: frameCount = 1; break;
    case 1: frameCount = 2; break;
    case 2: frameCount = 2; break;
    case 3:
      frameCount = packet.length >= 2 ? (packet[1] & 0x3f) : 1;
      break;
    default: frameCount = 1;
  }

  return frameSamples * frameCount;
}

// --- OGG page writer ---

function writeOggPage(
  serialNumber: number,
  sequenceNumber: number,
  granulePosition: bigint,
  flags: number, // 0x02 = BOS, 0x04 = EOS, 0x01 = continued
  packets: Uint8Array[],
): Buffer {
  // Build segment table: each packet is split into 255-byte segments + remainder
  const segmentSizes: number[] = [];
  for (const pkt of packets) {
    let remaining = pkt.length;
    while (remaining >= 255) {
      segmentSizes.push(255);
      remaining -= 255;
    }
    segmentSizes.push(remaining); // final segment (0-254), 0 means exactly N*255 bytes
  }

  const payloadSize = packets.reduce((sum, p) => sum + p.length, 0);
  const headerSize = 27 + segmentSizes.length;
  const pageSize = headerSize + payloadSize;
  const page = Buffer.alloc(pageSize);

  // Capture pattern
  page.write('OggS', 0);
  // Version
  page[4] = 0;
  // Header type flags
  page[5] = flags;
  // Granule position (64-bit little-endian)
  page.writeBigInt64LE(granulePosition, 6);
  // Serial number
  page.writeUInt32LE(serialNumber, 14);
  // Page sequence number
  page.writeUInt32LE(sequenceNumber, 18);
  // CRC placeholder (filled after)
  page.writeUInt32LE(0, 22);
  // Number of segments
  page[26] = segmentSizes.length;
  // Segment table
  for (let i = 0; i < segmentSizes.length; i++) {
    page[27 + i] = segmentSizes[i];
  }
  // Payload
  let offset = headerSize;
  for (const pkt of packets) {
    Buffer.from(pkt).copy(page, offset);
    offset += pkt.length;
  }

  // Compute and write CRC
  const crc = oggCrc32(page);
  page.writeUInt32LE(crc, 22);

  return page;
}

// --- WebM parsing ---

interface WebmParseResult {
  opusHead: Buffer;
  codecDelay: number; // nanoseconds
  packets: Uint8Array[];
}

function parseWebmOpus(webmBuffer: Buffer): WebmParseResult {
  const decoder = new EbmlDecoder();
  let opusHead: Buffer | null = null;
  let codecDelay = 0;
  let audioTrack = 1;
  const packets: Uint8Array[] = [];

  // Track whether we're inside a TrackEntry to associate CodecPrivate with the right track
  let inTrackEntry = false;
  let currentTrackNumber = 0;
  let currentCodecId = '';

  const events: Array<[string, Record<string, unknown>]> = [];
  decoder.on('data', (chunk: [string, Record<string, unknown>]) => events.push(chunk));
  decoder.write(webmBuffer);
  decoder.end();

  for (const [type, tag] of events) {
    const name = tag.name as string;

    if (type === 'start' && name === 'TrackEntry') {
      inTrackEntry = true;
      currentTrackNumber = 0;
      currentCodecId = '';
    }

    if (type === 'end' && name === 'TrackEntry') {
      if (currentCodecId === 'A_OPUS' && currentTrackNumber > 0) {
        audioTrack = currentTrackNumber;
      }
      inTrackEntry = false;
    }

    if (type === 'tag' && inTrackEntry) {
      if (name === 'TrackNumber') {
        currentTrackNumber = tag.value as number;
      }
      if (name === 'CodecID') {
        currentCodecId = tag.value as string;
      }
      if (name === 'CodecPrivate') {
        opusHead = Buffer.from(tag.data as Uint8Array);
      }
      if (name === 'CodecDelay') {
        codecDelay = tag.value as number;
      }
    }

    if (type === 'tag' && name === 'SimpleBlock') {
      const track = tag.track as number;
      const payload = tag.payload as Uint8Array | null;
      if (track === audioTrack && payload && payload.length > 0) {
        packets.push(Uint8Array.from(payload));
      }
    }
  }

  if (!opusHead) {
    throw new Error('No Opus CodecPrivate (OpusHead) found in WebM');
  }
  if (packets.length === 0) {
    throw new Error('No Opus audio packets found in WebM');
  }

  return { opusHead, codecDelay, packets };
}

// --- Main remux function ---

export function remuxWebmToOgg(webmBuffer: Buffer): Buffer {
  const { opusHead, codecDelay, packets } = parseWebmOpus(webmBuffer);

  const serialNumber = Math.floor(Math.random() * 0xFFFFFFFF);
  let sequenceNumber = 0;

  // Pre-skip: convert CodecDelay from nanoseconds to 48kHz samples
  // Also read pre-skip from OpusHead itself (bytes 10-11, little-endian uint16)
  const opusHeadPreSkip = opusHead.readUInt16LE(10);
  const preSkip = codecDelay > 0
    ? Math.round(codecDelay / 1e9 * 48000)
    : opusHeadPreSkip;

  // If CodecDelay-derived pre-skip differs from OpusHead, patch OpusHead
  const finalOpusHead = Buffer.from(opusHead);
  if (preSkip !== opusHeadPreSkip) {
    finalOpusHead.writeUInt16LE(preSkip, 10);
  }

  const pages: Buffer[] = [];

  // Page 0: OpusHead (BOS)
  pages.push(writeOggPage(serialNumber, sequenceNumber++, BigInt(0), 0x02, [finalOpusHead]));

  // Page 1: OpusTags
  const vendor = Buffer.from('remux');
  const opusTags = Buffer.alloc(8 + 4 + vendor.length + 4);
  opusTags.write('OpusTags', 0);
  opusTags.writeUInt32LE(vendor.length, 8);
  vendor.copy(opusTags, 12);
  opusTags.writeUInt32LE(0, 12 + vendor.length); // zero user comments
  pages.push(writeOggPage(serialNumber, sequenceNumber++, BigInt(0), 0, [opusTags]));

  // Data pages: one packet per page for simplicity
  let granulePosition = BigInt(preSkip); // starts at pre-skip per RFC 7845
  for (let i = 0; i < packets.length; i++) {
    const duration = getOpusPacketDuration48k(packets[i]);
    granulePosition += BigInt(duration);
    const isLast = i === packets.length - 1;
    pages.push(writeOggPage(
      serialNumber,
      sequenceNumber++,
      granulePosition,
      isLast ? 0x04 : 0, // EOS on last page
      [packets[i]],
    ));
  }

  return Buffer.concat(pages);
}
