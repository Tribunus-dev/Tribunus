const fs = require('fs')

let content = fs.readFileSync('packages/runtime/src/coordination/recovery.ts', 'utf8')

const target = `
/**
 * Plan coordination recovery.
 *
 * Delegates to CoordinationRecovery service for state inspection and plan formulation.
 */
export function planCoordinationRecovery(): Effect.Effect<RecoveryPlan> {
  return Effect.gen(function* () {
    const recovery = yield* CoordinationRecovery
    return yield* Effect.promise(() => recovery.planRecovery())
  })
}

/**
 * Persist a coordination recovery receipt.
 *
 * Delegates to CoordinationRecovery service for durable persistence.
 */
export function persistCoordinationRecoveryReceipt(
  receipt: RecoveryReceipt
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const recovery = yield* CoordinationRecovery
    yield* Effect.promise(() => recovery.persistRecoveryReceipt(receipt))
  })
}
`

const regex = /\/\*+\n \* Plan coordination recovery\.[\s\S]*?persistCoordinationRecoveryReceipt not yet implemented\.",\n  \)\n\}/m;

content = content.replace(regex, target.trim());
content = content.replace(/\/\/ ── Stubs ────────────────────────────────────────────────────────────\n\/\/ TODO: These will be implemented when the recovery-state repository is complete\.\n\/\/ For now, provide compile-time stubs that throw at runtime\.\n/m, '')

fs.writeFileSync('packages/runtime/src/coordination/recovery.ts', content);
