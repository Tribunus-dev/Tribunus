import { Database } from "bun:sqlite"
import { mkdir, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, spyOn, test } from "bun:test"

import fs from "node:fs"

export function isZedTerminal() {
  return process.env.ZED_TERM === "true" || process.env.TERM_PROGRAM?.toLowerCase() === "zed"
}

export function offsetToPosition(text: string, offset: number) {
  const stringOffset = utf8ByteOffsetToStringIndex(text, offset)
  return offsetsToSelection(text, stringOffset, stringOffset).start
}

function utf8ByteOffsetToStringIndex(text: string, byteOffset: number) {
  if (byteOffset <= 0) return 0
  const encoder = new TextEncoder()
  let bytes = 0
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) return text.length

    const nextIndex = index + (codePoint > 0xffff ? 2 : 1)
    bytes += encoder.encode(text.slice(index, nextIndex)).length
    if (bytes >= byteOffset) return nextIndex
    index = nextIndex
  }

  return text.length
}

function offsetsToSelection(text: string, startOffset: number, endOffset: number) {
  const start = Math.max(0, Math.min(startOffset, text.length))
  const end = Math.max(0, Math.min(endOffset, text.length))
  let line = 1
  let lineStart = 0
  let startPosition = position(line, lineStart, start)
  let endPosition = position(line, lineStart, end)

  for (let index = 0; index <= end; index++) {
    if (index === start) startPosition = position(line, lineStart, index)
    if (index === end) {
      endPosition = position(line, lineStart, index)
      break
    }
    if (text[index] === "\n") {
      line += 1
      lineStart = index + 1
    }
  }

  return { start: startPosition, end: endPosition }
}

function position(line: number, lineStart: number, offset: number) {
  return {
    line,
    character: offset - lineStart + 1,
  }
}

export function resolveZedDbPath() {
  const candidates = [
    process.env.OPENCODE_ZED_DB,
    path.join(os.homedir(), "Library", "Application Support", "Zed", "db", "0-stable", "db.sqlite"),
    path.join(os.homedir(), ".local", "share", "zed", "db", "0-stable", "db.sqlite"),
  ].filter((item): item is string => Boolean(item))

  return candidates.find((item) => {
    try {
      return fs.statSync(item).isFile()
    } catch {
      return false
    }
  })
}

export async function resolveZedSelection(dbPath: string, cwd: string) {
  const active = queryZedActiveEditor(dbPath, cwd)
  if (active.type !== "row") return active

  const row = active.row
  if (!row.buffer_path) return { type: "empty" }

  const selections = queryZedEditorSelections(dbPath, row)
  if (selections.type !== "selections") return selections
  const byteRanges = selections.selections
    .flatMap((selection: any) => {
      if (selection.selection_start == null || selection.selection_end == null) return []
      return [
        {
          start: Math.min(selection.selection_start, selection.selection_end),
          end: Math.max(selection.selection_start, selection.selection_end),
        },
      ]
    })
    .sort((left: any, right: any) => left.start - right.start || left.end - right.end)
  if (byteRanges.length === 0) return { type: "unavailable" }

  const contents = queryZedEditorContents(dbPath, row)
  const text =
    contents.type === "contents" && contents.contents != null
      ? contents.contents
      : await Bun.file(row.buffer_path)
          .text()
          .catch(() => undefined)
  if (text == null) return { type: "unavailable" }

  const ranges = byteRanges.map((range: any) => {
    const startOffset = utf8ByteOffsetToStringIndex(text, range.start)
    const endOffset = utf8ByteOffsetToStringIndex(text, range.end)
    return {
      text: text.slice(startOffset, endOffset),
      selection: offsetsToSelection(text, startOffset, endOffset),
    }
  })

  return {
    type: "selection",
    selection: {
      filePath: row.buffer_path,
      source: "zed",
      ranges,
    },
  }
}

