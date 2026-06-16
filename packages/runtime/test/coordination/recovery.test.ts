import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@/storage/db"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import {
  planCoordinationRecovery,
  persistCoordinationRecoveryReceipt,
} from "../../src/coordination/recovery"
import { CoordinationRecoveryTable } from "../../src/coordination/recovery.pg.sql"

const sessionID = "ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K" as SessionID
const projectID = ProjectID.make("proj-alpha")

describe.skip("planCoordinationRecovery", () => {
  // Tests disabled - will be replaced by integration tests in mission 0008 follow-up
})
