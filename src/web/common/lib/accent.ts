export function nameHue(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash >= 45 && hash < 90 ? hash + 100 : hash;
}

export function nameAccent(name: string): string {
  return `hsl(${nameHue(name)} 70% 46%)`;
}