function queryZedActiveEditor(dbPath: string, cwd: string) {
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    const raw: any[] = db
      .query(
        `select
          i.kind as item_kind,
          e.item_id as editor_id,
          i.workspace_id as workspace_id,
          w.paths as workspace_paths,
          w.timestamp as timestamp,
          e.buffer_path as buffer_path
        from items i
        join panes p on p.pane_id = i.pane_id and p.workspace_id = i.workspace_id
        join workspaces w on w.workspace_id = i.workspace_id
        left join editors e on e.item_id = i.item_id and e.workspace_id = i.workspace_id
        where i.active = 1 and p.active = 1
        order by w.timestamp desc`,
      )
      .all()

    const rows = raw.map((row) => ({
      item_kind: row.item_kind,
      editor_id: row.editor_id,
      workspace_id: row.workspace_id,
      workspace_paths: row.workspace_paths,
      timestamp: row.timestamp,
      buffer_path: row.buffer_path,
    }))

    if (raw.length > 0 && rows.length === 0) return { type: "unavailable" as const }

    const sortedRows = rows
      .map((row) => ({ row, score: scoreZedWorkspace(row.workspace_paths, cwd) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || right.row.timestamp.localeCompare(left.row.timestamp))
    const row = sortedRows[0]?.row
    if (!row) return { type: "empty" as const }
    if (row.item_kind !== "Editor") return { type: "unavailable" as const }
    if (row.editor_id == null) return { type: "empty" as const }
    return { type: "row" as const, row }
  } catch {
    return { type: "unavailable" as const }
  } finally {
    db?.close()
  }
}

function scoreZedWorkspace(workspacePaths: string | null, cwd: string) {
  return zedWorkspacePaths(workspacePaths).reduce((score, item) => {
    if (pathContains(item, cwd)) return Math.max(score, path.resolve(item).length)
    return score
  }, 0)
}

function zedWorkspacePaths(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string")
  } catch {}
  return value.split(/\r?\n/).filter(Boolean)
}

function pathContains(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function queryZedEditorSelections(dbPath: string, row: any) {
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    const raw: any[] = db
      .query(
        `select
          start as selection_start,
          end as selection_end
        from editor_selections
        where editor_id = $editorID and workspace_id = $workspaceID`,
      )
      .all({ $editorID: row.editor_id, $workspaceID: row.workspace_id })

    const selections = raw.map((sel) => ({
      selection_start: sel.selection_start,
      selection_end: sel.selection_end,
    }))

    if (raw.length > 0 && selections.length === 0) return { type: "unavailable" as const }
    return { type: "selections" as const, selections }
  } catch {
    return { type: "unavailable" as const }
  } finally {
    db?.close()
  }
}

function queryZedEditorContents(dbPath: string, row: any) {
  let db: Database | undefined
  try {
    db = new Database(dbPath, { readonly: true })
    const res: any = db
      .query(
        `select contents
        from editors
        where item_id = $editorID and workspace_id = $workspaceID`,
      )
      .get({ $editorID: row.editor_id, $workspaceID: row.workspace_id })
    if (!res) return { type: "unavailable" as const }
    return { type: "contents" as const, contents: res.contents }
  } catch {
    return { type: "unavailable" as const }
  } finally {
    db?.close()
  }
}
import { tmpdir } from "../../fixture/fixture"

const originalZedTerm = process.env.ZED_TERM
const originalTermProgram = process.env.TERM_PROGRAM

afterEach(() => {
  if (originalZedTerm === undefined) delete process.env.ZED_TERM
  else process.env.ZED_TERM = originalZedTerm
  if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = originalTermProgram
})

type ZedFixtureOptions = {
  workspacePaths?: string | null
  itemKind?: string
  editor?: boolean
  selectionStart?: number | null
  selectionEnd?: number | null
  selections?: Array<{ start: number | null; end: number | null }>
  contents?: string
}

