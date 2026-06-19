import { mkdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { PublicationRecord } from "./types.ts"

export function releaseLedgerPath(releaseDir: string): string {
  return resolve(releaseDir, "releases", "publication.json")
}

export async function readReleaseLedger(releaseDir: string): Promise<PublicationRecord | null> {
  const path = releaseLedgerPath(releaseDir)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, "utf8")) as PublicationRecord
  } catch {
    return null
  }
}

export async function writeReleaseLedger(releaseDir: string, record: PublicationRecord): Promise<void> {
  const path = releaseLedgerPath(releaseDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(record, null, 2), "utf8")
}
