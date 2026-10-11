#!/usr/bin/env bash

deployment_plan_bool() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES | on | ON) return 0 ;;
    *) return 1 ;;
  esac
}

deployment_plan_changed() {
  [[ -z "$1" || "$1" != "$2" ]]
}

build_deployment_plan() {
  local current_backend="$1"
  local current_frontend="$2"
  local current_bot="$3"
  local current_caddy="$4"
  local requested_backend="$5"
  local requested_frontend="$6"
  local requested_bot="$7"
  local requested_caddy="$8"
  local include_ops_bot="$9"
  local include_edge="${10}"
  local current_application_config="${11}"
  local requested_application_config="${12}"

  BACKEND_CHANGED=false
  FRONTEND_CHANGED=false
  BOT_CHANGED=false
  CADDY_CONFIG_CHANGED=false
  APPLICATION_CONFIG_CHANGED=false
  INITIAL_DEPLOY=false
  DATABASE_WORK_REQUIRED=false
  EDGE_RESTART_REQUIRED=false
  DEPLOYMENT_SERVICES=()

  if [[ -z "$current_backend" && -z "$current_frontend" ]]; then
    INITIAL_DEPLOY=true
  fi

  if deployment_plan_changed "$current_application_config" "$requested_application_config"; then
    APPLICATION_CONFIG_CHANGED=true
  fi

  if deployment_plan_changed "$current_backend" "$requested_backend"; then
    BACKEND_CHANGED=true
    DATABASE_WORK_REQUIRED=true
  fi
  if [[ "$BACKEND_CHANGED" == "true" || "$APPLICATION_CONFIG_CHANGED" == "true" ]]; then
    DEPLOYMENT_SERVICES+=(
      batch-backend
      batch-worker
      transcribe-worker
      student-memory-worker
      batch-frontend
    )
  fi

  if deployment_plan_changed "$current_frontend" "$requested_frontend"; then
    FRONTEND_CHANGED=true
    if [[ "$BACKEND_CHANGED" != "true" && "$APPLICATION_CONFIG_CHANGED" != "true" ]]; then
      DEPLOYMENT_SERVICES+=(batch-frontend)
    fi
  fi

  if deployment_plan_bool "$include_ops_bot"; then
    if deployment_plan_changed "$current_bot" "$requested_bot"; then
      BOT_CHANGED=true
    fi
    if [[ "$BOT_CHANGED" == "true" || "$APPLICATION_CONFIG_CHANGED" == "true" ]]; then
      DEPLOYMENT_SERVICES+=(telegram-ops-bot)
    fi
  fi

  if deployment_plan_bool "$include_edge" \
    && deployment_plan_changed "$current_caddy" "$requested_caddy"; then
    CADDY_CONFIG_CHANGED=true
  fi

  if deployment_plan_bool "$include_edge" \
    && [[ "$BACKEND_CHANGED" == "true" \
      || "$FRONTEND_CHANGED" == "true" \
      || "$APPLICATION_CONFIG_CHANGED" == "true" \
      || "$CADDY_CONFIG_CHANGED" == "true" ]]; then
    EDGE_RESTART_REQUIRED=true
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  [[ "$#" -eq 12 ]] || {
    echo "expected 12 deployment-plan arguments" >&2
    exit 2
  }
  build_deployment_plan "$@"
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
    "$BACKEND_CHANGED" "$FRONTEND_CHANGED" "$BOT_CHANGED" "$CADDY_CONFIG_CHANGED" \
    "$DATABASE_WORK_REQUIRED" "$EDGE_RESTART_REQUIRED" "$INITIAL_DEPLOY" \
    "${DEPLOYMENT_SERVICES[*]}" "$APPLICATION_CONFIG_CHANGED"
fi
