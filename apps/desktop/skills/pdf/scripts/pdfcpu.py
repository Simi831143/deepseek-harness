"""Run the bundled pdfcpu with this skill's font configuration and with network access disabled.

Usage: pdfcpu.py <command> [flags] <files...>     e.g. pdfcpu.py merge out.pdf a.pdf b.pdf
Exits with pdfcpu's exit code.

If pdfcpu rejects a Chinese font because the PDF already embeds a subset of it ("corrupt fontDict"),
the command is retried once with the other bundled Chinese font.
"""

import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # the skill folder may be read-only application resources
sys.path.insert(0, str(Path(__file__).resolve().parent))  # python -I leaves the script folder off sys.path
from _common import pdfcpu_command, utf8_stdio

CJK_FONTS = ("DengXian", "SimHei")


def run(args: list[str]) -> tuple[int, str]:
    """Run pdfcpu with stdout passed through; return the exit code and stderr, which is also echoed."""
    proc = subprocess.run(pdfcpu_command(*args), stderr=subprocess.PIPE, encoding="utf-8", errors="replace")
    sys.stderr.write(proc.stderr)
    return proc.returncode, proc.stderr


def swap_font(args: list[str]) -> tuple[list[str], str] | None:
    """Return args with fontname:<one CJK font> replaced by the other, and the new font, or None."""
    for i, arg in enumerate(args):
        for font in CJK_FONTS:
            if f"fontname:{font}" in arg:
                other = next(f for f in CJK_FONTS if f != font)
                return args[:i] + [arg.replace(f"fontname:{font}", f"fontname:{other}")] + args[i + 1:], other
    return None


def main() -> int:
    utf8_stdio()
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    code, err = run(args)
    if code != 0 and "corrupt fontDict" in err:
        swapped = swap_font(args)
        if swapped:
            print(f"pdfcpu.py: the PDF already embeds a subset of that font; retrying with fontname:{swapped[1]}.", file=sys.stderr)
            code, _ = run(swapped[0])
    return code


if __name__ == "__main__":
    sys.exit(main())
