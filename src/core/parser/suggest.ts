/** Deterministic edit-distance suggestions. */
export function closestMatches(
  input: string,
  candidates: readonly string[],
  limit = 3,
): string[] {
  const normalized = normalize(input);
  const scored = candidates.map((candidate, order) => ({
    candidate,
    order,
    distance: editDistance(normalized, normalize(candidate)),
  }));
  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.candidate !== b.candidate) return a.candidate < b.candidate ? -1 : 1;
    return a.order - b.order;
  });

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of scored) {
    if (seen.has(item.candidate)) continue;
    seen.add(item.candidate);
    result.push(item.candidate);
    if (result.length >= limit) break;
  }
  return result;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\s+/g, " ")
    .trim();
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let column = 0; column <= b.length; column += 1) {
    previous[column] = column;
  }
  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + cost,
      );
    }
    for (let column = 0; column <= b.length; column += 1) {
      previous[column] = current[column]!;
    }
  }
  return previous[b.length]!;
}
