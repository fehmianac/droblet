#!/usr/bin/env bash
# Renders the store listing images from the app captures — see ../README.md.
#
#   docs/store-listing/frames/render.sh <raw-captures-dir>
#
# <raw-captures-dir>  full-size simulator PNGs as <dir>/{tr,en}/<screen>.png: the iPhone 17 Pro Max
#                     captures (1320 × 2868) that landing/scripts/capture/capture-screens.sh keeps when
#                     run with CAPTURE_RAW_DIR=<dir>.
#
# Writes (JPEG, no alpha):
#   screenshots/appstore-6.9/{tr,en}/NN-<screen>.jpg   1320 × 2868  (App Store 6.9")
#   screenshots/appstore-6.5/{tr,en}/NN-<screen>.jpg   1284 × 2778  (App Store 6.5")
#   screenshots/play-phone/{tr,en}/NN-<screen>.jpg     1080 × 1920  (Google Play phone)
#   graphics/feature-graphic-{tr,en}.jpg               1024 × 500   (Google Play feature graphic)
#   graphics/app-icon-1024.png                         1024 × 1024  (App Store icon, opaque)
#   graphics/play-icon-512.png                         512 × 512    (Google Play icon, opaque)
# Needs Google Chrome and macOS `sips`. Fonts load from Google Fonts (network).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$(cd "$here/.." && pwd)"
raw="$(cd "${1:?raw captures dir required}" && pwd)"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# order|screen|TR eyebrow|TR caption|EN eyebrow|EN caption
captions=(
  "01|today|BUGÜN|Sabah “ne giysem” derdi bitti.|TODAY|No more “what do I wear?” mornings."
  "02|suggestion|STİLİST|Kendi dolabından kombin önerileri.|STYLIST|Outfit ideas from the clothes you own."
  "03|wardrobe|GARDIROP|Tüm dolabın cebinde.|WARDROBE|Your whole wardrobe in your pocket."
  "04|trip|BAVUL|Hava durumuna göre hazır bavul.|SUITCASE|Packing that checks the forecast."
  "05|looks|LOOKLAR|Sevdiğin kombinler bir arada.|LOOKS|All the outfits you love, in one place."
  "06|palette|RENK PALETİ|Sana yakışan renkleri keşfet.|COLOUR PALETTE|Find the colours that suit you."
  "07|product|MAĞAZA|Almadan önce dolabınla eşleştir.|SHOP|Match it with your wardrobe before you buy."
  "08|friends|ARKADAŞLAR|Arkadaşlarının kombinlerine puan ver.|FRIENDS|Rate your friends’ outfits."
)
sizes=("appstore-6.9|1320|2868" "appstore-6.5|1284|2778" "play-phone|1080|1920")

urlencode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }

shoot() { # <width> <height> <url> <out.png>
  "$chrome" --headless=new --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=6000 \
    --window-size="$1,$2" --screenshot="$4" "$3" >/dev/null 2>&1
  local got
  got="$(sips -g pixelWidth -g pixelHeight "$4" | awk '/pixel/ {print $2}' | paste -sd x -)"
  [[ "$got" == "$1x$2" ]] || { echo "unexpected size $got for $4 (want $1x$2)" >&2; exit 1; }
}

to_jpeg() { sips -s format jpeg -s formatOptions 90 "$1" --out "$2" >/dev/null; }

for lang in tr en; do
  for row in "${captions[@]}"; do
    IFS='|' read -r order screen tr_eb tr_title en_eb en_title <<<"$row"
    shot="$raw/$lang/$screen.png"
    [[ -f "$shot" ]] || { echo "missing capture $shot" >&2; exit 1; }
    if [[ "$lang" == tr ]]; then eb="$tr_eb"; title="$tr_title"; else eb="$en_eb"; title="$en_title"; fi
    for size in "${sizes[@]}"; do
      IFS='|' read -r name w h <<<"$size"
      mkdir -p "$out/screenshots/$name/$lang"
      url="file://$here/screenshot.html?w=$w&h=$h&lang=$lang&shot=$(urlencode "file://$shot")&eyebrow=$(urlencode "$eb")&title=$(urlencode "$title")"
      shoot "$w" "$h" "$url" "$tmp/frame.png"
      to_jpeg "$tmp/frame.png" "$out/screenshots/$name/$lang/$order-$screen.jpg"
    done
  done
  mkdir -p "$out/graphics"
  url="file://$here/feature-graphic.html?lang=$lang&front=$(urlencode "file://$raw/$lang/today.png")&back=$(urlencode "file://$raw/$lang/suggestion.png")"
  shoot 1024 500 "$url" "$tmp/feature.png"
  to_jpeg "$tmp/feature.png" "$out/graphics/feature-graphic-$lang.jpg"
done

# Icons from the app's own 1024 icon (direction B, full-bleed ink: no transparency). A JPEG round trip
# drops the alpha channel Chrome writes, which App Store Connect rejects for the marketing icon.
icon="$out/../../mobile/assets/brand/icon.svg"
shoot 1024 1024 "file://$(cd "$(dirname "$icon")" && pwd)/icon.svg" "$tmp/icon.png"
sips -s format jpeg -s formatOptions 100 "$tmp/icon.png" --out "$tmp/icon.jpg" >/dev/null
sips -s format png "$tmp/icon.jpg" --out "$out/graphics/app-icon-1024.png" >/dev/null
sips -z 512 512 "$out/graphics/app-icon-1024.png" --out "$out/graphics/play-icon-512.png" >/dev/null
echo "Done: $(find "$out/screenshots" "$out/graphics" -type f | wc -l | tr -d ' ') files. Look at every image."
