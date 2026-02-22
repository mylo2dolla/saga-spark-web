const VOWEL_START = /^[aeiou]/i;

export function articleFor(word: string): "a" | "an" {
  const clean = word.trim();
  if (!clean) return "a";
  return VOWEL_START.test(clean) ? "an" : "a";
}

export function pluralize(word: string, count: number): string {
  if (count === 1) return word;
  const clean = word.trim();
  if (clean.endsWith("y")) return `${clean.slice(0, -1)}ies`;
  if (clean.endsWith("s")) return `${clean}es`;
  return `${clean}s`;
}

export function thirdPerson(verb: string): string {
  const clean = verb.trim();
  if (!clean) return "";
  if (clean.endsWith("y")) return `${clean.slice(0, -1)}ies`;
  if (clean.endsWith("s") || clean.endsWith("x") || clean.endsWith("ch") || clean.endsWith("sh")) {
    return `${clean}es`;
  }
  return `${clean}s`;
}

export function compactSentence(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1");
}

