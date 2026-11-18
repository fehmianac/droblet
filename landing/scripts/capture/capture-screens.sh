#!/usr/bin/env bash
# Regenerates landing/public/screens/{tr,en}/*.webp from the app. See README.md in this folder.
#
#   landing/scripts/capture/capture-screens.sh <path-to-mobile> [simulator-udid] [--build]
#
# <path-to-mobile>  the app's `mobile/` folder (a checkout of the branch whose UI you want to show)
# simulator-udid    defaults to $CAPTURE_UDID; use a simulator nobody else is driving
# --build           also builds and installs the Release showcase build first (slow: native compile)
#
# Needs: Xcode + simulator, Maestro (`maestro`), `cwebp` (brew install webp), Node 20+.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
landing="$(cd "$here/../.." && pwd)"
mobile="$(cd "${1:?path to mobile/ required}" && pwd)"
udid="${2:-${CAPTURE_UDID:?simulator udid required (argument 2 or CAPTURE_UDID)}}"
build="${3:-}"
port="${CAPTURE_PORT:-4010}"
max_height=1290
quality=90
work="$(mktemp -d)"

cleanup() {
  [[ -n "${mock_pid:-}" ]] && kill "$mock_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

xcrun simctl boot "$udid" 2>/dev/null || true
xcrun simctl bootstatus "$udid" -b >/dev/null

if [[ "$build" == "--build" ]]; then
  # Fixture data for every feature; sign-in goes to the local mock (mock-auth.mjs), never to a real API.
  (cd "$mobile" && npm ci && EXPO_PUBLIC_DROBLET_FIXTURES=1 DROBLET_API_BASE_URL="http://127.0.0.1:$port" \
    npx expo run:ios --configuration Release --device "$udid" --no-bundler)
fi

# Clean status bar: 9:41, full battery, full signal.
xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiBars 3 --dataNetwork wifi

PORT="$port" node "$here/mock-auth.mjs" >"$work/mock.log" 2>&1 &
mock_pid=$!
sleep 1

for pair in "tr:tr_TR" "en:en_GB"; do
  lang="${pair%%:*}"
  locale="${pair##*:}"
  raw="$work/$lang"
  mkdir -p "$raw" "$landing/public/screens/$lang"
  maestro --device "$udid" test --test-output-dir="$raw" -e LANG="$lang" -e LOCALE="$locale" "$here/screens.yaml"
  # Maestro writes into <dir>/<timestamp>/screens/takeScreenshot/.
  for png in "$raw"/*/screens/takeScreenshot/*.png; do
    name="$(basename "$png" .png)"
    sips --resampleHeight "$max_height" "$png" --out "$work/resized.png" >/dev/null
    cwebp -quiet -q "$quality" -m 6 -metadata none "$work/resized.png" -o "$landing/public/screens/$lang/$name.webp"
  done
  du -ch "$landing/public/screens/$lang"/*.webp | tail -1 | sed "s|total|public/screens/$lang|"
done

xcrun simctl status_bar "$udid" clear
echo "Done. Look at every image before committing: no empty boxes, error or offline states, or debug UI."
