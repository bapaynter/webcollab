const BLOCK_PATTERNS: ReadonlyArray<RegExp> = [
  /<\s*script/i,
  /<\s*\/script/i,
  /<\s*style/i,
  /javascript:/i,
  /data\s*:\s*text\/html/i,
  /\bon\w+\s*=\s*["']/i,
  /<\s*iframe/i,
  /<\s*form/i,
  /<\s*object/i,
  /<\s*embed/i,
  /<\s*base/i,
  /<\s*meta\s+http-equiv/i,
];

export function isBlocked(message: string): boolean {
  return BLOCK_PATTERNS.some((pattern) => pattern.test(message));
}
