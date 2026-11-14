"""Check line endings in modified Git blobs without checkout conversion."""
import argparse
import subprocess
import sys


def git(*args):
    return subprocess.check_output(["git", *args])


def style(data):
    if b"\0" in data:
        return "binary"
    crlf = data.count(b"\r\n")
    lf = data.count(b"\n") - crlf
    if crlf and lf:
        return "mixed"
    return "CRLF" if crlf else "LF" if lf else "none"


def violations(base, head):
    entries = git("diff", "--name-status", "-z", "--no-renames", "--diff-filter=M", base, head).split(b"\0")
    failures = []
    for status, path in zip(entries[::2], entries[1::2]):
        if status != b"M":
            continue
        name = path.decode("utf-8", errors="surrogateescape")
        before = style(git("show", f"{base}:{name}"))
        after = style(git("show", f"{head}:{name}"))
        if "binary" in (before, after):
            continue
        if (after == "mixed" and before != "mixed") or (before in ("LF", "CRLF") and after in ("LF", "CRLF") and before != after):
            failures.append((name, before, after))
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", help="base commit")
    parser.add_argument("head", nargs="?", default="HEAD", help="head commit (default HEAD)")
    args = parser.parse_args()
    failures = violations(args.base, args.head)
    for name, before, after in failures:
        print(f"{name}: {before} -> {after}")
    if failures:
        return 1
    print("Line endings unchanged in modified text files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
