#!/usr/bin/env python3
"""Generate a PBKDF2 hash for a pattern-lock sequence.

Usage:
    python3 tools/hash_pattern.py 0-3-6-7-8

The 3x3 grid is indexed:
    0 1 2
    3 4 5
    6 7 8

Paste the printed `salt` and `hash` into assets/app.js (the AUTH object).
The matching parameters (iterations, key length) must stay in sync with app.js.
"""

import hashlib
import os
import sys

ITERATIONS = 150_000
KEY_LEN = 32  # bytes


def derive(pattern: str, salt: bytes) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", pattern.encode(), salt, ITERATIONS, KEY_LEN)
    return dk.hex()


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    pattern = sys.argv[1].strip()
    salt = os.urandom(16)
    print(f"pattern    : {pattern}")
    print(f"iterations : {ITERATIONS}")
    print(f"salt (hex) : {salt.hex()}")
    print(f"hash (hex) : {derive(pattern, salt)}")
    print()
    print("// paste into assets/app.js:")
    print(f'const AUTH = {{ salt: "{salt.hex()}", iterations: {ITERATIONS}, '
          f'hash: "{derive(pattern, salt)}" }};')


if __name__ == "__main__":
    main()
