export function groupAssetsByType<T>(
  items: T[],
  getType: (item: T) => string
): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const raw = getType(item).toLowerCase();
    const key =
      raw === "image" ? "Image" : raw === "video" ? "Video" : raw === "audio" ? "Audio" : raw === "document" ? "Document" : "Other";
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
}
