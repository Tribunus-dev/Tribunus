/**
 * Social Manager Bridge — singleton accessor for SocialReplicationManager.
 *
 * IPC handlers in the desktop package import this bridge to access the
 * runtime's SocialReplicationManager instance without coupling to the
 * runtime's initialization lifecycle.
 *
 * Call initSocialManager() once at app startup after identity is available.
 * Call getSocialManager() from any IPC handler to access the instance.
 */

import { SocialReplicationManager, SocialReplicationConfig } from "./dharma/replication/social-replication"

let manager: SocialReplicationManager | null = null
let initialized = false

export async function initSocialManager(config: SocialReplicationConfig): Promise<void> {
  if (initialized) return
  manager = new SocialReplicationManager(config)
  await manager.initialize()
  initialized = true
}

export function getSocialManager(): SocialReplicationManager {
  if (!manager) {
    throw new Error("SocialManager not initialized — call initSocialManager() first")
  }
  return manager
}

export async function destroySocialManager(): Promise<void> {
  if (manager) {
    await manager.close()
    manager = null
    initialized = false
  }
}

export function isSocialInitialized(): boolean {
  return initialized
}
