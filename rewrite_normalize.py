import re

code = """
function normalizeMessages(
  msgs: ModelMessage[],
  model: Provider.Model,
  _options: Record<string, unknown>,
): ModelMessage[] {
...
"""
# I'll create a script to rewrite normalizeMessages so it does everything in a single pass or fewer passes.
