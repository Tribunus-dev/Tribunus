export type BudgetClass = "standard" | "long_running" | "artifact_export";

export interface BudgetConfig {
  readonly budgetClass: BudgetClass;
  readonly defaultDurationMs: number;
  readonly requiredClientBudgetMs: number;
  readonly maxDurationMs: number;
}

export const BUDGET_CONFIGS: Record<BudgetClass, BudgetConfig> = {
  standard: {
    budgetClass: "standard",
    defaultDurationMs: 30_000,
    requiredClientBudgetMs: 30_000,
    maxDurationMs: 60_000,
  },
  long_running: {
    budgetClass: "long_running",
    defaultDurationMs: 120_000,
    requiredClientBudgetMs: 60_000,
    maxDurationMs: 300_000,
  },
  artifact_export: {
    budgetClass: "artifact_export",
    defaultDurationMs: 300_000,
    requiredClientBudgetMs: 120_000,
    maxDurationMs: 1_200_000, // 20 minutes server ceiling
  },
};
