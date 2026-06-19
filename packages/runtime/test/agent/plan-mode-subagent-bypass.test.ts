
it.instance("[#26514] subagent spawned from plan mode CAN edit .md files in plans dir (allow rule forwarded)", () =>
  Effect.gen(function* () {
    const planAgent = yield* Agent.use.get("plan")
    const generalAgent = yield* Agent.use.get("general")

    const parentSessionPermission: Permission.Ruleset = []
    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentSessionPermission,
      parentAgent: planAgent,
      subagent: generalAgent!,
    })
    const effective = Permission.merge(generalAgent!.permission, subagentSessionPermission)

    // edit rule for .md files in plans/ is "allow" in plan mode
    expect(Permission.evaluate("edit", ".opencode/plans/foo.md", effective).action).toBe("allow")
  }),
)
