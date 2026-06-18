export function isNonAllowRule(rule: unknown) {
  if (!rule) return false
  if (typeof rule === "string") return rule !== "allow"
  if (typeof rule !== "object") return false
  if (Array.isArray(rule)) return false

  for (const action of Object.values(rule)) {
    if (action !== "allow") return true
  }

  return false
}

export function hasPermissionPromptRules(permission: unknown) {
  if (!permission) return false
  if (typeof permission === "string") return permission !== "allow"
  if (typeof permission !== "object") return false
  if (Array.isArray(permission)) return false

  const config = permission as Record<string, unknown>
  return Object.values(config).some(isNonAllowRule)
}
