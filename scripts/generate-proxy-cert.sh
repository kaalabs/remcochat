#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
generate-proxy-cert.sh

Generate a local CA + CA-signed TLS certificate for the nginx reverse proxy.

Outputs (PEM):
  nginx/certs/ca.pem
  nginx/certs/ca.key
  nginx/certs/tls.pem
  nginx/certs/tls.key

Optional (DER, easier to install on iOS):
  nginx/certs/ca.cer

Optional (iOS profile):
  nginx/certs/remcochat-ca.mobileconfig

Defaults include SANs for:
  DNS: klubnt01, localhost
  IP:  100.71.169.51, 127.0.0.1

Usage:
  scripts/generate-proxy-cert.sh

Then restart the proxy:
  docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d

Notes:
  - Safari/iOS typically requires trusting the CA (ca.pem) on the client device.
  - For a real certificate, replace tls.pem/tls.key with your own.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi
if [[ "${#}" -ne 0 ]]; then
  echo "ERROR: unexpected arguments: $*" >&2
  usage >&2
  exit 2
fi

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(ts) [remcochat-cert] $*"; }
die() { log "ERROR: $*"; exit 1; }

command -v openssl >/dev/null 2>&1 || die "openssl not found"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
CERT_DIR="$REPO_DIR/nginx/certs"
CA_PEM="$CERT_DIR/ca.pem"
CA_KEY="$CERT_DIR/ca.key"
CA_CER="$CERT_DIR/ca.cer"
CERT_PEM="$CERT_DIR/tls.pem"
CERT_KEY="$CERT_DIR/tls.key"
MOBILECONFIG="$CERT_DIR/remcochat-ca.mobileconfig"

mkdir -p "$CERT_DIR"

tmp_ca_conf="$(mktemp)"
tmp_leaf_conf="$(mktemp)"
trap 'rm -f "$tmp_ca_conf" "$tmp_leaf_conf"' EXIT

cat >"$tmp_ca_conf" <<'CONF'
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[dn]
CN = RemcoChat Local CA
O = RemcoChat

[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
CONF

cat >"$tmp_leaf_conf" <<'CONF'
[req]
distinguished_name = dn
req_extensions = v3_req
x509_extensions = v3_req
prompt = no

[dn]
CN = klubnt01
O = RemcoChat

[v3_req]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = klubnt01
DNS.2 = localhost
IP.1 = 100.71.169.51
IP.2 = 127.0.0.1
CONF

if [[ ! -f "$CA_PEM" || ! -f "$CA_KEY" ]]; then
  log "Generating local CA -> $CA_PEM (key -> $CA_KEY)"
  openssl req -x509 -new -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "$CA_KEY" \
    -out "$CA_PEM" \
    -config "$tmp_ca_conf" >/dev/null 2>&1
  chmod 600 "$CA_KEY"
else
  log "Reusing existing CA: $CA_PEM"
fi

# Export CA in DER format (useful for iOS profile install flows).
openssl x509 -in "$CA_PEM" -outform der -out "$CA_CER" >/dev/null 2>&1 || true

if [[ -f "$CA_CER" ]]; then
  profile_uuid="$(openssl rand -hex 16 | tr '[:lower:]' '[:upper:]')"
  payload_uuid="$(openssl rand -hex 16 | tr '[:lower:]' '[:upper:]')"
  profile_uuid="${profile_uuid:0:8}-${profile_uuid:8:4}-${profile_uuid:12:4}-${profile_uuid:16:4}-${profile_uuid:20:12}"
  payload_uuid="${payload_uuid:0:8}-${payload_uuid:8:4}-${payload_uuid:12:4}-${payload_uuid:16:4}-${payload_uuid:20:12}"
  cert_b64="$(base64 < "$CA_CER")"

  cat >"$MOBILECONFIG" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>RemcoChat Local CA.cer</string>
      <key>PayloadContent</key>
      <data>
${cert_b64}
      </data>
      <key>PayloadDisplayName</key>
      <string>RemcoChat Local CA</string>
      <key>PayloadIdentifier</key>
      <string>chat.remco.localca</string>
      <key>PayloadOrganization</key>
      <string>RemcoChat</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${payload_uuid}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>RemcoChat Local CA</string>
  <key>PayloadIdentifier</key>
  <string>chat.remco.localca.profile</string>
  <key>PayloadOrganization</key>
  <string>RemcoChat</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profile_uuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
EOF
fi

tmp_csr="$(mktemp)"
tmp_crt="$(mktemp)"
trap 'rm -f "$tmp_ca_conf" "$tmp_leaf_conf" "$tmp_csr" "$tmp_crt"' EXIT

log "Generating server key -> $CERT_KEY"
openssl req -new -newkey rsa:2048 -sha256 -nodes \
  -keyout "$CERT_KEY" \
  -out "$tmp_csr" \
  -config "$tmp_leaf_conf" >/dev/null 2>&1

log "Signing server cert with local CA -> $CERT_PEM"
openssl x509 -req -sha256 -days 365 \
  -in "$tmp_csr" \
  -CA "$CA_PEM" \
  -CAkey "$CA_KEY" \
  -CAcreateserial \
  -out "$tmp_crt" \
  -extfile "$tmp_leaf_conf" \
  -extensions v3_req >/dev/null 2>&1

# Fullchain PEM for nginx: leaf + CA.
cat "$tmp_crt" "$CA_PEM" >"$CERT_PEM"

chmod 600 "$CERT_KEY"
log "Done"
