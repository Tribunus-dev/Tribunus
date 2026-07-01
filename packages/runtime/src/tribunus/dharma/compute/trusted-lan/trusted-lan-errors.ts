export class LanComputeError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = "LanComputeError"; this.code = code }
}
export class ProviderError extends LanComputeError {
  constructor(message: string) { super("PROVIDER_ERROR", message) }
}
export class TrustError extends LanComputeError {
  constructor(message: string) { super("TRUST_ERROR", message) }
}
export class TransportError extends LanComputeError {
  constructor(message: string) { super("TRANSPORT_ERROR", message) }
}
export class HandshakeError extends LanComputeError {
  constructor(message: string) { super("HANDSHAKE_ERROR", message) }
}
export class LeaseAdmissionError extends LanComputeError {
  readonly rejectionClass: string
  constructor(cls: string, message: string) { super("LEASE_ADMISSION_ERROR", message); this.rejectionClass = cls }
}
export class PairingError extends LanComputeError {
  constructor(message: string) { super("PAIRING_ERROR", message) }
}
export class LanReceiptError extends LanComputeError {
  constructor(message: string) { super("LAN_RECEIPT_ERROR", message) }
}
