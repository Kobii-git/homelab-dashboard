#!/usr/bin/env bash
set -euo pipefail

umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ${1:-} != "" && ${1:-} != "--configure-only" ]]; then
  echo "Usage: ./scripts/install-docker.sh [--configure-only]" >&2
  exit 2
fi

for command in docker openssl awk; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 1
  fi
done

if [[ -L .env ]]; then
  echo "Refusing to write through a .env symlink." >&2
  exit 1
fi
if [[ ! -e .env ]]; then
  cp .env.example .env
fi
chmod 600 .env

get_setting() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' .env
}

set_setting() {
  local key=$1 value=$2 temporary
  temporary=$(mktemp ./.env.XXXXXX)
  awk -v key="$key" -v value="$value" '
    $0 ~ "^" key "=" { if (!found++) print key "=" value; next }
    { print }
    END { if (!found) print key "=" value }
  ' .env > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" .env
}

prompt_setting() {
  local key=$1 description=$2 example=$3 value
  value=$(get_setting "$key")
  if [[ -n $value && $value != "$example" ]]; then
    return
  fi
  if [[ ! -t 0 ]]; then
    echo "Set $key in .env, then rerun this script (example: $example)." >&2
    exit 1
  fi
  while true; do
    read -r -p "$description (example: $example): " value
    if [[ -n $value && $value != *[[:space:]]* && $value != *[\$\#]* ]]; then
      set_setting "$key" "$value"
      return
    fi
    echo "Enter your actual value without spaces, \$ or #." >&2
  done
}

prompt_setting APP_ORIGIN "HTTPS URL served by your reverse proxy" "https://dashboard.home.arpa"
prompt_setting TRUST_PROXY_CIDRS "Exact proxy source CIDR as seen by the container" "172.17.0.1/32"
prompt_setting OUTBOUND_ALLOWED_CIDRS "Smallest CIDR your dashboard may monitor" "192.168.50.0/24"

if [[ $(get_setting APP_ORIGIN) != https://* ]]; then
  echo "APP_ORIGIN must be an HTTPS origin. Check .env." >&2
  exit 1
fi

cookie_secret=$(get_setting COOKIE_SECRET)
generated_cookie_secret=false
if [[ -z $cookie_secret ]]; then
  set_setting COOKIE_SECRET "$(openssl rand -hex 32)"
  generated_cookie_secret=true
elif [[ ${#cookie_secret} -lt 32 ]]; then
  echo "COOKIE_SECRET in .env must be at least 32 characters." >&2
  exit 1
fi

if [[ -z $(get_setting ADMIN_PASSWORD) ]]; then
  setup_code=$(get_setting SETUP_CODE)
  if [[ -z $setup_code && $generated_cookie_secret == true ]]; then
    while [[ ${#setup_code} -lt 12 ]]; do
      setup_code=$(openssl rand -base64 48 | tr -dc 'A-Z2-9' | cut -c1-12)
    done
    set_setting SETUP_CODE "$setup_code"
  elif [[ -n $setup_code && ! $setup_code =~ ^[A-Z2-9]{12}$ ]]; then
    echo "SETUP_CODE in .env must contain exactly 12 characters from A-Z and 2-9." >&2
    exit 1
  elif [[ -z $setup_code ]]; then
    echo "SETUP_CODE is empty. For first boot, set a 12-character A-Z/2-9 code in .env; after account setup, leave it empty."
  fi
fi

echo "Checking Docker Compose configuration..."
docker compose -f docker-compose.yml -f docker-compose.build.yml config --quiet

if [[ ${1:-} == "--configure-only" ]]; then
  echo "Configuration saved to .env with owner-only permissions."
  exit 0
fi

echo "Building and starting Homelab Dashboard..."
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build --wait
echo "Open $(get_setting APP_ORIGIN) through your HTTPS reverse proxy."
if [[ -z $(get_setting ADMIN_PASSWORD) && -n $(get_setting SETUP_CODE) ]]; then
  echo "For first-time account setup, read SETUP_CODE from the private .env file. Remove it after setup."
fi
