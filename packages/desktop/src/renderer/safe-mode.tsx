import { MetaProvider } from "@solidjs/meta"
import { render } from "solid-js/web"
import "@tribunus/app/index.css"
import { Font } from "@tribunus/ui/font"
import { Splash } from "@tribunus/ui/logo"
import "./styles.css"
import { createSignal, onMount, For } from "solid-js"
import { SafeModeCard } from "./components/safe-mode-card"
import type { SafeModeDiagnostics } from "../preload/types"
import { ACTIONS, fetchDiagnostics, handleRetryNormalStartup } from "./safe-mode-logic"

const root = document.getElementById("root")!

render(() => {
  const [diagnostics, setDiagnostics] = createSignal<SafeModeDiagnostics | null>(null)

  onMount(() => {
    fetchDiagnostics().then((res) => {
      if (res) setDiagnostics(res)
    })
  })

  const diag = diagnostics()

  return (
    <MetaProvider>
      <div class="w-screen h-screen bg-background-base flex flex-col">
        <Font />
        <div class="flex flex-col items-center justify-center px-8 py-12 gap-8 overflow-y-auto">
          <Splash class="w-20 h-25 opacity-15" />
          <div class="flex flex-col items-center gap-2">
            <h1 class="text-20-semibold text-text-strong">Safe Mode</h1>
            <p class="text-14-regular text-text-weak text-center max-w-md">
              OpenCode could not start normally. Use the options below to diagnose and fix the issue.
            </p>
          </div>

          {diag && (
            <div class="flex flex-col gap-2 w-full max-w-md rounded-lg border border-critical-base bg-critical-weak p-4">
              <span class="text-12-semibold text-text-strong">Error Details</span>
              <span class="text-12-regular text-text-weak font-mono break-all">
                {diag.error.message}
              </span>
              <span class="text-12-regular text-text-weak">
                Component: {diag.error.component}
              </span>
              <span class="text-12-regular text-text-weak mt-2">
                Platform: {diag.systemInfo.platform} {diag.systemInfo.arch} &middot; Version: {diag.systemInfo.version}
              </span>
            </div>
          )}

          {diag?.sidecarFailure && (
            <div class="flex flex-col gap-2 w-full max-w-md rounded-lg border border-warning-base bg-warning-weak p-4 mt-2">
              <span class="text-12-semibold text-text-strong">Sidecar Startup Failure</span>
              <span class="text-12-regular text-text-weak font-mono">
                Failed at: {diag.sidecarFailure.phase} (last OK: {diag.sidecarFailure.lastSuccessfulPhase})
              </span>
              <span class="text-12-regular text-text-weak font-mono break-all">
                {diag.sidecarFailure.errorMessage}
              </span>
              {diag.sidecarFailure.errorStack && (
                <details>
                  <summary class="text-12-regular text-text-weak cursor-pointer">Stack trace</summary>
                  <pre class="text-10-regular text-text-weak font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto mt-1">{diag.sidecarFailure.errorStack}</pre>
                </details>
              )}
              {diag.sidecarFailure.stderrTail && (
                <details>
                  <summary class="text-12-regular text-text-weak cursor-pointer">stderr (last 20 lines)</summary>
                  <pre class="text-10-regular text-text-weak font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto mt-1">{diag.sidecarFailure.stderrTail}</pre>
                </details>
              )}
            </div>
          )}

          {diag?.sidecarFailure && (
            <div class="flex flex-col gap-2 w-full max-w-md rounded-lg border border-warning-base bg-warning-weak p-4 mt-2">
              <span class="text-12-semibold text-text-strong">Sidecar Startup Failure</span>
              <span class="text-12-regular text-text-weak font-mono">
                Failed at: {diag.sidecarFailure.phase} (last OK: {diag.sidecarFailure.lastSuccessfulPhase})
              </span>
              <span class="text-12-regular text-text-weak font-mono break-all">
                {diag.sidecarFailure.errorMessage}
              </span>
              {diag.sidecarFailure.errorStack && (
                <details>
                  <summary class="text-12-regular text-text-weak cursor-pointer">Stack trace</summary>
                  <pre class="text-10-regular text-text-weak font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto mt-1">{diag.sidecarFailure.errorStack}</pre>
                </details>
              )}
              {diag.sidecarFailure.stderrTail && (
                <details>
                  <summary class="text-12-regular text-text-weak cursor-pointer">stderr (last 20 lines)</summary>
                  <pre class="text-10-regular text-text-weak font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto mt-1">{diag.sidecarFailure.stderrTail}</pre>
                </details>
              )}
            </div>
          )}

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
            <For each={ACTIONS}>
              {(card) => (
                <SafeModeCard
                  title={card.title}
                  description={card.description}
                  action={card.action}
                />
              )}
            </For>
          </div>

          <button
            class="mt-4 rounded-lg bg-accent-base px-6 py-3 text-14-semibold text-white hover:bg-accent-strong transition-colors"
            onClick={handleRetryNormalStartup}
          >
            Retry Normal Startup
          </button>
        </div>
      </div>
    </MetaProvider>
  )
}, root)
