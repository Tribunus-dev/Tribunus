/**
 * Prism Local-Host KV Transport — Error Classes
 */

export class LocalTransportError extends Error {
  override readonly name: string = "LocalTransportError"
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class CapabilityError extends LocalTransportError {
  override readonly name = "CapabilityError"
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class HandshakeError extends LocalTransportError {
  override readonly name = "HandshakeError"
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class ControlProtocolError extends LocalTransportError {
  override readonly name = "ControlProtocolError"
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class SegmentError extends LocalTransportError {
  override readonly name = "SegmentError"
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class SerializationError extends LocalTransportError {
  override readonly name = "SerializationError"
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class DeserializationError extends LocalTransportError {
  override readonly name = "DeserializationError"
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class TransportTimeoutError extends LocalTransportError {
  override readonly name = "TransportTimeoutError"
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

export class OrphanError extends LocalTransportError {
  override readonly name = "OrphanError"
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}
