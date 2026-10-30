#!/usr/bin/env bash
# Publish Site Volume to a new GitHub repository.
#
# Before running:
#   1. On github.com click + → New repository.
#      Name: site-volume · Public · leave "Add a README", ".gitignore" and "license" all OFF
#      (this project already has them; an empty repo avoids a merge conflict on the first push).
#   2. Copy the repo address it shows, e.g. https://github.com/yourname/site-volume
#
# Then, in Terminal:
#   cd ~/Chrome-sound-ext
#   bash scripts/publish-to-github.sh
#
# What it does: fills in the REPO_URL placeholders (privacy policy, store listing, package.json),
# commits everything, renames the branch to main and pushes. Safe to run again if a step fails.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

command -v git >/dev/null || { echo "git isn't installed. Run: xcode-select --install"; exit 1; }

# ---------- Repo address ----------
read -r -p "Paste your new GitHub repo address: " URL
URL="${URL%.git}"
URL="${URL%/}"
if [[ ! "$URL" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "That doesn't look like https://github.com/<you>/<repo>. Nothing changed."
  exit 1
fi

# ---------- Who the commits are from ----------
if [[ -z "$(git config user.name || true)" ]]; then
  read -r -p "Your name for commits (shown publicly on GitHub): " NAME
  git config user.name "$NAME"
fi
if [[ -z "$(git config user.email || true)" ]]; then
  echo "Email for commits. To keep your real address private, use the 'noreply' address from"
  echo "github.com → Settings → Emails (looks like 12345+you@users.noreply.github.com)."
  read -r -p "Email: " EMAIL
  git config user.email "$EMAIL"
fi

# ---------- Fill in the repo address ----------
say "Filling in the repo address…"
for f in PRIVACY.md docs/STORE_LISTING.md; do
  [[ -f "$f" ]] && perl -pi -e "s#REPO_URL#${URL}#g" "$f"
done
node -e '
  const fs = require("fs"); const url = process.argv[1];
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  p.homepage = url + "#readme";
  p.repository = { type: "git", url: "git+" + url + ".git" };
  p.bugs = { url: url + "/issues" };
  p.license = "MIT";
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
' "$URL"

# ---------- Commit ----------
say "Files that will be committed:"
git add -A
git status --short
if git diff --cached --quiet; then
  echo "(nothing new to commit)"
else
  git commit -q -m "v0.3.0: welcome page, controls new Audio(), store listing pack, privacy policy, MIT licence

Also: fixes since v0.2 (storage quota freeze, compressor make-up gain, trackpad scrolling,
per-tab level following the tab, keyboard steps, Mac shortcut clash, shadow DOM players,
page volume respected in fallback) and an end-to-end test (npm run test:e2e)."
  echo "Committed."
fi

# ---------- Push ----------
git branch -M main
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "${URL}.git"
else
  git remote add origin "${URL}.git"
fi

say "Pushing to GitHub…"
if ! git push -u origin main; then
  cat <<'EOF'

The push didn't go through. The usual reasons:
 • GitHub asked for a password: it needs a personal access token, not your account password.
   Easiest fix: install GitHub Desktop (desktop.github.com), sign in, then
   File → Add Local Repository → choose Chrome-sound-ext → Push origin.
 • "Updates were rejected": the GitHub repo isn't empty (README/licence was ticked).
   Delete and recreate it empty, then run this script again.
EOF
  exit 1
fi

say "Done. Your repo: $URL"
echo "Privacy policy URL for the stores: $URL/blob/main/PRIVACY.md"
