/**
 * Prism Local-Host KV Transport — Receipts
 *
 * Pure factory for local-transport-specific receipt metadata.
 */

/**
 * Create a local transport receipt from a request payload, the current
 * transport state, and the selected backend kind.
 */
export function createLocalTransportReceipt(
  request: Record<string, unknown>,
  state: string,
  backend: string,
): Record<string, unknown> {
  return {
    ...request,
    localTransportState: state,
    localTransportBackend: backend,
    localTransportReceiptCreatedAt: new Date().toISOString(),
  }
}
