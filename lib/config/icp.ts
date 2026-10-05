// Phase 1 display configuration. These thresholds are provisional.
export const icp = { id: "ramp-canada", name: "Ramp Canada", strong: 85, potential: 70 } as const;
export function fitFor(score: number) {
  return score >= icp.strong ? "Strong fit" : score >= icp.potential ? "Potential" : "Weak fit";
}
export const dimensions = [
  { key: "scale", label: "Organizational scale", weight: 0.2 },
  { key: "spend", label: "Spend complexity", weight: 0.25 },
  { key: "finance", label: "Finance complexity", weight: 0.2 },
  { key: "growth", label: "Growth", weight: 0.15 },
  { key: "distributed", label: "Distributed workforce", weight: 0.1 },
  { key: "operations", label: "Operational complexity", weight: 0.1 },
] as const;