async function writeZedFixture(dir: string, options: ZedFixtureOptions = {}) {
  const dbPath = path.join(dir, "zed.sqlite")
  const filePath = path.join(dir, "file.ts")
  const contents = options.contents ?? "one\ntwo\nthree"
  await Bun.write(filePath, contents)

  const db = new Database(dbPath)
  db.run("create table workspaces (workspace_id integer, paths text, timestamp text)")
  db.run("create table panes (pane_id integer, workspace_id integer, active integer)")
  db.run("create table items (item_id integer, workspace_id integer, pane_id integer, active integer, kind text)")
  db.run("create table editors (item_id integer, workspace_id integer, buffer_path text, contents text)")
  db.run("create table editor_selections (editor_id integer, workspace_id integer, start integer, end integer)")
  db.run("insert into workspaces values (1, ?, ?)", [options.workspacePaths ?? JSON.stringify([dir]), "2026-04-27"])
  db.run("insert into panes values (1, 1, 1)")
  db.run("insert into items values (1, 1, 1, 1, ?)", [options.itemKind ?? "Editor"])
  if (options.editor !== false) {
    db.run("insert into editors values (1, 1, ?, ?)", [filePath, contents])
    ;(
      options.selections ?? [
        {
          start: options.selectionStart === undefined ? 4 : options.selectionStart,
          end: options.selectionEnd === undefined ? 7 : options.selectionEnd,
        },
      ]
    ).forEach((selection) =>
      db.run("insert into editor_selections values (1, 1, ?, ?)", [selection.start, selection.end]),
    )
  }
  db.close()

  return { dbPath, filePath }
}

function utf8ByteOffset(text: string, offset: number) {
  return new TextEncoder().encode(text.slice(0, offset)).length
}

test("offsetToPosition converts Zed offsets to 1-based editor positions", () => {
  expect(offsetToPosition("one\ntwo\nthree", 0)).toEqual({ line: 1, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 4)).toEqual({ line: 2, character: 1 })
  expect(offsetToPosition("one\ntwo\nthree", 6)).toEqual({ line: 2, character: 3 })
  expect(offsetToPosition("one\ntwo\nthree", 100)).toEqual({ line: 3, character: 6 })
  expect(offsetToPosition("Ж\nabc", utf8ByteOffset("Ж\nabc", "Ж\nabc".indexOf("a")))).toEqual({
    line: 2,
    character: 1,
  })
  expect(offsetToPosition("😀\nabc", utf8ByteOffset("😀\nabc", "😀\nabc".indexOf("a")))).toEqual({
    line: 2,
    character: 1,
  })
})

test("resolveZedDbPath skips candidates that cannot be stated", async () => {
  await using tmp = await tmpdir()
  const loop = path.join(tmp.path, "loop")
  await symlink(loop, loop)
  const home = spyOn(os, "homedir").mockImplementation(() => tmp.path)
  const previous = process.env.OPENCODE_ZED_DB
  process.env.OPENCODE_ZED_DB = loop

  try {
    expect(resolveZedDbPath()).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_ZED_DB
    else process.env.OPENCODE_ZED_DB = previous
    home.mockRestore()
  }
})

test("isZedTerminal only returns true for Zed terminal environments", () => {
  delete process.env.ZED_TERM
  delete process.env.TERM_PROGRAM
  expect(isZedTerminal()).toBeFalse()

  process.env.ZED_TERM = "true"
  expect(isZedTerminal()).toBeTrue()

  process.env.ZED_TERM = "false"
  process.env.TERM_PROGRAM = "zed"
  expect(isZedTerminal()).toBeTrue()
})

