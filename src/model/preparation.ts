/** One priority rule for resource preparation and retained page nodes. */
export function preparationOrder(count: number, current: number, firstTen = false): { front: number[]; all: number[] } {
  const near = [current];
  for (let distance = 1; distance <= 5; distance++) near.push(current + distance, current - distance);
  const front = [...new Set(firstTen ? [current, ...Array.from({ length: Math.min(10, count) }, (_, i) => i)] : near)]
    .filter((i) => i >= 0 && i < count);
  return { front, all: [...new Set([...front, ...near.filter((i) => i >= 0 && i < count), ...Array.from({ length: count }, (_, i) => i)])] };
}
