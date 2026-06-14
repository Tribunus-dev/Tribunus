import { Show, For } from "solid-js"
import { useDesktopRuntime } from "../desktop-runtime-context"

/** Map IPC error code to user-facing label */
function errorLabel(code: string): string {
  const labels: Record<string, string> = {
    unavailable: "Service Unavailable",
    invalid_request: "Request Failed",
    permission_denied: "Access Denied",
    timeout: "Request Timed Out",
    not_found: "Not Found",
    conflict: "Conflict",
    cancelled: "Cancelled",
    rate_limited: "Rate Limited",
    unsupported: "Unsupported Operation",
    internal: "Unexpected Error",
  }
  return labels[code] ?? code
}

export function IpcErrorToast() {
  const { state, dismissIpcError } = useDesktopRuntime()

  return (
    <div class="fixed bottom-4 right-4 flex flex-col gap-2 z-50 max-w-sm">
      <For each={state.ipc.errors}>
        {(error) => {
          if (["timeout", "cancelled", "rate_limited", "invalid_request"].includes(error.code)) {
            setTimeout(() => {
              dismissIpcError(error.requestId)
            }, 5000)
          }

          return (
            <div class={`p-3 rounded shadow-lg text-12 border ${error.code === "internal" ? "bg-red-900/40 border-red-700" : "bg-surface-base border-surface-weak"}`}>
              <div class="flex justify-between items-start">
                <span class="text-12-semibold">{errorLabel(error.code)}</span>
                <button class="text-text-weak hover:text-text-strong" onClick={() => dismissIpcError(error.requestId)}>
                  x
                </button>
              </div>
              <p class="text-text-weak mt-1">{error.message}</p>
              <Show when={error.code === "internal"}>
                <p class="text-text-weak text-10 mt-1 opacity-50">ID: {error.requestId}</p>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  )
}
