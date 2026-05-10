export type MaybeArray<T> = T | T[] | undefined;

export function normalizeMediaArray<T>(media: MaybeArray<T>): T[] {
  if (!media) return [];
  return Array.isArray(media) ? media : [media];
}
