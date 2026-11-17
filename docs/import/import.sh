#!/usr/bin/env bash
# Builds qubiq-psp/sdk from node-sdk and react-sdk, with full history and tags.
# Plan: psp docs/sdk-repository-plan.md, step 1. Derived from psp docs/tools/monorepo-import.sh.
#
#   docs/import/import.sh <out-dir>
#
# - Clones each repository from $ORG_URL (default https://github.com/qubiq-psp) with its tags, keeps the branches
#   dev and main, and rewrites the history into its folder with `git filter-repo --to-subdirectory-filter`;
#   the tags v<version> become <prefix>-v<version> (two packages cannot share one tag namespace).
# - Creates <out-dir> (must not exist): a root commit, then one merge per repository into dev and into main
#   (--allow-unrelated-histories). The folders never overlap, so the merges cannot conflict.
# - Checks every repository and branch: the folder tree equals the source tree, the commit count equals the
#   source count, every tag is carried over. Any mismatch stops the script.
# - Saves the old → new commit id map of each repository in docs/import/commit-maps/ and this script in
#   docs/import/, committed on both branches.
#
# Re-runnable from scratch until the repository has its own commits. Needs git-filter-repo.
# Reads GitHub, writes only <out-dir> and $WORK.
set -euo pipefail

OUT=${1:?usage: docs/import/import.sh <out-dir>}
ORG_URL=${ORG_URL:-https://github.com/qubiq-psp}
WORK=${WORK:-$(mktemp -d -t sdk-import)}
TRAILER='Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")

# repository  folder           tag prefix
REPOS=(
  'node-sdk   packages/node   node-'
  'react-sdk  packages/react  react-'
)
BRANCHES=(dev main)

[ -e "$OUT" ] && { echo "✗ $OUT already exists"; exit 1; }
git filter-repo --version >/dev/null 2>&1 || { echo '✗ git-filter-repo is not installed'; exit 1; }
mkdir -p "$WORK"
echo "work folder: $WORK"

# 1. Clone, record the source, rewrite into the folder.
for row in "${REPOS[@]}"; do
  read -r name path prefix <<<"$row"
  src="$WORK/$name"
  rm -rf "$src" "$WORK/$name.expected" "$WORK/$name.tags" "$WORK/$name.others"
  git clone -q "$ORG_URL/$name.git" "$src"
  for b in "${BRANCHES[@]}"; do
    git -C "$src" update-ref "refs/heads/$b" "refs/remotes/origin/$b"
    printf '%s %s %s\n' "$b" "$(git -C "$src" rev-parse "$b^{tree}")" "$(git -C "$src" rev-list --count "$b")" \
      >>"$WORK/$name.expected"
  done
  # Branches that are not imported: listed for the check before archiving (plan, decision 12).
  git -C "$src" for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin |
    grep -v -x -e HEAD -e dev -e main >"$WORK/$name.others" || true
  git -C "$src" tag -l | sort >"$WORK/$name.tags"
  git -C "$src" remote remove origin
  git -C "$src" for-each-ref --format='%(refname:short)' refs/heads | while read -r b; do
    [ "$b" = dev ] || [ "$b" = main ] || git -C "$src" branch -q -D "$b"
  done
  (cd "$src" && git filter-repo --force --quiet --to-subdirectory-filter "$path" --tag-rename "v:${prefix}v")
  echo "rewritten: $name → $path (tags v* → ${prefix}v*)"
done

# 2. The repository: a root commit, then the merges.
git init -q -b dev "$OUT"
cat >"$OUT/README.md" <<'EOF'
# PSP SDK

The public SDK of the PSP payment system and the merchant examples.

| Folder | What it is |
|---|---|
| [`packages/node`](packages/node) | [`@qubiq-psp/sdk`](https://www.npmjs.com/package/@qubiq-psp/sdk) — Node.js SDK for the merchant's backend |
| [`packages/react`](packages/react) | [`@qubiq-psp/react`](https://www.npmjs.com/package/@qubiq-psp/react) — the payment widget for the merchant's frontend |

The history of the former repositories `qubiq-psp/node-sdk` and `qubiq-psp/react-sdk` is kept under their folders;
their release tags are `node-v<version>` and `react-v<version>`. The map of old to new commit ids is in
`docs/import/commit-maps/`.
EOF
cat >"$OUT/.gitignore" <<'EOF'
.DS_Store
node_modules/
dist/
.env
.env.*
!.env.example
!.env.*.example
EOF
git -C "$OUT" add README.md .gitignore
git -C "$OUT" commit -q -m "chore: repository root" -m "$TRAILER"
git -C "$OUT" branch main

for row in "${REPOS[@]}"; do
  read -r name _ <<<"$row"
  git -C "$OUT" fetch -q "$WORK/$name" \
    "refs/heads/dev:refs/import/$name/dev" "refs/heads/main:refs/import/$name/main" 'refs/tags/*:refs/tags/*'
done

for branch in "${BRANCHES[@]}"; do
  git -C "$OUT" checkout -q "$branch"
  for row in "${REPOS[@]}"; do
    read -r name path _ <<<"$row"
    git -C "$OUT" merge -q --no-ff --allow-unrelated-histories "refs/import/$name/$branch" \
      -m "chore: import $name ($branch) into $path with history" -m "$TRAILER"
  done
done

# 3. Checks: folder tree and commit count per repository and branch; every tag carried over and reachable.
fail=0
for row in "${REPOS[@]}"; do
  read -r name path prefix <<<"$row"
  for branch in "${BRANCHES[@]}"; do
    read -r _ tree count < <(grep "^$branch " "$WORK/$name.expected")
    got_tree=$(git -C "$OUT" rev-parse "$branch:$path")
    got_count=$(git -C "$OUT" rev-list --count "refs/import/$name/$branch")
    if [ "$got_tree" = "$tree" ] && [ "$got_count" = "$count" ]; then
      printf '✓ %-10s %-4s → %-15s tree ok, %s commits\n' "$name" "$branch" "$path" "$count"
    else
      printf '✗ %-10s %-4s → %-15s tree %s/%s, commits %s/%s\n' "$name" "$branch" "$path" \
        "$got_tree" "$tree" "$got_count" "$count"
      fail=1
    fi
  done
  while read -r tag; do
    [ -n "$tag" ] || continue
    new="${prefix}${tag}"
    if git -C "$OUT" rev-parse -q --verify "refs/tags/$new" >/dev/null &&
      git -C "$OUT" merge-base --is-ancestor "$new^{commit}" main; then
      printf '✓ %-10s tag %s → %s (on main)\n' "$name" "$tag" "$new"
    else
      printf '✗ %-10s tag %s → %s missing or not on main\n' "$name" "$tag" "$new"
      fail=1
    fi
  done <"$WORK/$name.tags"
  if [ -s "$WORK/$name.others" ]; then
    printf '! %-10s branches not imported (check before archiving): %s\n' "$name" "$(tr '\n' ' ' <"$WORK/$name.others")"
  fi
done
[ "$fail" = 0 ] || { echo '✗ the import does not match its sources'; exit 1; }

# 4. Commit maps and this script, committed on both branches. refs/import/* are internal and removed.
for branch in "${BRANCHES[@]}"; do
  git -C "$OUT" checkout -q "$branch"
  mkdir -p "$OUT/docs/import/commit-maps"
  cp "$SELF" "$OUT/docs/import/import.sh"
  chmod +x "$OUT/docs/import/import.sh"
  for row in "${REPOS[@]}"; do
    read -r name _ <<<"$row"
    cp "$WORK/$name/.git/filter-repo/commit-map" "$OUT/docs/import/commit-maps/$name.txt"
  done
  git -C "$OUT" add docs/import
  git -C "$OUT" commit -q -m "chore: the import script and old to new commit ids" -m "$TRAILER"
done
git -C "$OUT" checkout -q dev
git -C "$OUT" for-each-ref --format='%(refname)' refs/import | xargs -n1 git -C "$OUT" update-ref -d

echo "✓ ready: $OUT (dev $(git -C "$OUT" rev-parse --short dev), main $(git -C "$OUT" rev-parse --short main), $(git -C "$OUT" tag | wc -l | tr -d ' ') tags)"
