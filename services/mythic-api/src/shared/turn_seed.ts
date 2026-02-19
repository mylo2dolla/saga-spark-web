import { createHash } from "node:crypto";

function bytesToBigint(bytes: Uint8Array): bigint {
  // Interpret first 8 bytes as unsigned bigint (big-endian).
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hi = BigInt(view.getUint32(0, false));
  const lo = BigInt(view.getUint32(4, false));
  const value = (hi << 32n) | lo;
  // Clamp into signed 63-bit positive range to stay compatible with Postgres bigint.
  return value & 0x7fff_ffff_ffff_ffffn;
}

export async function computeTurnSeed(args: {
  campaignSeed: string;
  turnIndex: number;
  playerId: string;
  salt: string;
}): Promise<bigint> {
  const input = `${args.campaignSeed}:${args.turnIndex}:${args.playerId}:${args.salt}`;
  const digest = createHash("sha256").update(input, "utf8").digest();
  return bytesToBigint(new Uint8Array(digest.buffer, digest.byteOffset, digest.byteLength));
}

