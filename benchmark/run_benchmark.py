"""
Orchestrates the full benchmark pipeline:
  1. generate_pages   — hit the app per task, reset components between runs
  2. screenshot       — capture Playwright screenshots
  3. score_appearance — VLM rates each page 1-5
  4. score_functional — LLM evaluates HTML against ui_instruct tasks
  5. compute_results  — aggregate and print summary

Each stage is idempotent: already-completed task results are skipped,
so interrupted runs can be resumed safely.

Usage:
  python run_benchmark.py \\
    --tasks /path/to/WebGen-Bench/data/test.jsonl \\
    --app-url http://localhost:5173 \\
    --functions-url http://localhost:5001/<project-id>/europe-southwest1 \\
    [--out results] [--limit 5] [--skip-reset] \\
    [--appearance-model claude-sonnet-4-6] \\
    [--functional-model claude-haiku-4-5-20251001] \\
    [--workers 4]

Required env vars:
  BENCHMARK_ID_TOKEN   Firebase ID token for auth
  ANTHROPIC_API_KEY    (or OPENAI_API_KEY if using GPT models)

Optional env vars:
  FUNCTIONS_URL        Override --functions-url
  APPEARANCE_MODEL     Override --appearance-model
  FUNCTIONAL_MODEL     Override --functional-model
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


def run_stage(label: str, cmd: list[str]) -> None:
    print(f"\n{'=' * 60}")
    print(f"  Stage: {label}")
    print(f"{'=' * 60}")
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(f"\n[WARNING] Stage '{label}' exited with code {result.returncode}. "
              "Continuing to next stage.")


def main():
    parser = argparse.ArgumentParser(description="Run the full WebGen-Bench benchmark pipeline.")
    parser.add_argument("--tasks", required=True, help="Path to WebGen-Bench data/test.jsonl")
    parser.add_argument("--app-url", default="http://localhost:5173")
    parser.add_argument(
        "--functions-url",
        default=os.environ.get("FUNCTIONS_URL", ""),
        help="Firebase functions base URL for resetComponents calls",
    )
    parser.add_argument("--out", default="results")
    parser.add_argument("--limit", type=int, default=None, help="Max tasks (for smoke tests)")
    parser.add_argument("--skip-reset", action="store_true")
    parser.add_argument(
        "--appearance-model",
        default=os.environ.get("APPEARANCE_MODEL", "claude-sonnet-4-6"),
    )
    parser.add_argument(
        "--functional-model",
        default=os.environ.get("FUNCTIONAL_MODEL", "claude-haiku-4-5-20251001"),
    )
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--stages",
        nargs="+",
        choices=["generate", "screenshot", "appearance", "functional", "results"],
        default=["generate", "screenshot", "appearance", "functional", "results"],
        help="Run only specific stages",
    )
    args = parser.parse_args()

    python = sys.executable
    here = Path(__file__).parent.resolve()
    out = str(Path(args.out).resolve())
    tasks = str(Path(args.tasks).resolve())

    Path(out).mkdir(parents=True, exist_ok=True)

    stages_map = {
        "generate": lambda: run_stage(
            "Generate pages",
            [python, str(here / "generate_pages.py"),
             "--tasks", tasks,
             "--app-url", args.app_url,
             "--functions-url", args.functions_url,
             "--out", out,
             *(["--limit", str(args.limit)] if args.limit else []),
             *(["--skip-reset"] if args.skip_reset else []),
             ],
        ),
        "screenshot": lambda: run_stage(
            "Take screenshots",
            [python, str(here / "screenshot.py"), "--out", out],
        ),
        "appearance": lambda: run_stage(
            "Score appearance",
            [python, str(here / "score_appearance.py"),
             "--out", out,
             "--model", args.appearance_model,
             "--workers", str(args.workers),
             ],
        ),
        "functional": lambda: run_stage(
            "Score functional",
            [python, str(here / "score_functional.py"),
             "--tasks", tasks,
             "--out", out,
             "--model", args.functional_model,
             "--workers", str(args.workers),
             ],
        ),
        "results": lambda: run_stage(
            "Compute results",
            [python, str(here / "compute_results.py"), "--out", out],
        ),
    }

    ordered = ["generate", "screenshot", "appearance", "functional", "results"]
    for stage in ordered:
        if stage in args.stages:
            stages_map[stage]()

    print("\nBenchmark pipeline complete.")


if __name__ == "__main__":
    main()
