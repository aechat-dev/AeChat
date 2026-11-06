import { randomBytes } from "node:crypto";

/**
 * UUIDv7 generator, monotonic within this process.
 *
 * Layout: 48-bit Unix-ms timestamp, version 7, 12-bit rand_a, variant 10,
 * 62-bit rand_b. The 74 random bits are used as a sequence counter so ids
 * created in the same millisecond sort in creation order; when the counter
 * would wrap, the timestamp is nudged forward by one millisecond.
 */
const RAND_BITS = 74n;
const MAX_SEQ = (1n << RAND_BITS) - 1n;
const LOW_56 = (1n << 56n) - 1n;

let lastMs = -1;
let seq = 0n;

function randomSeq(): bigint {
  let value = 0n;
  for (const byte of randomBytes(10)) {
    value = (value << 8n) | BigInt(byte);
  }
  return value & MAX_SEQ;
}

export function newId(): string {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    seq = randomSeq();
  } else {
    seq += 1n;
    if (seq > MAX_SEQ) {
      lastMs += 1;
      seq = 0n;
    }
  }

  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(lastMs, 0, 6);
  bytes[6] = 0x70 | Number((seq >> 70n) & 0x0fn);
  bytes[7] = Number((seq >> 62n) & 0xffn);
  bytes[8] = 0x80 | Number((seq >> 56n) & 0x3fn);

  let low = seq & LOW_56;
  for (let index = 15; index >= 9; index -= 1) {
    bytes[index] = Number(low & 0xffn);
    low >>= 8n;
  }

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
