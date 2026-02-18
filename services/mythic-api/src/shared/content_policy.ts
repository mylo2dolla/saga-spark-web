// Harsh language allowed. Gore/violence allowed.
// Allowed: mild sexuality / playful sexy banter.
// Disallowed: sexual violence, coercion, rape, underage sexual content, pornographic/explicit sex acts.
//
// This is an intentionally high-signal filter: we do NOT block generic "sex"/"sexual" mentions,
// since mild/consensual flirtation is allowed. We focus on violence/coercion/minors + explicit acts.

const forbiddenSexualPatterns: RegExp[] = [
  // Sexual violence / coercion (high-signal terms)
  /\bsexual\s+violence\b/i,
  /\bsexual\s+assault\b/i,
  /\brape\b/i,
  /\braped\b/i,
  /\braping\b/i,
  /\bmolest\b/i,
  /\bmolested\b/i,
  /\bmolester\b/i,
  /\bnonconsensual\b/i,
  /\bnon-consensual\b/i,

  // Underage content
  /\bunderage\b/i,
  /\bchild\s*porn\b/i,
  /\bminor\s*porn\b/i,
  /\bloli\b/i,

  // Porn / explicit sex acts / explicit anatomy
  /\bporn\b/i,
  /\bpornography\b/i,
  /\berotic\b/i,
  /\bnude\b/i,
  /\bnudity\b/i,
  /\bincest\b/i,
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
