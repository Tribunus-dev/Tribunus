import fs from "node:fs/promises"
import path from "node:path"
import { type PluginManifest } from "./manifest.js"

export class PermissionError extends Error {
  constructor(message: string) {
    super(`Permission denied: ${message}`)
    this.name = "PermissionError"
  }
}

export class PermissionManager {
  private approved = false
  private manifest: PluginManifest | null = null

  constructor() {}

  load(manifest: PluginManifest) {
    this.manifest = manifest
    this.approved = false // Require approval on each load or session
  }

  approve() {
    this.approved = true
  }

  checkApproved() {
    if (!this.approved) {
      throw new PermissionError("User has not approved plugin permissions")
    }
  }

  checkNetwork(domain: string) {
    this.checkApproved()
    const allowed = this.manifest?.permissions?.network || []
    if (!allowed.includes(domain) && !allowed.includes("*")) {
      throw new PermissionError(`Network access to ${domain} not allowed`)
    }
  }

  checkEnv(key: string) {
    this.checkApproved()
    const allowed = this.manifest?.permissions?.env || []
    if (!allowed.includes(key) && !allowed.includes("*")) {
      throw new PermissionError(`Environment variable ${key} not allowed`)
    }
  }

  checkSubprocess() {
    this.checkApproved()
    if (!this.manifest?.permissions?.subprocess) {
      throw new PermissionError(`Subprocess execution not allowed`)
    }
  }

  hasSubprocess(): boolean {
    return !!this.manifest?.permissions?.subprocess
  }
}

export class ScopedFS {
  private baseDir: string
  private allowedPaths: string[]

  constructor(baseDir: string, allowedPaths: string[] = []) {
    this.baseDir = path.resolve(baseDir)
    this.allowedPaths = allowedPaths
  }

  private resolvePath(p: string): string {
    const resolved = path.resolve(this.baseDir, p)
    
    // Check if it's in the base directory
    if (resolved.startsWith(this.baseDir)) {
      return resolved
    }
    
    // Check if it matches an explicitly allowed path
    for (const allowedPath of this.allowedPaths) {
      if (resolved.startsWith(path.resolve(allowedPath))) {
        return resolved
      }
    }
    
    throw new PermissionError(`Path escapes plugin directory and is not explicitly allowed: ${p}`)
  }

  async readFile(p: string, options?: any) {
    return fs.readFile(this.resolvePath(p), options)
  }

  async writeFile(p: string, data: any, options?: any) {
    return fs.writeFile(this.resolvePath(p), data, options)
  }

  // Add more fs methods as needed
}
