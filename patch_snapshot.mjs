import fs from 'fs';

const file = 'packages/tribunus-mcp/src/services/code-intelligence/snapshot.ts';
let content = fs.readFileSync(file, 'utf8');

const startIdx = content.indexOf('  const verifyDone = timeline.start("verify", { message: "Verifying semantic artifacts are byte-identical" })');
const endIdx = content.indexOf('timeline.mark("complete", performance.now() - pairedStarted)');

if (startIdx !== -1 && endIdx !== -1) {
  content = content.substring(0, startIdx) + content.substring(endIdx);
  fs.writeFileSync(file, content);
}
