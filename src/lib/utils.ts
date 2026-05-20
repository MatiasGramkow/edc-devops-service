/**
 * Calculate days since a given ISO date string.
 */
export function daysSince(isoDate: string): number {
  const then = new Date(isoDate);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Format an ISO date to a short locale string.
 */
export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Get a staleness level based on days since last change.
 */
export function stalenessLevel(days: number): "fresh" | "aging" | "stale" | "ancient" {
  if (days < 30) return "fresh";
  if (days < 90) return "aging";
  if (days < 180) return "stale";
  return "ancient";
}
