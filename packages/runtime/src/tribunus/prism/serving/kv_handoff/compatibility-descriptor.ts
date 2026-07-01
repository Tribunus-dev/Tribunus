/**
 * Prism KV Handoff Protocol — Compatibility Descriptor
 *
 * Pure functions for creating and digesting PrismKvCompatibilityDescriptor
 * instances. The digest is a SHA-256 hex string over the canonical field
 * ordering, used for quick equality checks during handoff validation.
 */

import { createHash } from "node:crypto"
import type { PrismKvCompatibilityDescriptor } from "./handoff-types"

export function createCompatibilityDescriptor(
  modelDigest: string,
  tokenizerDigest: string,
  archDigest: string,
  attnDigest: string,
  ropeDigest: string,
  kvQuantDigest: string,
  kvPrecision: string,
  pageShape: string,
  headLayout: string,
  layers: number,
  hiddenDim: number,
  seqLen: number,
  sourceClass: string,
  destClass: string,
  transferRep: string,
): PrismKvCompatibilityDescriptor {
  return {
    compatibilityVersion: 1,
    modelArtifactDigest: modelDigest,
    tokenizerDigest,
    architectureDigest: archDigest,
    attentionLayoutDigest: attnDigest,
    ropeConfigurationDigest: ropeDigest,
    kvQuantizationDigest: kvQuantDigest,
    kvPrecisionMode: kvPrecision,
    kvPageShape: pageShape,
    kvHeadLayout: headLayout,
    kvLayerCount: layers,
    kvHiddenDimension: hiddenDim,
    kvSequenceLength: seqLen,
    sourceComputeImageClass: sourceClass,
    destinationComputeImageClass: destClass,
    transferRepresentation: transferRep,
    targetEndianness: null,
    targetAlignmentClass: null,
  }
}

/**
 * Compute a deterministic SHA-256 hex digest for a compatibility descriptor.
 * The digest covers all non-nullable fields in canonical order, producing a
 * stable fingerprint for equality comparison.
 */
export function getDescriptorDigest(desc: PrismKvCompatibilityDescriptor): string {
  const payload = [
    String(desc.compatibilityVersion),
    desc.modelArtifactDigest,
    desc.tokenizerDigest,
    desc.architectureDigest,
    desc.attentionLayoutDigest,
    desc.ropeConfigurationDigest,
    desc.kvQuantizationDigest,
    desc.kvPrecisionMode,
    desc.kvPageShape,
    desc.kvHeadLayout,
    String(desc.kvLayerCount),
    String(desc.kvHiddenDimension),
    String(desc.kvSequenceLength),
    desc.sourceComputeImageClass,
    desc.destinationComputeImageClass,
    desc.transferRepresentation,
    desc.targetEndianness ?? "",
    desc.targetAlignmentClass ?? "",
  ].join("|")

  return createHash("sha256").update(payload).digest("hex")
}
