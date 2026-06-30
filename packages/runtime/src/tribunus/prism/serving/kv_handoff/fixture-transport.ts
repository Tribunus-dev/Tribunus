/**
 * Prism KV Handoff — Deterministic Fixture Transport Adapter
 *
 * Simulates KV transfer between prefill/decode workers without real transport.
 */

import type { PrismKvExportManifest, PrismKvTransportAdapter } from "./handoff-types"

// ── Deterministic Fixture KV Transport Adapter ──────────────────────────────

export class DeterministicFixtureKvTransportAdapter
  implements PrismKvTransportAdapter
{
  constructor(
    private readonly fixtureStore: Map<
      string,
      { manifest: PrismKvExportManifest; payloadDigest: string }
    >,
    private readonly injectDelayMs?: number,
    private readonly injectCorruption?: boolean,
    private readonly injectTimeout?: boolean,
  ) {}

  async prepareTransfer(
    handoffId: string,
    manifest: PrismKvExportManifest,
  ): Promise<{ prepared: boolean; reason: string | null }> {
    await this.maybeDelay()

    if (this.injectCorruption) {
      return { prepared: false, reason: "simulated corruption" }
    }

    const fixture = this.fixtureStore.get(handoffId)
    if (!fixture) {
      // Accept the manifest even if not pre-registered — treat as ad‑hoc
      this.fixtureStore.set(handoffId, {
        manifest,
        payloadDigest: manifest.deterministicContentDigest,
      })
    }

    return { prepared: true, reason: null }
  }

  async transfer(
    handoffId: string,
  ): Promise<{ transferred: boolean; payloadDigest: string; bytes: number }> {
    await this.maybeDelay()

    if (this.injectTimeout) {
      // Simulate a transfer timeout
      const { promise, reject } = Promise.withResolvers<never>()
      setTimeout(() => reject(new Error("transfer timeout")), 1)
      await promise
    }

    const fixture = this.fixtureStore.get(handoffId)
    if (!fixture) {
      return { transferred: false, payloadDigest: "", bytes: 0 }
    }

    if (this.injectCorruption) {
      return {
        transferred: true,
        payloadDigest: "CORRUPTED_" + fixture.payloadDigest,
        bytes: fixture.manifest.byteLength,
      }
    }

    return {
      transferred: true,
      payloadDigest: fixture.payloadDigest,
      bytes: fixture.manifest.byteLength,
    }
  }

  async acknowledgeImport(
    _handoffId: string,
  ): Promise<{ acknowledged: boolean }> {
    await this.maybeDelay()
    return { acknowledged: true }
  }

  async abortTransfer(_handoffId: string): Promise<void> {
    await this.maybeDelay()
    // No-op in simulation — no real bytes to abort
  }

  async getTransferStatus(
    handoffId: string,
  ): Promise<{ state: string; progressBytes: number }> {
    await this.maybeDelay()
    const fixture = this.fixtureStore.get(handoffId)
    if (!fixture) {
      return { state: "unknown", progressBytes: 0 }
    }
    return { state: "completed", progressBytes: fixture.manifest.byteLength }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async maybeDelay(): Promise<void> {
    if (this.injectDelayMs != null && this.injectDelayMs > 0) {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, this.injectDelayMs)
      return promise
    }
  }
}
