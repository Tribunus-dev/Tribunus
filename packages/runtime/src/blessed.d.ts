declare module "blessed" {
  import { EventEmitter } from "events"

  interface ScreenOptions {
    smartCSR?: boolean
    title?: string
    fastCSR?: boolean
    useBC?: boolean
    program?: unknown
    dockBorders?: boolean
    ignoreDockContrast?: boolean
    gpu?: boolean
    cursor?: { color?: string }
    log?: string
    dump?: boolean
    debug?: boolean
    warnings?: boolean
    tabSize?: number
    autoPadding?: boolean
    forceUnicode?: boolean
    input?: unknown
    output?: unknown
    terminal?: string
    tput?: unknown
  }

  interface ElementOptions {
    top?: number | string
    left?: number | string
    right?: number | string
    bottom?: number | string
    width?: number | string
    height?: number | string
    align?: string
    valign?: string
    label?: string
    content?: string
    tags?: boolean
    border?: { type: string }
    style?: Record<string, unknown>
    hidden?: boolean
    vi?: boolean
    keys?: boolean
    mouse?: boolean
    scrollable?: boolean
    alwaysScroll?: boolean
    scrollbar?: Record<string, unknown>
    scrollSpeed?: number
    input?: boolean
    output?: boolean
    shrink?: boolean
    wrap?: boolean
    hoverText?: string
    padding?: number | { left?: number; right?: number; top?: number; bottom?: number }
    ch?: string
    bold?: boolean
    fg?: string
    bg?: string
    focusable?: boolean
  }

  interface TableOptions extends ElementOptions {
    rows?: number
    cols?: number
    fg?: string
    selectedFg?: string
    selectedBg?: string
    data?: string[][]
    noCellBorders?: boolean
    fillCellBorders?: boolean
  }

  interface BoxOptions extends ElementOptions {
    transparent?: boolean
  }

  class Element {
    setContent(content: string): void
    setData(data: string[][]): void
    on(event: string, callback: (...args: unknown[]) => void): this
    destroy(): void
    append(child: Element): void
    focus(): void
    show(): void
    hide(): void
    render(): void
    screen: Screen
  }

  class Screen extends EventEmitter {
    constructor(options?: ScreenOptions)
    append(element: Element): void
    render(): void
    key(keys: string[], callback: (ch: string, key: unknown) => void): void
    on(event: string, callback: (...args: unknown[]) => void): this
    destroy(): void
    cursor: { reset(): void }
  }

  class Table extends Element {
    constructor(options?: TableOptions)
    setData(data: string[][]): void
  }

  class Box extends Element {
    constructor(options?: BoxOptions)
  }

  function screen(options?: ScreenOptions): Screen
  function table(options?: TableOptions): Table
  function box(options?: BoxOptions): Box
}
