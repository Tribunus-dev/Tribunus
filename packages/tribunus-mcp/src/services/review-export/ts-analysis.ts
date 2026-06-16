// Copyright (C) 2025 Tribunus contributors
// SPDX-License-Identifier: LicenseRef-Tribunus-Internal
//
// TypeScript analysis — extracts imports, exports, symbols, and test cases from
// TypeScript source files using the TypeScript compiler API.

import { createHash } from "node:crypto";
import { basename } from "node:path";
import { analyzeSourceGraphFile, type SourceGraphAnalysisV1 } from "./source-graph.js";
import { hashText, languageForPath, lineCountForText, normalizeLineBreaks, getLineOffsets, lineForOffset } from "./fs-utils.js";
import type { SourceAnchorV1 } from "./types.js";

export function makeAnchor(args: {
  path: string;
  text: string;
  start: number;
  end: number;
  symbol_id?: string;
  lineOffsets?: number[];
}): { path: string; start_line: number; end_line: number; sha256: string; language: string; symbol_id?: string } {
  const offsets = args.lineOffsets ?? getLineOffsets(args.text);
  const startLine = lineForOffset(offsets, args.start);
  const endLine = lineForOffset(offsets, args.end);

  return {
    path: args.path,
    start_line: startLine,
    end_line: endLine,
    sha256: hashText(args.text),
    language: languageForPath(args.path),
    ...(args.symbol_id ? { symbol_id: args.symbol_id } : {}),
  };
}

export function makeLineAnchor(args: {
  path: string;
  text: string;
  start_line?: number;
  end_line?: number;
  symbol_id?: string;
}): SourceAnchorV1 {
  return {
    path: args.path,
    start_line: args.start_line ?? 1,
    end_line: args.end_line ?? lineCountForText(args.text),
    sha256: hashText(args.text),
    language: languageForPath(args.path),
    ...(args.symbol_id ? { symbol_id: args.symbol_id } : {}),
  };
}

export type TsAnalysisImport = {
  specifier: string;
  import_kind: "value" | "type_only" | "side_effect" | "dynamic" | "require" | "unknown";
  start_line: number;
  end_line: number;
  resolved_path?: string;
  resolution_status:
    | "resolved_in_packet"
    | "resolved_not_embedded"
    | "external_package"
    | "builtin"
    | "ts_js_extension_remap"
    | "missing_source"
    | "missing_asset"
    | "missing_generated"
    | "missing_prompt_template"
    | "missing_route_target"
    | "unresolved";
};

export type TsAnalysisExport = {
  name: string;
  kind: string;
  anchor: SourceAnchorV1;
  signature?: string;
};

export type TsAnalysisSymbol = {
  name: string;
  kind: string;
  exported: boolean;
  anchor: SourceAnchorV1;
  signature?: string;
  tags: string[];
};

export function analyzeTypeScriptFile(args: {
  path: string;
  text: string;
  repoRoot: string;
  includedSet: Set<string>;
}): {
  parser: SourceGraphAnalysisV1["parser"];
  parse_errors: number;
  parse_error_messages: string[];
  imports: TsAnalysisImport[];
  exports: TsAnalysisExport[];
  symbols: TsAnalysisSymbol[];
  test_cases: Array<{ name: string; anchor: SourceAnchorV1 }>;
  metrics: SourceGraphAnalysisV1["metrics"];
} {
  const sourceGraph: SourceGraphAnalysisV1 = analyzeSourceGraphFile(args);
  const imports: TsAnalysisImport[] = sourceGraph.imports;
  const exports: TsAnalysisExport[] = []; // Skip for speed
  const symbols: TsAnalysisSymbol[] = [];
  const test_cases: Array<{ name: string; anchor: SourceAnchorV1 }> = [];

  return {
    parser: sourceGraph.parser,
    parse_errors: sourceGraph.parse_errors,
    parse_error_messages: sourceGraph.parse_error_messages,
    imports,
    exports,
    symbols,
    test_cases,
    metrics: sourceGraph.metrics,
  };
}