test("resolveZedSelection returns active editor selection", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path)

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "two",
          selection: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 4 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection returns all active editor selections sorted by offset", async () => {
  await using tmp = await tmpdir()
  const contents = "one\ntwo\nthree\nfour"
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selections: [
      {
        start: utf8ByteOffset(contents, contents.indexOf("four")),
        end: utf8ByteOffset(contents, contents.indexOf("four") + 4),
      },
      {
        start: utf8ByteOffset(contents, contents.indexOf("two")),
        end: utf8ByteOffset(contents, contents.indexOf("two") + 3),
      },
    ],
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "two",
          selection: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 4 },
          },
        },
        {
          text: "four",
          selection: {
            start: { line: 4, character: 1 },
            end: { line: 4, character: 5 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection converts Zed UTF-8 byte offsets to string offsets", async () => {
  await using tmp = await tmpdir()
  const contents = "a\nЖЖЖЖЖЖЖЖЖЖ\nb\nTARGET\nz"
  const start = contents.indexOf("TARGET")
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selectionStart: utf8ByteOffset(contents, start),
    selectionEnd: utf8ByteOffset(contents, start + "TARGET".length),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "TARGET",
          selection: {
            start: { line: 4, character: 1 },
            end: { line: 4, character: 7 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection handles non-ASCII text inside the selected range", async () => {
  await using tmp = await tmpdir()
  const contents = "a\npre\nвыбор\nz"
  const start = contents.indexOf("выбор")
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selectionStart: utf8ByteOffset(contents, start),
    selectionEnd: utf8ByteOffset(contents, start + "выбор".length),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "выбор",
          selection: {
            start: { line: 3, character: 1 },
            end: { line: 3, character: 6 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection handles emoji before the selected range", async () => {
  await using tmp = await tmpdir()
  const contents = "😀\nTARGET\nz"
  const start = contents.indexOf("TARGET")
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selectionStart: utf8ByteOffset(contents, start),
    selectionEnd: utf8ByteOffset(contents, start + "TARGET".length),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "TARGET",
          selection: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 7 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection handles reversed Zed byte offsets", async () => {
  await using tmp = await tmpdir()
  const contents = "a\nЖЖЖ\nTARGET\nz"
  const start = contents.indexOf("TARGET")
  const fixture = await writeZedFixture(tmp.path, {
    contents,
    selectionStart: utf8ByteOffset(contents, start + "TARGET".length),
    selectionEnd: utf8ByteOffset(contents, start),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "TARGET",
          selection: {
            start: { line: 3, character: 1 },
            end: { line: 3, character: 7 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection returns empty when no workspace matches", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path, {
    workspacePaths: JSON.stringify([path.join(path.dirname(tmp.path), "other-workspace")]),
  })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({ type: "empty" })
})

test("resolveZedSelection matches a Zed workspace that contains the session directory", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path)

  expect(await resolveZedSelection(fixture.dbPath, path.join(tmp.path, "packages", "app"))).toEqual({
    type: "selection",
    selection: {
      filePath: fixture.filePath,
      source: "zed",
      ranges: [
        {
          text: "two",
          selection: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 4 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection prefers the most specific containing Zed workspace", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path)
  const child = path.join(tmp.path, "packages")
  const childFile = path.join(child, "child.ts")
  await mkdir(child, { recursive: true })
  await Bun.write(childFile, "child")

  const db = new Database(fixture.dbPath)
  db.run("insert into workspaces values (2, ?, ?)", [JSON.stringify([child]), "2026-01-01"])
  db.run("insert into panes values (2, 2, 1)")
  db.run("insert into items values (2, 2, 2, 1, ?)", ["Editor"])
  db.run("insert into editors values (2, 2, ?, ?)", [childFile, "child"])
  db.run("insert into editor_selections values (2, 2, 0, 5)")
  db.close()

  expect(await resolveZedSelection(fixture.dbPath, path.join(child, "app"))).toEqual({
    type: "selection",
    selection: {
      filePath: childFile,
      source: "zed",
      ranges: [
        {
          text: "child",
          selection: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 6 },
          },
        },
      ],
    },
  })
})

test("resolveZedSelection ignores a Zed workspace nested inside the session directory", async () => {
  await using tmp = await tmpdir()
  const child = path.join(tmp.path, "effect-lab")
  await mkdir(child, { recursive: true })
  const fixture = await writeZedFixture(child)

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({ type: "empty" })
})

test("resolveZedSelection returns unavailable when a Zed terminal is active", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path, { itemKind: "Terminal", editor: false })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({ type: "unavailable" })
})

test("resolveZedSelection returns unavailable when the database cannot be queried", async () => {
  await using tmp = await tmpdir()

  expect(await resolveZedSelection(path.join(tmp.path, "missing.sqlite"), tmp.path)).toEqual({ type: "unavailable" })
})

test("resolveZedSelection returns unavailable when active selection is missing offsets", async () => {
  await using tmp = await tmpdir()
  const fixture = await writeZedFixture(tmp.path, { selectionStart: null, selectionEnd: null })

  expect(await resolveZedSelection(fixture.dbPath, tmp.path)).toEqual({ type: "unavailable" })
})
