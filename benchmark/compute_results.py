"""
Aggregates appearance and functional scores across all task result directories
and prints a summary table plus writes results/summary.json.

Usage:
  python compute_results.py --out results/
"""

import argparse
import json
from pathlib import Path


def load_results(out_root: Path) -> list[dict]:
    rows = []
    for task_dir in sorted(d for d in out_root.iterdir() if d.is_dir()):
        meta_path = task_dir / "metadata.json"
        app_path = task_dir / "appearance.json"
        func_path = task_dir / "functional.json"

        if not meta_path.exists():
            continue

        meta = json.loads(meta_path.read_text())
        row = {
            "id": task_dir.name,
            "slug": meta.get("slug", ""),
            "category": meta.get("category", ""),
            "application_type": meta.get("application_type", ""),
            "elapsed_s": meta.get("elapsed_s"),
            "html_generated": (task_dir / "page.html").exists(),
            "screenshot_taken": (task_dir / "shot.png").exists(),
            "appearance_score": None,
            "yes": None,
            "partial": None,
            "no": None,
            "na": None,
            "evaluable_tasks": None,
        }

        if app_path.exists():
            app = json.loads(app_path.read_text())
            row["appearance_score"] = app.get("score")

        if func_path.exists():
            func = json.loads(func_path.read_text())
            counts = func.get("counts", {})
            yes = counts.get("yes", 0)
            partial = counts.get("partial", 0)
            no = counts.get("no", 0)
            na = counts.get("na", 0)
            evaluable = yes + partial + no
            row.update(
                {
                    "yes": yes,
                    "partial": partial,
                    "no": no,
                    "na": na,
                    "evaluable_tasks": evaluable,
                }
            )

        rows.append(row)
    return rows


def compute_summary(rows: list[dict]) -> dict:
    total = len(rows)
    generated = sum(1 for r in rows if r["html_generated"])
    screenshotted = sum(1 for r in rows if r["screenshot_taken"])

    appearance_scores = [r["appearance_score"] for r in rows if r["appearance_score"] is not None]
    avg_appearance = sum(appearance_scores) / len(appearance_scores) if appearance_scores else None

    yes_total = sum(r["yes"] or 0 for r in rows)
    partial_total = sum(r["partial"] or 0 for r in rows)
    no_total = sum(r["no"] or 0 for r in rows)
    na_total = sum(r["na"] or 0 for r in rows)
    evaluable_total = sum(r["evaluable_tasks"] or 0 for r in rows)

    yes_rate = yes_total / evaluable_total if evaluable_total else None
    partial_rate = partial_total / evaluable_total if evaluable_total else None
    no_rate = no_total / evaluable_total if evaluable_total else None
    na_pct = na_total / (evaluable_total + na_total) if (evaluable_total + na_total) else None

    return {
        "total_tasks": total,
        "pages_generated": generated,
        "screenshots_taken": screenshotted,
        "appearance_scored": len(appearance_scores),
        "avg_appearance_score": round(avg_appearance, 2) if avg_appearance is not None else None,
        "functional_yes_rate": round(yes_rate, 3) if yes_rate is not None else None,
        "functional_partial_rate": round(partial_rate, 3) if partial_rate is not None else None,
        "functional_no_rate": round(no_rate, 3) if no_rate is not None else None,
        "functional_na_pct": round(na_pct, 3) if na_pct is not None else None,
        "functional_evaluable_tasks": evaluable_total,
        "functional_na_tasks": na_total,
    }


def print_table(rows: list[dict]) -> None:
    header = (
        f"{'ID':<10} {'Slug':<40} {'App(1-5)':>8} {'YES':>5} {'PAR':>5} {'NO':>5} {'NA':>5}"
    )
    print(header)
    print("-" * len(header))
    for r in rows:
        app = f"{r['appearance_score']:.0f}" if r["appearance_score"] is not None else "-"
        yes = str(r["yes"]) if r["yes"] is not None else "-"
        par = str(r["partial"]) if r["partial"] is not None else "-"
        no = str(r["no"]) if r["no"] is not None else "-"
        na = str(r["na"]) if r["na"] is not None else "-"
        slug = r["slug"][:40]
        print(f"{r['id']:<10} {slug:<40} {app:>8} {yes:>5} {par:>5} {no:>5} {na:>5}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="results")
    args = parser.parse_args()

    out_root = Path(args.out)
    rows = load_results(out_root)

    if not rows:
        print("No results found.")
        return

    print_table(rows)
    print()

    summary = compute_summary(rows)
    print("=== Summary ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")

    summary_path = out_root / "summary.json"
    summary_path.write_text(
        json.dumps({"summary": summary, "tasks": rows}, indent=2), encoding="utf-8"
    )
    print(f"\nFull results written to {summary_path}")


if __name__ == "__main__":
    main()
