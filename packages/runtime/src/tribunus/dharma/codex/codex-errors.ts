/**
 * Phase 1 — Core Codex Error Types
 */

export class CodexError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "CodexError"
    this.code = code
  }
}

export class DatasetExportError extends CodexError {
  constructor(message: string, code = "DATASET_EXPORT_ERROR") {
    super(code, message)
    this.name = "DatasetExportError"
  }
}

export class BenefitAccountingError extends CodexError {
  constructor(message: string, code = "BENEFIT_ACCOUNTING_ERROR") {
    super(code, message)
    this.name = "BenefitAccountingError"
  }
}
