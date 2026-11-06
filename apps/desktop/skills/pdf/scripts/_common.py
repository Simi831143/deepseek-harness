"""Helpers shared by this skill's scripts: vendored imports, pdfcpu, page specs, passwords, and output paths."""

import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
VENDOR = SKILL_DIR / "vendor"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

# Chinese fonts for stamps, installed into pdfcpu's font cache from the Windows font files on first use.
SYSTEM_FONTS = {"DengXian": "Deng.ttf", "SimHei": "simhei.ttf"}
FONT_NAME = re.compile(r"fontname:\s*([\w-]+)")
# A Desktop sandbox points TEMP at the session's private writable folder; a read-only session cannot write it.
TEMP = os.environ.get("TEMP") or os.environ.get("TMP")


def pdfcpu_binary() -> Path:
    if sys.platform == "win32" and platform.machine().lower() in ("amd64", "x86_64"):
        return SKILL_DIR / "bin" / "win-x64" / "pdfcpu.exe"
    sys.exit(f"pdfcpu is bundled only for Windows x64; this machine is {sys.platform} {platform.machine()}.")


def pdfcpu_config(binary: Path) -> Path | None:
    """Return a pdfcpu config dir holding this skill's settings, or None when the temp folder cannot be written.

    pdfcpu writes into its config dir until it holds a certificate folder and the default font, and
    installing a font writes there too, so the dir lives in the temp folder rather than in this skill,
    which may be installed read-only. The name changes with the settings and the binary. TEMP is read
    directly because tempfile.gettempdir() falls back to other folders, the working directory last.
    """
    if not TEMP:
        return None
    template = SKILL_DIR / "pdfcpu-config.yml"
    key = hashlib.sha256(template.read_bytes() + str(binary.stat().st_size).encode()).hexdigest()[:12]
    root = Path(TEMP) / f"pdf-skill-pdfcpu-{key}"
    conf = root / "pdfcpu"
    if (conf / "certs").is_dir() and (conf / "fonts" / "Roboto-Regular.gob").is_file():
        return root
    try:
        conf.mkdir(parents=True, exist_ok=True)
        staged = conf / f"config.yml.{os.getpid()}.tmp"
        shutil.copyfile(template, staged)
        os.replace(staged, conf / "config.yml")
    except OSError:  # a read-only session cannot write the temp folder; pdfcpu then runs on its defaults
        return None
    proc = subprocess.run([str(binary), "-c", str(root), "--offline", "fonts", "list"], capture_output=True)
    return root if proc.returncode == 0 else None


def install_font(binary: Path, root: Path | None, font: str) -> None:
    """Install one Chinese font from its Windows font file into the config dir unless it is already there."""
    if root is None:
        sys.exit(f"Chinese fonts need a writable temp folder ({TEMP or 'TEMP is not set'}), and this session cannot write "
                 "there. Ask the user for write permission, or use fontname:Helvetica for Latin-only text.")
    if (root / "pdfcpu" / "fonts" / f"{font}.gob").is_file():
        return
    file = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / SYSTEM_FONTS[font]
    if not file.is_file():
        sys.exit(f"{file} is missing, so {font} cannot be used; Windows installs it with the Chinese supplemental fonts.")
    proc = subprocess.run([str(binary), "-c", str(root), "--offline", "fonts", "install", str(file)],
                          capture_output=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        sys.exit(f"pdfcpu could not install {font} from {file}: {proc.stderr.strip()}")


def pdfcpu_command(*args: str) -> list[str]:
    """Return the bundled pdfcpu command line with this skill's settings, the Chinese fonts it names, and network access off."""
    binary = pdfcpu_binary()
    root = pdfcpu_config(binary)
    for font in {name for arg in args for name in FONT_NAME.findall(arg)} & SYSTEM_FONTS.keys():
        install_font(binary, root, font)
    return [str(binary), "-c", "disable" if root is None else str(root), "--offline", *args]


def repack(src: Path, out: Path) -> str | None:
    """Rewrite src into out with pdfcpu, which packs objects into compressed object streams.

    pypdf writes every object separately, so a tagged PDF with thousands of structure elements
    grows by a third and its header drops to 1.3; this restores the compact form.
    Returns None on success, or pdfcpu's error message.
    """
    proc = subprocess.run(pdfcpu_command("optimize", str(src), str(out)), capture_output=True, encoding="utf-8", errors="replace")
    return None if proc.returncode == 0 and out.is_file() else (proc.stderr.strip() or f"pdfcpu exited with {proc.returncode}")


def utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")


def parse_pages(spec: str, total: int) -> list[int]:
    """Turn a 1-based spec such as "1-5,8" into sorted page numbers; raise ValueError when invalid."""
    pages: set[int] = set()
    for part in spec.replace(" ", "").split(","):
        match = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
        if not match:
            raise ValueError(f'invalid page spec "{spec}"; use a form such as "1-5,8"')
        first = int(match.group(1))
        last = int(match.group(2) or first)
        if first < 1 or last < first or last > total:
            raise ValueError(f'page spec "{spec}" is outside 1-{total}')
        pages.update(range(first, last + 1))
    return sorted(pages)


def compact_ranges(numbers: list[int], sep: str = ",") -> str:
    """Render sorted page numbers as "1-5,8"."""
    parts = []
    i = 0
    while i < len(numbers):
        j = i
        while j + 1 < len(numbers) and numbers[j + 1] == numbers[j] + 1:
            j += 1
        parts.append(str(numbers[i]) if i == j else f"{numbers[i]}-{numbers[j]}")
        i = j + 1
    return sep.join(parts)


def ranges(numbers: list[int]) -> str:
    return compact_ranges(numbers, ", ") if numbers else "none"


def read_password(path: Path | None) -> str | None:
    """Return the first line of a password file, or None when no file is given."""
    if path is None:
        return None
    lines = path.read_text(encoding="utf-8").splitlines()
    return lines[0] if lines else ""


def new_output(path: Path, overwrite: bool, source: Path | None = None) -> Path:
    """Resolve an output path, refuse to replace the source or an existing file unless told to, and check it is writable."""
    out = path.resolve()
    if source is not None and out == source.resolve():
        sys.exit("The output must be a new file; it cannot replace the input PDF.")
    if out.exists() and not overwrite:
        sys.exit(f"{out} already exists. Choose another name, or pass --overwrite if the user asked to replace it.")
    probe = out.with_name(out.name + ".probe")
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        probe.write_bytes(b"")
        probe.unlink()
    except OSError as error:
        sys.exit(f"Cannot write to {out.parent} ({error.strerror or error}). This session may only be allowed to write "
                 f"in its working directory ({Path.cwd()}). Write the output there instead, or ask the user first.")
    return out
