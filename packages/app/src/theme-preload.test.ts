import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/tribunus-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates legacy oc-1 to oc-2 before mount", () => {
    localStorage.setItem("tribunus-theme-id", "oc-1")
    localStorage.setItem("tribunus-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("tribunus-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("oc-2")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("tribunus-theme-id")).toBe("oc-2")
    expect(localStorage.getItem("tribunus-theme-css-light")).toBeNull()
    expect(localStorage.getItem("tribunus-theme-css-dark")).toBeNull()
    expect(document.getElementById("tribunus-theme-preload")).toBeNull()
  })

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("tribunus-theme-id", "nightowl")
    localStorage.setItem("tribunus-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.getElementById("tribunus-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })

  test("migrates legacy opencode keys if tribunus keys are absent", () => {
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-color-scheme", "dark")
    localStorage.setItem("opencode-theme-css-dark", "--background-base:#333;")

    run()

    // Verifies key migration
    expect(localStorage.getItem("tribunus-theme-id")).toBe("nightowl")
    expect(localStorage.getItem("tribunus-color-scheme")).toBe("dark")
    expect(localStorage.getItem("tribunus-theme-css-dark")).toBe("--background-base:#333;")
    
    // Verifies correct dataset and style injection
    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(document.getElementById("tribunus-theme-preload")?.textContent).toContain("--background-base:#333;")
  })
})
