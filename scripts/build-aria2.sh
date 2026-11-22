#!/usr/bin/env bash
# Build aria2 1.37.0 from source for macOS or Linux.
#
#   bash scripts/build-aria2.sh mac
#   bash scripts/build-aria2.sh linux
#
# Why: aria2 publishes NO prebuilt macOS/Linux binary (Windows zips +
# source tarballs only), so the CI runners build it and the workflow
# bundles it into resources/bin/<platform>/. The app runs WITHOUT aria2
# on those platforms (plain files fall back to yt-dlp), so this script
# is best-effort: a build failure must never fail the whole release.
# Exit codes: 0 = binary ready, 1 = build error, 3 = the macOS dylib
# bundling gate failed (the binary is DELETED so the fallback engages).
#
# Verification: the built binary must print `aria2 version 1.37.0`.
# macOS additionally: every Homebrew dylib it links is copied into
# resources/bin/mac/lib/ and re-pointed at @loader_path/lib, then the
# binary must run with a sanitized environment (env -i) — a missed
# dylib shows up as a dyld error there. Linux additionally: `ldd` must
# show no missing libraries, and the binary must download the Node
# 24.22.1 zip to the exact known size (37,618,919 bytes).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM="${1:-}"
if [ "$PLATFORM" != "mac" ] && [ "$PLATFORM" != "linux" ]; then
  echo "Usage: bash scripts/build-aria2.sh <mac|linux>" >&2
  exit 1
fi

ARIA2_VERSION="1.37.0"
BIN_DIR="$ROOT/resources/bin/$PLATFORM"
BIN="$BIN_DIR/aria2c"
SRC_DIR="$ROOT/.aria2-build"

mkdir -p "$BIN_DIR"

# Already built and correct? Skip.
if [ -x "$BIN" ]; then
  if "$BIN" --version 2>/dev/null | head -n 1 | grep -q "aria2 version $ARIA2_VERSION"; then
    echo "aria2 $ARIA2_VERSION already present at $BIN — skipping."
    exit 0
  fi
fi

rm -rf "$SRC_DIR"
mkdir -p "$SRC_DIR"
cd "$SRC_DIR"
echo "Downloading aria2 $ARIA2_VERSION source..."
curl -fsSL -o "aria2-$ARIA2_VERSION.tar.bz2" \
  "https://github.com/aria2/aria2/releases/download/release-$ARIA2_VERSION/aria2-$ARIA2_VERSION.tar.bz2"
tar -xjf "aria2-$ARIA2_VERSION.tar.bz2"
cd "aria2-$ARIA2_VERSION"

JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

if [ "$PLATFORM" = "mac" ]; then
  echo "Installing build dependencies (Homebrew)..."
  brew install autoconf automake libtool pkg-config gettext openssl@3 libxml2 sqlite3 libssh2 expat c-ares zlib
  export PKG_CONFIG_PATH="$(brew --prefix openssl@3)/lib/pkgconfig:$(brew --prefix libxml2)/lib/pkgconfig:$(brew --prefix sqlite3)/lib/pkgconfig:$(brew --prefix libssh2)/lib/pkgconfig:$(brew --prefix expat)/lib/pkgconfig:$(brew --prefix c-ares)/lib/pkgconfig"
  export CPPFLAGS="-I$(brew --prefix openssl@3)/include -I$(brew --prefix libxml2)/include -I$(brew --prefix sqlite3)/include"
  export LDFLAGS="-L$(brew --prefix openssl@3)/lib -L$(brew --prefix libxml2)/lib -L$(brew --prefix sqlite3)/lib"
  autoreconf -i
  ./configure --disable-nls --with-openssl --without-gnutls \
    --with-libxml2 --with-sqlite3 --with-libssh2 --with-libexpat \
    --with-libcares --with-zlib
  make -j"$JOBS"
  cp -f src/aria2c "$BIN"
  chmod 755 "$BIN"
else
  echo "Installing build dependencies (apt)..."
  sudo apt-get update -qq
  # gettext provides autopoint, which autoreconf -i needs — the ubuntu
  # runner has no autopoint (CI run 44984348473 failed on exactly that).
  sudo apt-get install -y -qq autoconf automake libtool pkg-config gettext \
    libxml2-dev libsqlite3-dev libssl-dev zlib1g-dev libssh2-1-dev \
    libexpat1-dev libc-ares-dev
  autoreconf -i
  ./configure --disable-nls --with-openssl --without-gnutls \
    --with-libxml2 --with-sqlite3 --with-libssh2 --with-libexpat \
    --with-libcares --with-zlib
  make -j"$JOBS"
  cp -f src/aria2c "$BIN"
  chmod 755 "$BIN"
fi

# Version gate (both platforms).
if ! "$BIN" --version 2>/dev/null | head -n 1 | grep -q "aria2 version $ARIA2_VERSION"; then
  echo "ERROR: built aria2c does not report version $ARIA2_VERSION" >&2
  rm -f "$BIN"
  exit 1
fi

