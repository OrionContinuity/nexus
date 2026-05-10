# ════════════════════════════════════════════════════════════════════════
# Vendor clippyjs into the repo
# ────────────────────────────────────────────────────────────────────
# Downloads the latest clippyjs npm package and commits its `dist/`
# folder to /js/clippyjs-vendor/. This makes Clippy fully self-hosted
# (no CDN dependency at runtime).
#
# clippy.js tries /js/clippyjs-vendor/index.mjs first and falls back
# to the jsDelivr CDN if it doesn't exist, so this is opt-in.
#
# How to run:
#   1. Commit this file to .github/workflows/vendor-clippyjs.yml
#   2. Go to GitHub → Actions tab → "Vendor clippyjs" → Run workflow
#   3. Wait ~30 sec → bot pushes /js/clippyjs-vendor/ files to main
#   4. NEXUS now uses the vendored copy on every load (zero network)
#
# Re-run anytime to pull a newer clippyjs version. The action only
# commits if files actually changed.
# ════════════════════════════════════════════════════════════════════════

name: Vendor clippyjs

on:
  workflow_dispatch:    # Manual trigger from the Actions tab
  schedule:
    - cron: '0 6 1 * *'  # Optional monthly auto-refresh (1st of each month)

permissions:
  contents: write       # Allow committing back to the repo

jobs:
  vendor:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Download clippyjs
        run: |
          set -e
          rm -rf js/clippyjs-vendor
          mkdir -p js/clippyjs-vendor
          # npm pack returns a tgz; extract its dist/ into our vendor dir
          TARBALL=$(npm pack clippyjs --silent)
          tar -xzf "$TARBALL"
          cp -r package/dist/* js/clippyjs-vendor/
          rm -rf package "$TARBALL"
          # Show what we got
          echo "── Vendored files ──"
          find js/clippyjs-vendor -type f | head -50
          echo "── Total size ──"
          du -sh js/clippyjs-vendor

      - name: Commit if changed
        run: |
          git config user.name  "vendor-bot"
          git config user.email "vendor-bot@users.noreply.github.com"
          git add js/clippyjs-vendor/
          if git diff --staged --quiet; then
            echo "No changes — clippyjs vendor is up to date."
          else
            git commit -m "vendor: refresh clippyjs library" -m "Auto-pulled from npm by .github/workflows/vendor-clippyjs.yml"
            git push
            echo "✓ Vendored clippyjs into js/clippyjs-vendor/"
          fi
