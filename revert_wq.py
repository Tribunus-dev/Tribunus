with open("packages/runtime/src/coordination/work-queue.ts", "r") as f:
    lines = f.readlines()

while len(lines) > 0 and lines[-1].strip() == "":
    lines.pop()

with open("packages/runtime/src/coordination/work-queue.ts", "w") as f:
    f.writelines(lines)