if [ "$PLATFORM" = "mac" ]; then
  # --- dylib bundling -------------------------------------------------
  # A Homebrew-built aria2c links Homebrew dylibs by absolute path
  # (/opt/homebrew/opt/...). A user without Homebrew has none of them,
  # so every non-system dylib is copied into resources/bin/mac/lib/ and
  # re-pointed at @loader_path/lib (with the lib's own id rewritten too,
  # so bundled libs find each other). Then the binary is ad-hoc signed
  # (arm64 macOS refuses to run an unsigned Mach-O binary at all).
  LIB_DIR="$BIN_DIR/lib"
  mkdir -p "$LIB_DIR"
  for lib in $(otool -L "$BIN" | tail -n +2 | awk '{print $1}' | grep -E '^/(opt/homebrew|usr/local)/' || true); do
    base="$(basename "$lib")"
    cp -f "$lib" "$LIB_DIR/$base"
    chmod 755 "$LIB_DIR/$base"
    install_name_tool -id "@loader_path/lib/$base" "$LIB_DIR/$base"
    install_name_tool -change "$lib" "@loader_path/lib/$base" "$BIN"
  done
  # Transitive deps: bundled libs may reference other Homebrew libs
  # (e.g. libssl references libcrypto). References inside a bundled
  # dylib resolve from inside lib/, so they must be @loader_path/<name>
  # — @loader_path/lib/<name> would resolve to lib/lib/<name> and dyld
  # fails to load (CI run 44984348473 failed the env -i gate on exactly
  # that). References in the main binary stay @loader_path/lib/<name>.
  for _ in 1 2 3; do
    remaining="$(otool -L "$BIN" "$LIB_DIR"/*.dylib 2>/dev/null | awk '{print $1}' | grep -E '^/(opt/homebrew|usr/local)/' | sort -u || true)"
    [ -z "$remaining" ] && break
    for lib in $remaining; do
      base="$(basename "$lib")"
      if [ ! -f "$LIB_DIR/$base" ]; then
        cp -f "$lib" "$LIB_DIR/$base"
        chmod 755 "$LIB_DIR/$base"
        install_name_tool -id "@loader_path/lib/$base" "$LIB_DIR/$base"
      fi
      install_name_tool -change "$lib" "@loader_path/lib/$base" "$BIN" 2>/dev/null || true
      for f in "$LIB_DIR"/*.dylib; do
        install_name_tool -change "$lib" "@loader_path/$base" "$f" 2>/dev/null || true
      done
    done
  done
  # Re-sign every bundled dylib: install_name_tool invalidated their
  # Homebrew signatures, and arm64 dyld refuses to load a dylib whose
  # signature is invalid. The main binary is signed right after.
  for f in "$LIB_DIR"/*.dylib; do
    [ -e "$f" ] || continue
    codesign --force --sign - --timestamp=none "$f"
  done
  codesign --force --sign - --timestamp=none "$BIN"
  # Gate: no Homebrew path may remain, and the binary must run with a
  # sanitized environment (no Homebrew paths, no DYLD_LIBRARY_PATH).
  if otool -L "$BIN" "$LIB_DIR"/*.dylib 2>/dev/null | grep -qE '/opt/homebrew/|/usr/local/'; then
    echo "ERROR: dylib bundling incomplete — Homebrew paths remain" >&2
    rm -f "$BIN"
    rm -rf "$LIB_DIR"
    exit 3
  fi
  # A dylib inside lib/ must never reference @loader_path/lib/ as a
  # dependency (from inside lib/ that resolves to lib/lib/ — see the
  # transitive loop). Each dylib's own LC_ID_DYLIB is @loader_path/lib/
  # by design, so skip each file's header + id lines (tail -n +3).
  for f in "$LIB_DIR"/*.dylib; do
    [ -e "$f" ] || continue
    if otool -L "$f" | tail -n +3 | grep -q '@loader_path/lib/'; then
      echo "ERROR: $f references @loader_path/lib/ (must be @loader_path/ from inside lib/):" >&2
      otool -L "$f" >&2
      rm -f "$BIN"
      rm -rf "$LIB_DIR"
      exit 3
    fi
  done
  echo "Linked libraries (otool -L):"
  otool -L "$BIN" "$LIB_DIR"/*.dylib
  # Capture the sanitized run's stderr too: the old gate swallowed it
  # (2>/dev/null), so CI run 44984348473 showed only "does not run"
  # with no dyld error to diagnose from.
  SANITIZED_OUT="$(env -i PATH=/usr/bin:/bin "$BIN" --version 2>&1)" || true
  if ! printf '%s' "$SANITIZED_OUT" | head -n 1 | grep -q "aria2 version $ARIA2_VERSION"; then
    echo "ERROR: aria2c does not run with a sanitized environment (missing bundled dylib?)" >&2
    echo "--- sanitized run output (stdout+stderr) ---" >&2
    printf '%s
' "$SANITIZED_OUT" >&2
    echo "--- end sanitized run output ---" >&2
    rm -f "$BIN"
    rm -rf "$LIB_DIR"
    exit 3
  fi
  echo "macOS aria2 $ARIA2_VERSION built + bundled dylibs verified."
else
  # --- Linux gates ----------------------------------------------------
  if ldd "$BIN" 2>/dev/null | grep -q "not found"; then
    echo "ERROR: ldd reports missing libraries for aria2c:" >&2
    ldd "$BIN" >&2
    rm -f "$BIN"
    exit 1
  fi
  # Real download test: Node 24.22.1 Windows zip, exact known size.
  TMPDL="$(mktemp -d)"
  if ! "$BIN" --disable-ipv6 --dir="$TMPDL" --out=node.zip --quiet \
    "https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip"; then
    echo "ERROR: aria2c real-download test failed" >&2
    rm -rf "$TMPDL"
    rm -f "$BIN"
    exit 1
  fi
  SIZE="$(stat -c%s "$TMPDL/node.zip")"
  rm -rf "$TMPDL"
  if [ "$SIZE" != "37618919" ]; then
    echo "ERROR: aria2c download test size mismatch (got $SIZE, expected 37618919)" >&2
    rm -f "$BIN"
    exit 1
  fi
  echo "Linux aria2 $ARIA2_VERSION built + real-download test passed (37,618,919 bytes)."
fi

rm -rf "$SRC_DIR"
echo "aria2 $ARIA2_VERSION ready at $BIN"
