;(function () {
  var key = "tribunus-theme-id"
  var legacyKey = "opencode-theme-id"
  
  var themeId = localStorage.getItem(key)
  if (!themeId) {
    var legacyThemeId = localStorage.getItem(legacyKey)
    if (legacyThemeId) {
      themeId = legacyThemeId
      if (themeId === "opencode") themeId = "tribunus"
      localStorage.setItem(key, themeId)
    } else {
      themeId = "oc-2"
    }
  }

  if (themeId === "oc-1" || themeId === "opencode") {
    themeId = "oc-2"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("tribunus-theme-css-light")
    localStorage.removeItem("tribunus-theme-css-dark")
  }

  var schemeKey = "tribunus-color-scheme"
  var legacySchemeKey = "opencode-color-scheme"
  var scheme = localStorage.getItem(schemeKey)
  if (!scheme) {
    var legacyScheme = localStorage.getItem(legacySchemeKey)
    if (legacyScheme) {
      scheme = legacyScheme
      localStorage.setItem(schemeKey, scheme)
    } else {
      scheme = "system"
    }
  }

  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#131010" : "#F8F7F7")

  if (themeId === "oc-2" || themeId === "tribunus") return

  var cssKey = "tribunus-theme-css-" + mode
  var legacyCssKey = "opencode-theme-css-" + mode
  var css = localStorage.getItem(cssKey)
  if (!css) {
    var legacyCss = localStorage.getItem(legacyCssKey)
    if (legacyCss) {
      css = legacyCss
      localStorage.setItem(cssKey, css)
    }
  }

  if (css) {
    var style = document.createElement("style")
    style.id = "tribunus-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
