#!/usr/bin/env python3
"""Validation script for Tribunus Compute Evidence Corpus.

Validates Parquet/Arrow data against the v1 JSON Schemas using pyarrow
and the built-in JSON Schema validation. Computes row counts, detects
schema violations, and reports missing required fields.

Usage:
    python validation.py --data-dir /path/to/parquet/files
    python validation.py --data-dir /path/to/parquet/files --schema-dir schemas/v1
"""

import argparse
import json
import sys
from pathlib import Path
from urllib.request import urlopen

try:
    import pyarrow.parquet as pq
    import pyarrow as pa
except ImportError:
    sys.exit("pyarrow is required. Install with: pip install pyarrow")


def load_schema(schema_path: Path) -> dict:
    """Load a JSON Schema (2020-12) from a file path or URL."""
    with open(schema_path) as f:
        return json.load(f)


def _resolve_refs(schema: dict, base_dir: Path) -> dict:
    """Naive local $ref resolution for sibling schemas.

    Only handles local file references like './runs.schema.json'.
    Does not handle remote $ref or nested $ref chains.
    """
    resolved = dict(schema)
    ref = resolved.get("$ref")
    if ref and not ref.startswith("http"):
        ref_path = (base_dir / ref).resolve()
        with open(ref_path) as f:
            resolved_ref = json.load(f)
        resolved_ref.pop("$id", None)
        resolved_ref.pop("$schema", None)
        resolved.update(resolved_ref)
        resolved.pop("$ref", None)
    for key in list(resolved.keys()):
        value = resolved[key]
        if isinstance(value, dict):
            resolved[key] = _resolve_refs(value, base_dir)
        elif isinstance(value, list):
            resolved[key] = [
                _resolve_refs(item, base_dir) if isinstance(item, dict) else item
                for item in value
            ]
    return resolved


def _validate_value(value, schema: dict, path: str) -> list[str]:
    """Validate a single value against a JSON Schema property definition.

    Returns a list of validation error messages (empty list = valid).
    """
    errors: list[str] = []

    if schema.get("type") == "array":
        if value is None:
            return ["null is not an array"]
        if not isinstance(value, list):
            return [f"expected array, got {type(value).__name__}"]
        for i, item in enumerate(value):
            items_schema = schema.get("items", {})
            errors.extend(_validate_value(item, items_schema, f"{path}[{i}]"))
        return errors

    if schema.get("type") == "object":
        if value is None:
            return ["null is not an object"]
        if not isinstance(value, dict):
            return [f"expected object, got {type(value).__name__}"]
        required = schema.get("required", [])
        for field in required:
            if field not in value or value.get(field) is None:
                errors.append(f"{path}.{field}: missing required field")
        properties = schema.get("properties", {})
        for key, val in (value or {}).items():
            if key in properties:
                errors.extend(_validate_value(val, properties[key], f"{path}.{key}"))
        return errors

    # Primitive type check
    expected_type = schema.get("type")
    if expected_type and value is not None:
        type_map = {
            "string": str,
            "integer": int,
            "number": (int, float),
            "boolean": bool,
        }
        py_types = type_map.get(expected_type)
        if py_types and not isinstance(value, py_types):
            errors.append(f"{path}: expected {expected_type}, got {type(value).__name__} ({value!r})")

    # Enum check
    enum_values = schema.get("enum")
    if enum_values and value is not None and value not in enum_values:
        errors.append(f"{path}: value {value!r} not in enum {enum_values}")

    # Pattern check (string)
    pattern = schema.get("pattern")
    if pattern and isinstance(value, str):
        import re
        if not re.match(pattern, value):
            errors.append(f"{path}: value {value!r} does not match pattern {pattern!r}")

    # Minimum / exclusiveMinimum
    minimum = schema.get("minimum")
    exclusive_min = schema.get("exclusiveMinimum")
    if isinstance(value, (int, float)):
        if minimum is not None and value < minimum:
            errors.append(f"{path}: {value} < minimum ({minimum})")
        if exclusive_min is not None and value <= exclusive_min:
            errors.append(f"{path}: {value} <= exclusiveMinimum ({exclusive_min})")

    return errors


