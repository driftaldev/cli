export interface Batch<T> {
  items: T[];
  total: number;
}

export function createBatches<T>(items: T[], size: number): Batch<T>[] {
  const batches: Batch<T>[] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push({ items: items.slice(i, i + size), total: items.length });
  }
  return batches;
}
