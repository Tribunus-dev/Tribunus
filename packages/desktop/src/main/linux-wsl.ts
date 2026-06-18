export function detectWayland(): boolean {
  return !!(
    process.env?.WAYLAND_DISPLAY ||
    process.env?.XDG_SESSION_TYPE === 'wayland' ||
    false
  )
}

export function detectWSL2(): boolean {
  return !!(
    process.env?.WSL_INTEROP &&
    process.env?.WSL_DISTRO_NAME
  )
}

export function getWslGpuPaths(): string[] {
  if (!detectWSL2()) return []
  const paths = ['/usr/lib/wsl/lib']
  return paths
}
