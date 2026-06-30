/**
 * Deployment profiles — query and filter over the canonical profile set.
 */

import { DEPLOYMENT_PROFILES, type PrismWorkerDeploymentProfile } from "./phase-role-types"

/**
 * Look up a deployment profile by name.
 * Returns undefined when no profile matches.
 */
export function getDeploymentProfile(
  name: string,
): PrismWorkerDeploymentProfile | undefined {
  return DEPLOYMENT_PROFILES[name]
}

/**
 * Return true when the profile is routable for end-to-end requests.
 * A profile needs either prefill+decode on the same worker or future
 * transfer capability.
 */
export function isProfileRoutable(
  profile: PrismWorkerDeploymentProfile,
): boolean {
  return profile.routableForEndToEndRequests
}

/**
 * Return all deployment profiles that are routable for end-to-end requests.
 */
export function getRoutableProfiles(): PrismWorkerDeploymentProfile[] {
  return Object.values(DEPLOYMENT_PROFILES).filter((p) => p.routableForEndToEndRequests)
}