def validate_table(
    table: pa.Table,
    schema_def: dict,
    table_name: str,
) -> list[str]:
    """Validate a pyarrow Table against a JSON Schema definition.

    Returns a list of human-readable error messages.
    """
    errors: list[str] = []
    required = schema_def.get("required", [])
    properties = schema_def.get("properties", {})
    col_names = set(table.column_names)

    # Check required columns exist
    for field in required:
        if field not in col_names:
            errors.append(f"[{table_name}] Missing required column: {field}")

    # Check known property types (for string columns only using Arrow metadata)
    for col_name, col_schema in properties.items():
        if col_name not in col_names:
            continue

        col_idx = table.schema.get_field_index(col_name)
        arrow_type = table.schema.field(col_idx).type
        expected_type = col_schema.get("type")

        # Only warn on obvious Arrow-type mismatches (pyarrow types aren't 1:1 with JSON type names)
        type_hints = {
            "string": pa.types.is_string,
            "integer": pa.types.is_integer,
            "number": lambda t: pa.types.is_floating(t) or pa.types.is_integer(t),
            "boolean": pa.types.is_boolean,
        }

        checker = type_hints.get(expected_type)
        if checker and not checker(arrow_type):
            errors.append(
                f"[{table_name}] Column '{col_name}': Arrow type {arrow_type} "
                f"may not match expected JSON Schema type '{expected_type}'"
            )

    # Scan rows for per-value violations (sample up to 100 rows for large tables)
    nrows = table.num_rows
    sample_size = min(nrows, 100)

    # Build a list of batch-start row indices for sampling
    if nrows <= 100:
        row_indices = list(range(nrows))
    else:
        # Take evenly spaced samples
        step = nrows // 100
        row_indices = list(range(0, nrows, step))[:100]

    for row_idx in row_indices:
        row = table.slice(row_idx, 1).to_pydict()

        # Check required fields for nulls
        for field in required:
            val = row.get(field, [None])[0]
            if val is None:
                errors.append(f"[{table_name}] Row {row_idx}: required field '{field}' is null")

        # Check enum and pattern constraints
        for col_name, col_schema in properties.items():
            val = row.get(col_name, [None])[0]
            if val is None:
                continue

            field_path = f"[{table_name}] Row {row_idx}.{col_name}"
            field_errors = _validate_value(val, col_schema, field_path)
            errors.extend(field_errors)

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate Tribunus evidence corpus against JSON Schemas"
    )
    parser.add_argument(
        "--data-dir",
        required=True,
        type=Path,
        help="Directory containing Parquet files (one per table)",
    )
    parser.add_argument(
        "--schema-dir",
        type=Path,
        default=None,
        help="Directory containing JSON Schema files (default: schemas/v1 next to this script)",
    )
    args = parser.parse_args()

    data_dir = args.data_dir
    schema_dir = args.schema_dir or (Path(__file__).resolve().parent)

    if not data_dir.is_dir():
        sys.exit(f"Data directory not found: {data_dir}")
    if not schema_dir.is_dir():
        sys.exit(f"Schema directory not found: {schema_dir}")

    # Map table names to expected file names
    table_schema_map = {
        "runs": schema_dir / "runs.schema.json",
        "hardware_profiles": schema_dir / "hardware_profiles.schema.json",
        "backend_observations": schema_dir / "backend_observations.schema.json",
        "compiler_manifests": schema_dir / "compiler_manifests.schema.json",
        "artifacts": schema_dir / "artifacts.schema.json",
    }

    all_errors: list[str] = []
    total_rows = 0

    for table_name, schema_path in table_schema_map.items():
        parquet_path = data_dir / f"{table_name}.parquet"

        if not parquet_path.exists():
            # Try alternative extensions
            parquet_path = data_dir / f"{table_name}.arrow"
            if not parquet_path.exists():
                all_errors.append(f"Missing data file for table '{table_name}'")
                continue

        if not schema_path.exists():
            all_errors.append(f"Missing schema file for table '{table_name}': {schema_path}")
            continue

        print(f"--- {table_name} ---", file=sys.stderr)

        # Load schema and data
        schema_def = load_schema(schema_path)
        schema_def = _resolve_refs(schema_def, schema_dir)
        table = pq.read_table(str(parquet_path))

        row_count = table.num_rows
        total_rows += row_count
        print(f"  Rows: {row_count}", file=sys.stderr)

        errors = validate_table(table, schema_def, table_name)
        if errors:
            for err in errors:
                print(f"  ERROR: {err}", file=sys.stderr)
                all_errors.append(err)
        else:
            print(f"  Validation: PASS", file=sys.stderr)

    print(file=sys.stderr)
    print(f"Total rows across all tables: {total_rows}", file=sys.stderr)
    print(f"Total errors: {len(all_errors)}", file=sys.stderr)

    if all_errors:
        print("\nVALIDATION FAILED", file=sys.stderr)
        sys.exit(1)
    else:
        print("\nVALIDATION PASSED", file=sys.stderr)


if __name__ == "__main__":
    main()
