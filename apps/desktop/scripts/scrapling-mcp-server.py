"""Run the bundled Scrapling MCP with libraries and Chromium beside this file."""

import os
from pathlib import Path
import site


ROOT = Path(__file__).resolve().parent
site.addsitedir(str(ROOT / "packages"))
BROWSER = ROOT / "browser" / "chrome-win64" / "chrome.exe"
if not BROWSER.is_file():
    raise FileNotFoundError(f"Bundled Scrapling Chromium is missing: {BROWSER}")

# Both browser drivers use the packaged executable, including on a machine with a browser cache.
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(ROOT / "browser")
os.environ["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"] = "1"

from scrapling.core.ai import ScraplingMCPServer  # noqa: E402


if __name__ == "__main__":
    ScraplingMCPServer(executable_path=str(BROWSER)).serve(http=False, host="127.0.0.1", port=0)
