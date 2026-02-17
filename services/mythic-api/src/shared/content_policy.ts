// Harsh language allowed. Sexual content / sexual violence forbidden.
// This mirrors the DB-side intent (mythic.contains_forbidden_sexual_content).

const forbiddenSexualPatterns: RegExp[] = [
  /\bsex\b/i,
  /\bsexual\b/i,
  /\bsexual\s+violence\b/i,
  /\brape\b/i,
  /\braped\b/i,
  /\braping\b/i,
  /\bmolest\b/i,
  /\bmolested\b/i,
  /\bmolester\b/i,
  /\bporn\b/i,
  /\bpornography\b/i,
  /\berotic\b/i,
  /\bnude\b/i,
  /\bnudity\b/i,
  /\bincest\b/i,
  /\bunderage\b/i,
  /\bchild\s*porn\b/i,
  /\bminor\s*porn\b/i,
  /\bblowjob\b/i,
  /\bhandjob\b/i,
  /\bintercourse\b/i,
  /\bgenitals\b/i,
  /\bvagina\b/i,
  /\bpenis\b/i,
  /\bclitoris\b/i,
  /\btesticles\b/i,
  /\borgasm\b/i,
];

export function containsForbiddenSexualContent(txt: string | null | undefined): boolean {
  const s = (txt ?? "").toString();
  if (!s) return false;
  return forbiddenSexualPatterns.some((re) => re.test(s));
}

export function assertContentAllowed(fields: Array<{ path: string; value: string | null | undefined }>) {
  const bad = fields.find((f) => containsForbiddenSexualContent(f.value));
  if (bad) {
    throw new Error(`Forbidden sexual content detected in ${bad.path}`);
  }
}

