from __future__ import annotations

import argparse
import csv
import json
import re
import runpy
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def normalize_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_lookup(value: str | None) -> str:
    normalized = unicodedata.normalize("NFD", normalize_text(value))
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return normalized.upper()


def split_box_hints(notes: str | None) -> list[str]:
    if not notes:
        return []
    marker = "caixas="
    if marker not in notes:
        return []
    suffix = notes.split(marker, 1)[1].strip()
    if not suffix:
        return []
    return [part.strip() for part in suffix.split(" | ") if part.strip()]


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def write_assist_csv(rows: list[dict[str, str]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "import_key",
        "sheet",
        "iso_date",
        "time_hint",
        "customer_name",
        "raw_rows",
        "invalid_reasons",
        "invalid_rows",
        "resolution_rows",
        "resolution_notes",
        "suggested_resolution_rows",
        "suggestion_confidence",
        "suggestion_basis",
        "matching_history_count",
        "matching_history_examples",
        "auto_applied",
    ]
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def write_resolution_csv(rows: list[dict[str, str]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "import_key",
        "sheet",
        "iso_date",
        "time_hint",
        "customer_name",
        "raw_rows",
        "invalid_reasons",
        "invalid_rows",
        "resolution_rows",
        "resolution_notes",
    ]
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def build_customer_history(database_path: Path, parse_box_hint, hist_code: str) -> dict[str, Counter[tuple[str, ...]]]:
    conn = sqlite3.connect(str(database_path))
    cur = conn.cursor()
    rows = cur.execute(
        '''
        select c.name, o.notes
        from "Order" o
        join "Customer" c on c.id = o.customerId
        where o.notes like '[IMPORTADO_PLANILHA_LEGADA]%'
        order by o.scheduledAt, o.id
        '''
    ).fetchall()
    conn.close()

    history: dict[str, Counter[tuple[str, ...]]] = defaultdict(Counter)
    for customer_name, notes in rows:
        box_hints = split_box_hints(notes)
        if not box_hints:
            continue
        parsed = [parse_box_hint(hint) for hint in box_hints]
        if any(item is None for item in parsed):
            continue
        if any(hist_code in item.counts for item in parsed):
            continue
        history[normalize_lookup(customer_name)][tuple(box_hints)] += 1
    return history


def suggest_rows(
    pending_rows: list[dict[str, str]],
    history_by_customer: dict[str, Counter[tuple[str, ...]]],
) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for row in pending_rows:
        current = dict(row)
        current.setdefault("resolution_rows", "")
        current.setdefault("resolution_notes", "")
        current["suggested_resolution_rows"] = ""
        current["suggestion_confidence"] = ""
        current["suggestion_basis"] = ""
        current["matching_history_count"] = "0"
        current["matching_history_examples"] = ""
        current["auto_applied"] = "no"

        customer_key = normalize_lookup(row.get("customer_name"))
        history_counter = history_by_customer.get(customer_key, Counter())
        box_count = len(json.loads(row.get("invalid_rows") or "[]")) or 1
        exact_matches = {seq: count for seq, count in history_counter.items() if len(seq) == box_count}

        if len(exact_matches) == 1:
            sequence, count = next(iter(exact_matches.items()))
            current["suggested_resolution_rows"] = " | ".join(sequence)
            current["matching_history_count"] = str(count)
            current["matching_history_examples"] = " | ".join(sequence)
            if count >= 2:
                current["suggestion_confidence"] = "high"
                current["suggestion_basis"] = (
                    "mesmo cliente com a mesma composicao concreta em pelo menos 2 pedidos historicos importados"
                )
            else:
                current["suggestion_confidence"] = "medium"
                current["suggestion_basis"] = (
                    "mesmo cliente com uma composicao concreta unica e com o mesmo numero de caixas em 1 pedido historico importado"
                )
        elif exact_matches:
            current["matching_history_count"] = str(sum(exact_matches.values()))
            current["matching_history_examples"] = " || ".join(
                f"{' | '.join(seq)} ({count}x)" for seq, count in exact_matches.items()
            )
            current["suggestion_confidence"] = "low"
            current["suggestion_basis"] = "cliente com historico concreto, mas com mais de uma composicao possivel para o mesmo numero de caixas"
        result.append(current)
    return result


def auto_apply_high_confidence(rows: list[dict[str, str]]) -> int:
    applied = 0
    for row in rows:
        if row.get("resolution_rows"):
            continue
        if row.get("suggestion_confidence") != "high":
            continue
        suggestion = row.get("suggested_resolution_rows", "")
        if not suggestion:
            continue
        row["resolution_rows"] = suggestion
        row["resolution_notes"] = (
            row.get("resolution_notes") or "[AUTO] sugestao aplicada por historico concreto repetido"
        )
        row["auto_applied"] = "yes"
        applied += 1
    return applied


def apply_all_with_t_fallback(rows: list[dict[str, str]]) -> int:
    applied = 0
    for row in rows:
        if row.get("resolution_rows"):
            continue

        suggestion = row.get("suggested_resolution_rows", "")
        if suggestion:
            row["resolution_rows"] = suggestion
            row["resolution_notes"] = (
                row.get("resolution_notes")
                or f"[AUTO] sugestao {row.get('suggestion_confidence') or 'assistida'} aplicada por pedido do usuario"
            )
            row["auto_applied"] = "yes"
            applied += 1
            continue

        invalid_rows = json.loads(row.get("invalid_rows") or "[]")
        box_count = len(invalid_rows) or 1
        fallback = " | ".join(["T"] * box_count)
        row["resolution_rows"] = fallback
        row["resolution_notes"] = (
            row.get("resolution_notes")
            or "[AUTO] fallback T aplicado por pedido do usuario para caso sem composicao"
        )
        row["auto_applied"] = "yes"
        applied += 1
    return applied


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sugere resolucoes para pedidos legados sem composicao.")
    parser.add_argument("--database", default="apps/api/prisma/dev.db")
    parser.add_argument("--pending-csv", default="output/spreadsheet/legacy-order-import-pending.csv")
    parser.add_argument("--resolution-csv", default="output/spreadsheet/legacy-order-import-resolutions.csv")
    parser.add_argument("--assist-csv", default="output/spreadsheet/legacy-order-import-assist.csv")
    parser.add_argument("--apply-high-confidence", action="store_true")
    parser.add_argument("--apply-all-with-t-fallback", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    mod = runpy.run_path("scripts/import-legacy-orders.py")
    parse_box_hint = mod["parse_box_hint"]
    hist_code = mod["HISTORICAL_CUSTOM_BOX_CODE"]

    pending_path = Path(args.pending_csv)
    resolution_path = Path(args.resolution_csv)
    assist_path = Path(args.assist_csv)
    db_path = Path(args.database)

    pending_rows = read_csv_rows(pending_path)
    existing_resolution_rows = {row.get("import_key", ""): row for row in read_csv_rows(resolution_path)}
    merged_rows: list[dict[str, str]] = []
    for row in pending_rows:
        merged = dict(row)
        existing = existing_resolution_rows.get(row.get("import_key", ""), {})
        merged["resolution_rows"] = existing.get("resolution_rows", "")
        merged["resolution_notes"] = existing.get("resolution_notes", "")
        merged_rows.append(merged)

    history_by_customer = build_customer_history(db_path, parse_box_hint, hist_code)
    assisted_rows = suggest_rows(merged_rows, history_by_customer)
    applied = 0
    if args.apply_all_with_t_fallback:
        applied = apply_all_with_t_fallback(assisted_rows)
    elif args.apply_high_confidence:
        applied = auto_apply_high_confidence(assisted_rows)

    write_assist_csv(assisted_rows, assist_path)
    write_resolution_csv(assisted_rows, resolution_path)

    counts = Counter(row.get("suggestion_confidence", "") or "none" for row in assisted_rows)
    print({
        "pending_rows": len(assisted_rows),
        "suggestion_counts": dict(sorted(counts.items())),
        "auto_applied": applied,
        "assist_csv": str(assist_path),
        "resolution_csv": str(resolution_path),
    })


if __name__ == "__main__":
    main()
