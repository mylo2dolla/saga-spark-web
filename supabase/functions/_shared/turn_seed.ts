const encoder = new TextEncoder();

function bytesToBigint(bytes: Uint8Array): bigint {
  // Interpret first 8 bytes as unsigned bigint.
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
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  const bytes = new Uint8Array(digest);
  return bytesToBigint(bytes);
}

