/**
 * Dharma Multi-Peer Result Convergence — Source Disclosure Package Model
 *
 * Pure functions for creating and inspecting source disclosure packages
 * that govern what source context is shared with task contributors.
 */

import type { SourceDisclosurePackage, DisclosureClass } from "./multi-peer-types";
import { randomUUID } from "node:crypto";
import { SourcePackageError } from "./multi-peer-errors";

// ── Package Creation ────────────────────────────────────────────────────────

/**
 * Create a new source disclosure package.
 *
 * @param config - Package configuration
 * @param config.sessionId - The session this package belongs to
 * @param config.sourceBasisDigest - The source basis digest this package covers
 * @param config.disclosureClass - Classification of disclosure
 * @param config.createdBy - Identity public key of the creator
 * @param config.intendedMembershipIds - Optional list of membership IDs authorized to access this package
 * @param config.sourceScope - Optional scope string; defaults based on disclosure class
 * @returns A fully populated SourceDisclosurePackage
 */
export function createSourcePackage(config: {
  sessionId: string;
  sourceBasisDigest: string;
  disclosureClass: DisclosureClass;
  createdBy: string;
  intendedMembershipIds?: string[];
  sourceScope?: string;
}): SourceDisclosurePackage {
  const now = new Date().toISOString();

   const DEFAULT_SCOPES: Record<DisclosureClass, string> = {
     full_snapshot: "/",
     subtree_snapshot: "/src",
     task_fixture_bundle: "/test",
     patch_context_only: "/src",
     generated_reproduction_bundle: "/test/reproduction",
     opaque_artifact_reference: "",
   };
   const scope = config.sourceScope ?? DEFAULT_SCOPES[config.disclosureClass];

   const expiresAt =
     config.disclosureClass === "opaque_artifact_reference"
       ? null
       : (() => {
           const expiry = new Date(now);
           expiry.setHours(expiry.getHours() + 48);
           return expiry.toISOString();
         })();

  return {
    packageId: randomUUID(),
    sessionId: config.sessionId,
    sourceBasisDigest: config.sourceBasisDigest,
    disclosureClass: config.disclosureClass,
    sourceScope: scope,
    packageManifestDigest: "",
    encryptedPayloadReference: null,
    artifactReferences: [],
    createdByIdentityPublicKey: config.createdBy,
    intendedMembershipIds: config.intendedMembershipIds ?? [],
    expiresAt,
    signature: "",
  };
}

// ── Authorization ───────────────────────────────────────────────────────────

/**
 * Check whether a membership ID is authorized to access a source disclosure package.
 *
 * A package is authorized for a member if:
 * - The member appears in `intendedMembershipIds`, OR
 * - `intendedMembershipIds` is empty (open disclosure)
 *
 * @param pkg - The source disclosure package
 * @param membershipId - The membership ID to check
 * @returns `true` if the member is authorized
 */
export function isPackageAuthorizedForMember(
  pkg: SourceDisclosurePackage,
  membershipId: string,
): boolean {
  if (pkg.intendedMembershipIds.length === 0) {
    return true;
  }
  return pkg.intendedMembershipIds.includes(membershipId);
}

// ── Scope ───────────────────────────────────────────────────────────────────

/**
 * Get the effective source scope for a disclosure package.
 *
 * @param pkg - The source disclosure package
 * @returns The source scope string
 */
export function getPackageScope(pkg: SourceDisclosurePackage): string {
  return pkg.sourceScope;
}

// ── Expiry ──────────────────────────────────────────────────────────────────

/**
 * Check whether a source disclosure package has expired.
 *
 * A package with a null `expiresAt` never expires.
 *
 * @param pkg - The source disclosure package
 * @returns `true` if the package has expired
 */
export function isPackageExpired(pkg: SourceDisclosurePackage): boolean {
  if (pkg.expiresAt === null) {
    return false;
  }
  return new Date(pkg.expiresAt).getTime() <= Date.now();
}
