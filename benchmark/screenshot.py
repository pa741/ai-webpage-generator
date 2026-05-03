"""
Takes screenshots of saved generated HTML pages using Playwright.

For each task directory that has a page.html but no shot.png, this script
wraps the HTML fragment in a minimal full-page shell and serves it via a
local HTTP server so that web component <script> tags (which reference
Firebase Storage signed URLs) can load without CORS issues. A data:// URI
has a null origin which Firebase Storage blocks by default.

Usage:
  python screenshot.py --out results/ [--width 1280] [--height 900]
"""

import argparse
import functools
import http.server
import json
import shutil
import socket
import tempfile
import threading
from pathlib import Path

from tqdm import tqdm

# Minimal HTML shell that loads Tailwind (matches the live app environment)
_SHELL = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Benchmark Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body {{ margin: 0; }}</style>
</head>
<body>
{body}
</body>
</html>
"""


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _LocalServer:
    """Serves a single index.html from a temp directory on a random localhost port."""

    def __init__(self):
        self._tmpdir = tempfile.mkdtemp(prefix="benchmark-screenshot-")
        self._port = _find_free_port()
        handler = functools.partial(
            http.server.SimpleHTTPRequestHandler,
            directory=self._tmpdir,
        )
        self._server = http.server.HTTPServer(("127.0.0.1", self._port), handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._port}/index.html"

    def serve(self, html: str) -> None:
        (Path(self._tmpdir) / "index.html").write_text(html, encoding="utf-8")

    def stop(self) -> None:
        self._server.shutdown()
        shutil.rmtree(self._tmpdir, ignore_errors=True)


def screenshot_task(task_dir: Path, width: int, height: int, page, server: _LocalServer) -> None:
    body = (task_dir / "page.html").read_text(encoding="utf-8")
    full_html = _SHELL.format(body=body)
    server.serve(full_html)

    page.set_viewport_size({"width": width, "height": height})
    page.goto(server.url, wait_until="domcontentloaded")
    # networkidle gives web components time to fetch and register
    page.wait_for_load_state("networkidle", timeout=15_000)
    page.screenshot(path=str(task_dir / "shot.png"), full_page=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="results")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument(
        "--force", action="store_true", help="Re-screenshot even if shot.png exists"
    )
    args = parser.parse_args()

    out_root = Path(args.out)
    task_dirs = sorted(
        d for d in out_root.iterdir() if d.is_dir() and (d / "page.html").exists()
    )

    if not task_dirs:
        print("No task directories with page.html found.")
        return

    pending = [d for d in task_dirs if args.force or not (d / "shot.png").exists()]
    print(f"Screenshotting {len(pending)}/{len(task_dirs)} task(s)…")

    from playwright.sync_api import sync_playwright

    errors = []
    server = _LocalServer()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page()
            for task_dir in tqdm(pending, desc="Screenshots"):
                try:
                    screenshot_task(task_dir, args.width, args.height, page, server)
                except Exception as exc:
                    tqdm.write(f"[{task_dir.name}] screenshot failed: {exc}")
                    errors.append({"id": task_dir.name, "error": str(exc)})
            browser.close()
    finally:
        server.stop()

    if errors:
        err_path = out_root / "errors_screenshot.json"
        err_path.write_text(json.dumps(errors, indent=2))
        print(f"\n{len(errors)} error(s) written to {err_path}")

    print("Done.")


if __name__ == "__main__":
    main()
