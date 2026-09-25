#!/usr/bin/env bash
set -euo pipefail

umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."

configure_only=false
requested_mode=""
for option in "$@"; do
  case "$option" in
    --configure-only) configure_only=true ;;
    --lan-http) requested_mode=lan ;;
    --https-proxy) requested_mode=https ;;
    *) echo "Usage: ./scripts/install-docker.sh [--configure-only] [--lan-http | --https-proxy]" >&2; exit 2 ;;
  esac
done

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
  local key=$1 description=$2 example=$3 prefix=${4:-} value
  value=$(get_setting "$key")
  if [[ -n $value && $value != "$example" && ( -z $prefix || $value == "$prefix"* ) ]]; then
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

private_bind_ip() {
  local first second third fourth octet
  [[ $1 =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS=. read -r first second third fourth <<< "$1"
  for octet in "$first" "$second" "$third" "$fourth"; do
    [[ $octet == 0 || $octet != 0* ]] || return 1
    (( 10#$octet <= 255 )) || return 1
  done
  (( 10#$first == 10 ||
     (10#$first == 172 && 10#$second >= 16 && 10#$second <= 31) ||
     (10#$first == 192 && 10#$second == 168) ||
     (10#$first == 100 && 10#$second >= 64 && 10#$second <= 127) )) || [[ $1 == 127.0.0.1 ]]
}

detect_host_network() {
  local route bind_ip interface address
  command -v ip >/dev/null 2>&1 || return 1
  # This asks the local routing table for its default path; it sends no packet.
  route=$(ip -4 route get 1.1.1.1 2>/dev/null) || return 1
  bind_ip=$(awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }' <<< "$route")
  interface=$(awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }' <<< "$route")
  [[ -n $interface && $bind_ip != 127.0.0.1 ]] && private_bind_ip "$bind_ip" || return 1
  address=$(ip -o -4 addr show dev "$interface" scope global 2>/dev/null |
    awk -v ip="$bind_ip" '$3 == "inet" { split($4, parts, "/"); if (parts[1] == ip) { print $4; exit } }')
  [[ -n $address ]] || return 1
  printf '%s\n' "$bind_ip"
}

mode=$requested_mode
if [[ -z $mode ]]; then
  origin=$(get_setting APP_ORIGIN)
  if [[ $(get_setting DIRECT_HTTP_LAN) == true || $origin == http://* || -z $origin || $origin == https://dashboard.home.arpa ]]; then
    mode=lan
  else
    mode=https
  fi
fi

detected_ip=""
detected_ip=$(detect_host_network || true)

if [[ $mode == lan ]]; then
  bind_ip=$(get_setting DASHBOARD_BIND_IP)
  if ! private_bind_ip "$bind_ip" || [[ $bind_ip == 127.0.0.1 && $(get_setting DIRECT_HTTP_LAN) != true ]]; then
    if [[ -n $detected_ip ]]; then
      bind_ip=$detected_ip
    else
      if [[ ! -t 0 ]]; then
        echo "Set DASHBOARD_BIND_IP to this host's private IPv4 address in .env, then rerun." >&2
        exit 1
      fi
      while true; do
        read -r -p "Private IPv4 address assigned to this Docker host (example: 192.168.1.20): " bind_ip
        if private_bind_ip "$bind_ip"; then break; fi
        echo "Enter one private LAN/VPN IPv4 address on this host, or 127.0.0.1 for host-only access." >&2
      done
    fi
  fi
  set_setting DASHBOARD_BIND_IP "$bind_ip"
  set_setting APP_ORIGIN "http://$bind_ip:4173"
  set_setting TRUST_PROXY_CIDRS ""
  set_setting DIRECT_HTTP_LAN true
else
  prompt_setting APP_ORIGIN "HTTPS URL served by your reverse proxy" "https://dashboard.home.arpa" "https://"
  prompt_setting TRUST_PROXY_CIDRS "Exact proxy source CIDR as seen by the container" "172.17.0.1/32"
  set_setting DASHBOARD_BIND_IP 127.0.0.1
  set_setting DIRECT_HTTP_LAN false
fi
if [[ $mode == https && $(get_setting APP_ORIGIN) != https://* ]]; then
  echo "APP_ORIGIN must be an HTTPS origin in proxy mode. Check .env." >&2
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

if [[ $configure_only == true ]]; then
  echo "Configuration saved to .env with owner-only permissions."
  exit 0
fi

echo "Building and starting Homelab Dashboard..."
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build --wait --remove-orphans
if [[ $mode == lan ]]; then
  echo "Open $(get_setting APP_ORIGIN) on your trusted LAN/VPN. Credentials and cookies travel over HTTP until you add HTTPS."
else
  echo "Open $(get_setting APP_ORIGIN) through your HTTPS reverse proxy."
fi
if [[ -z $(get_setting ADMIN_PASSWORD) && -n $(get_setting SETUP_CODE) ]]; then
  echo "For first-time account setup, read SETUP_CODE from the private .env file. Remove it after setup."
fi
