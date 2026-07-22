export function classifyScore(score: number): string {
  if (score >= 80) return "healthy";
  if (score >= 50) return "warning";
  return "critical";
}