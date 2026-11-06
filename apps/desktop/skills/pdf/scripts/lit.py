"""Run the bundled LiteParse command line (`lit`) with OCR always disabled.

Usage: lit.py screenshot <file.pdf> --target-pages 4 --dpi 150 -o <folder>
       lit.py parse <file.pdf> --format json --target-pages 1 -o <file.json>

The folder given to -o (for parse, the folder that will hold the file) is created if it is missing.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # the skill folder may be read-only application resources
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "vendor"))

from liteparse._liteparse import run_cli  # noqa: E402

args = sys.argv[1:]
if args and args[0] in ("parse", "batch-parse") and "--no-ocr" not in args:
    args.insert(1, "--no-ocr")
for flag in ("-o", "--output"):
    if flag in args[:-1]:
        target = Path(args[args.index(flag) + 1])
        (target.parent if args[0] == "parse" else target).mkdir(parents=True, exist_ok=True)
run_cli(["lit", *args])
