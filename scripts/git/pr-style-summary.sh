#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() {
  echo "[pr-style-summary] $*" >&2
}

die() {
  echo "[pr-style-summary] error: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Generate a PR-style summary for direct-push workflows.

Usage:
  bash scripts/git/pr-style-summary.sh [--base <ref>] [--head <ref>] [--limit <n>] [--output <file>] [--include-merges]
  bash scripts/git/pr-style-summary.sh --help

Options:
  --base <ref>    Base git ref (default: auto-detect origin/main, main, origin/master, master).
  --head <ref>    Head git ref (default: HEAD).
  --limit <n>     Use latest N commits from <head> instead of a base..head range.
  --output <file> Write markdown output to a file (otherwise prints to stdout).
  --include-merges Include merge commits (default excludes merges).

Examples:
  bash scripts/git/pr-style-summary.sh
  bash scripts/git/pr-style-summary.sh --base 285436a^ --head 7f65c60
  bash scripts/git/pr-style-summary.sh --base 7f88a56 --head HEAD --include-merges
  bash scripts/git/pr-style-summary.sh --limit 4 --output tmp/release-notes.md
EOF
}

default_base_ref() {
  local candidates=("origin/main" "main" "origin/master" "master")
  local ref=""
  for ref in "${candidates[@]}"; do
    if git rev-parse --verify "$ref" >/dev/null 2>&1; then
      echo "$ref"
      return
    fi
  done
}

to_sentence_case() {
  local conventional_subject="$1"
  local type=""
  local detail="$conventional_subject"

  if [[ "$conventional_subject" == *:* ]]; then
    local prefix_part="${conventional_subject%%:*}"
    detail="${conventional_subject#*:}"
    detail="${detail#"${detail%%[![:space:]]*}"}"

    # Conventional commit style: type(scope)!: subject
    type="${prefix_part%%(*}"
    type="${type%!}"
    type="${type,,}"
  fi

  detail="${detail#"${detail%%[![:space:]]*}"}"
  detail="${detail%"${detail##*[![:space:]]}"}"

  local prefix="Updated"
  case "$type" in
    feat)
      prefix="Added"
      ;;
    fix)
      prefix="Fixed"
      ;;
    docs)
      prefix="Documented"
      ;;
    refactor)
      prefix="Refactored"
      ;;
    perf)
      prefix="Improved performance for"
      ;;
    test)
      prefix="Expanded tests for"
      ;;
    build|ci|chore|style)
      prefix="Updated"
      ;;
  esac

  local line="${prefix} ${detail}"
  if [[ ! "$line" =~ [.!?]$ ]]; then
    line="${line}."
  fi
  echo "$line"
}

main() {
  command -v git >/dev/null 2>&1 || die "git is required."

  cd "$ROOT_DIR"
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "run this from inside a git repository."

  local base=""
  local head="HEAD"
  local limit=""
  local output_file=""
  local include_merges="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --base)
        [[ $# -ge 2 ]] || die "--base requires a value."
        base="$2"
        shift 2
        ;;
      --head)
        [[ $# -ge 2 ]] || die "--head requires a value."
        head="$2"
        shift 2
        ;;
      --limit)
        [[ $# -ge 2 ]] || die "--limit requires a value."
        limit="$2"
        shift 2
        ;;
      --output)
        [[ $# -ge 2 ]] || die "--output requires a value."
        output_file="$2"
        shift 2
        ;;
      --include-merges)
        include_merges="true"
        shift
        ;;
      --)
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done

  if [[ -n "$limit" && -n "$base" ]]; then
    die "--limit cannot be combined with --base."
  fi
  if [[ -n "$limit" && ! "$limit" =~ ^[0-9]+$ ]]; then
    die "--limit must be a positive integer."
  fi
  if [[ -n "$limit" && "$limit" -eq 0 ]]; then
    die "--limit must be greater than 0."
  fi

  local -a commit_rows=()
  local range_label=""
  local -a git_log_merge_args=()

  if [[ "$include_merges" != "true" ]]; then
    git_log_merge_args+=(--no-merges)
  fi

  if [[ -n "$limit" ]]; then
    mapfile -t commit_rows < <(git log "${git_log_merge_args[@]}" --reverse --max-count "$limit" --pretty=format:'%h%x09%s' "$head")
    range_label="latest ${limit} commit(s) from ${head}"
  else
    if [[ -z "$base" ]]; then
      base="$(default_base_ref || true)"
    fi
    [[ -n "$base" ]] || die "unable to auto-detect base ref; pass --base <ref>."
    git rev-parse --verify "$base" >/dev/null 2>&1 || die "base ref not found: $base"
    git rev-parse --verify "$head" >/dev/null 2>&1 || die "head ref not found: $head"
    mapfile -t commit_rows < <(git log "${git_log_merge_args[@]}" --reverse --pretty=format:'%h%x09%s' "${base}..${head}")
    range_label="${base}..${head}"
  fi

  if [[ "${#commit_rows[@]}" -eq 0 ]]; then
    die "no commits found for the selected range."
  fi

  local output=""
  output+="Changelog Summary"$'\n\n'

  local row=""
  for row in "${commit_rows[@]}"; do
    local subject="${row#*$'\t'}"
    output+="- $(to_sentence_case "$subject")"$'\n'
  done

  output+=$'\n'
  output+="Commit List"$'\n\n'
  for row in "${commit_rows[@]}"; do
    local sha="${row%%$'\t'*}"
    local subject="${row#*$'\t'}"
    output+="- ${sha} ${subject}"$'\n'
  done

  output+=$'\n'
  output+="_Generated from ${range_label} on $(date -u '+%Y-%m-%d %H:%M:%S UTC')._"$'\n'

  if [[ -n "$output_file" ]]; then
    mkdir -p "$(dirname "$output_file")"
    printf '%s' "$output" >"$output_file"
    log "wrote markdown summary to ${output_file}"
  else
    printf '%s' "$output"
  fi
}

main "$@"
