import fs from 'fs';

const file = 'packages/runtime/src/agent/subagent-permissions.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  `const parentAgentDenies =
    input.parentAgent?.permission.filter((rule) => rule.action === "deny" && rule.permission === "edit") ?? []`,
  `const parentAgentDenies =
    input.parentAgent?.permission.filter(
      (rule) =>
        rule.action === "deny" &&
        (rule.permission === "edit" || rule.permission === "write" || rule.permission === "apply_patch"),
    ) ?? []`
);

fs.writeFileSync(file, content);
