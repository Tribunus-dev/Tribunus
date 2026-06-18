#!/usr/bin/env bun

import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"))
const args = process.argv.slice(2)
const liveOnly = args.includes("--live-only")
const baseDir = args.find((arg) => !arg.startsWith("--")) ?? "docs/json/adrs"
const componentIndexPath = "docs/json/architecture-components/acr_index.v1.json"
const adrIndexPath = `${baseDir}/adr_index.v1.json`
const manifestPath = "tools/fixtures/adr-component-violations/fixture_manifest.v1.json"
const auditPath = "docs/json/architecture-components/acr_contradiction_audit.v1.json"

const componentIndex = await readJson(componentIndexPath)
const adrIndex = await readJson(adrIndexPath)
const manifest = await readJson(manifestPath)

const adrFiles = adrIndex.adrs.map((entry: any) => entry.file)
const adrs = await Promise.all(
  adrFiles.map(async (file: string) => ({
    file,
    data: existsSync(file) ? await readJson(file) : null,
  })),
)

const rules = [
  {
    rule_id: "receipt_before_ack",
    requires: ["ACR-0001", "ACR-0002"],
    check: (text: string) =>
      /ack before receipt|ack before commit|xack before receipt|xack before commit|acknowledge before durable|valkey final authority|execution success is final/i.test(text),
  },
  {
    rule_id: "backend_truth_ownership",
    requires: ["ACR-0001", "ACR-0005"],
    check: (text: string) =>
      /owns durable authority truth|owns canonical tensor truth|owns durable truth|final authority/i.test(text) &&
      !/\b(no|not|never)\s+(backend|mlx|coreml|core ml|accelerate|tokio|valkey)\b/i.test(text),
  },
  {
    rule_id: "iosurface_authority_leakage",
    requires: ["ACR-0005"],
    check: (text: string) =>
      /authority-visible.*non-iosurface|persistent backend-owned tensor|mlx-owned canonical tensor|coreml-owned canonical tensor|accelerate-owned canonical tensor|tensor truth outside island/i.test(text) &&
      !/scratch|private|temporary|ring buffer|copied view|not durable truth/i.test(text),
  },
  {
    rule_id: "phase_local_scratch_boundary",
    requires: ["ACR-0004", "ACR-0007"],
    check: (text: string) =>
      /scratch memory crosses the phase boundary as durable truth|authority-visible scratch crosses the phase boundary|scratch crosses the phase boundary as durable truth/i.test(text),
  },
  {
    rule_id: "mlx_golden_path_authority",
    requires: ["ACR-0008"],
    check: (text: string) =>
      /ambient lazy MLX graphs are authority|improvise execution/i.test(text) &&
      !/golden path|declared inputs|declared outputs|eval boundary|copy policy|fallback condition/i.test(text),
  },
  {
    rule_id: "runtime_work_item_required",
    requires: ["ACR-0003", "ACR-0004", "ACR-0009"],
    check: (text: string) =>
      /canonical phase execution occurs without a RuntimeWorkItem|without a RuntimeWorkItem|implicit phase execution/i.test(text),
  },
  {
    rule_id: "copy_ledger_unknown_copy",
    requires: ["ACR-0010"],
    check: (text: string) =>
      /unknown copies are authority-eligible|unreceipted copies are allowed|copy classification is optional/i.test(text),
  },
] as const

type RuleId = (typeof rules)[number]["rule_id"]

const evaluate = (doc: any, path: string) => {
  const text = JSON.stringify(doc)
  const violations: any[] = []
  for (const rule of rules) {
    const hasRequirements = rule.requires.every((id) => doc.component_imports?.includes(id))
    if (!hasRequirements) continue
    if (!rule.check(text)) continue
    violations.push({
      rule_id: rule.rule_id,
      severity: "error",
      adr_id: `ADR-${doc.id}`,
      component_id: rule.requires[rule.requires.length - 1],
      path,
      field: "decision",
      matched_text: rule.rule_id,
      reason:
        rule.rule_id === "receipt_before_ack"
          ? "ADR imports Receipt-Before-Ack Ordering but allows coordination or execution phrasing that implies acknowledgement can precede durable receipt commit."
          : rule.rule_id === "backend_truth_ownership"
            ? "ADR imports the backend truth spine but attributes durable authority-like ownership to a backend or scheduler."
            : "ADR imports IOSurface Runtime Island but describes authority-visible tensor truth outside IOSurface-backed IslandTensors.",
      required_fix:
        rule.rule_id === "receipt_before_ack"
          ? "Require PGlite receipt commit before Valkey ack."
          : rule.rule_id === "backend_truth_ownership"
            ? "Limit backend language to provisional execution, not durable truth."
            : "Keep authority-visible tensor truth inside IOSurface-backed IslandTensors only.",
    })
  }
  return violations
}

const liveViolations = adrs.flatMap(({ file, data }) => (data ? evaluate(data, file) : []))
const livePassed = liveViolations.length === 0

const fixtureCases = await Promise.all(
  manifest.fixtures.map(async (fixture: any) => {
    const data = await readJson(fixture.file)
    const violations = evaluate(data, fixture.file)
    const actualPass = violations.length === 0
    const actualRuleIds = violations.map((violation: any) => violation.rule_id)
    return {
      fixture_id: fixture.fixture_id,
      file: fixture.file,
      expected_pass: fixture.expected_pass,
      expected_violations: fixture.expected_violations,
      actual_pass: actualPass,
      actual_violations: actualRuleIds,
      passed:
        actualPass === fixture.expected_pass &&
        JSON.stringify(actualRuleIds) === JSON.stringify(fixture.expected_violations),
      violations,
    }
  }),
)

const fixturePassed = fixtureCases.every((fixtureCase) => fixtureCase.passed)
const audit = {
  schema_version: "tribunus.acr_contradiction_audit.v1",
  checked_at: new Date().toISOString(),
  component_index: componentIndexPath,
  adr_index: adrIndexPath,
  fixture_manifest: manifestPath,
  rules: rules.map((rule) => rule.rule_id),
  live_board: {
    passed: livePassed,
    violations: liveViolations,
  },
  fixtures: {
    passed: fixturePassed,
    cases: fixtureCases,
  },
  results: {
    passed: livePassed && fixturePassed,
    violations: liveViolations,
    warnings: [],
  },
}

await Bun.write(auditPath, JSON.stringify(audit, null, 2))

if (liveOnly) {
  if (!livePassed) {
    console.error("live board contradiction audit failed")
    process.exit(1)
  }
  console.log("live board contradiction audit passed")
  process.exit(0)
}

if (!livePassed || !fixturePassed) {
  console.error("contradiction audit found violations")
  process.exit(1)
}

console.log("contradiction audit passed")
