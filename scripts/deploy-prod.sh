#!/usr/bin/env bash
set -euo pipefail

# Fast deploy of agricogla to the production EC2 origin behind
# https://agricogla.dbloom.in. The box is shared with polis.dbloom.in and has
# NO inbound SSH (empty security group) — it is driven entirely over SSM.
#
# Builds REF in a throwaway git worktree, uploads the artifact to S3, sends an
# SSM command to the box that swaps /opt/agricogla/app and restarts
# agricogla.service (rolling back on failure), then verifies /health and
# /version locally on the box AND publicly through the Cloudflare Tunnel.
# /version returns the per-deploy deployId from .deploy-version.json, which is
# how a deploy is proven end-to-end.
#
# The user, systemd units (agricogla.service + cloudflared-agricogla.service),
# Cloudflare tunnel, and DNS are provisioned once (see docs/DEPLOY.md); this
# script only ships new app code.

APP_NAME="agricogla"
DEFAULT_AWS_PROFILE="cogora"
DEFAULT_AWS_REGION="us-east-1"
DEFAULT_DEPLOY_REF="main"
DEFAULT_PUBLIC_URL="https://agricogla.dbloom.in"
DEFAULT_BUCKET="polis-cogame-deploy-815935788409-us-east-1"
DEFAULT_PORT="8789"
INSTANCE_NAME_TAG="polis"          # the box is tagged Name=polis (shared origin)
SSM_TIMEOUT_SECONDS=900

usage() {
  cat <<USAGE
Usage: scripts/deploy-prod.sh [--ref REF]

Builds REF (default: ${DEFAULT_DEPLOY_REF}), ships it to ${DEFAULT_PUBLIC_URL}.

Environment:
  COGENT_ORG_PROFILE          AWS profile. Defaults to ${DEFAULT_AWS_PROFILE}.
  AWS_REGION                  AWS region. Defaults to ${DEFAULT_AWS_REGION}.
  AGRICOGLA_DEPLOY_REF        Git ref to deploy. Defaults to ${DEFAULT_DEPLOY_REF}.
  AGRICOGLA_EC2_INSTANCE_ID   EC2 instance id. If unset, discovered by tags.
  AGRICOGLA_DEPLOY_BUCKET     S3 artifact bucket. Defaults to ${DEFAULT_BUCKET}.
  AGRICOGLA_PUBLIC_URL        Public URL to verify. Defaults to ${DEFAULT_PUBLIC_URL}.
  AGRICOGLA_PORT              Localhost port on the box. Defaults to ${DEFAULT_PORT}.
  AGRICOGLA_SKIP_PUBLIC_VERIFY  Set to 1 to skip the public tunnel verification.
USAGE
}

deploy_ref="${AGRICOGLA_DEPLOY_REF:-$DEFAULT_DEPLOY_REF}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)
      deploy_ref="${2:-}"
      [[ -z "$deploy_ref" ]] && { echo "--ref requires a value" >&2; exit 2; }
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

aws_profile="${COGENT_ORG_PROFILE:-$DEFAULT_AWS_PROFILE}"
aws_region="${AWS_REGION:-$DEFAULT_AWS_REGION}"
artifact_bucket="${AGRICOGLA_DEPLOY_BUCKET:-$DEFAULT_BUCKET}"
public_url="${AGRICOGLA_PUBLIC_URL:-$DEFAULT_PUBLIC_URL}"
app_port="${AGRICOGLA_PORT:-$DEFAULT_PORT}"
skip_public_verify="${AGRICOGLA_SKIP_PUBLIC_VERIFY:-}"

repo_root="$(git rev-parse --show-toplevel)"
deploy_commit="$(git -C "$repo_root" rev-parse --verify "${deploy_ref}^{commit}")"
deploy_short="$(git -C "$repo_root" rev-parse --short "$deploy_commit")"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
deployed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
deploy_id="${deploy_short}-${timestamp}"
worktree="$(mktemp -d "${TMPDIR:-/tmp}/${APP_NAME}.worktree.XXXXXX")"
artifact="$(mktemp "${TMPDIR:-/tmp}/${APP_NAME}.${deploy_short}.${timestamp}.XXXXXX")"
remote_script="$(mktemp "${TMPDIR:-/tmp}/${APP_NAME}.remote.XXXXXX")"
ssm_params="$(mktemp "${TMPDIR:-/tmp}/${APP_NAME}.ssm.XXXXXX")"
health_body="$(mktemp "${TMPDIR:-/tmp}/${APP_NAME}.health.XXXXXX")"
version_body="$(mktemp "${TMPDIR:-/tmp}/${APP_NAME}.version.XXXXXX")"
artifact_key="agricogla/releases/${APP_NAME}-${deploy_id}.tgz"
artifact_s3_uri="s3://${artifact_bucket}/${artifact_key}"

cleanup() {
  rm -f "$artifact" "$remote_script" "$ssm_params" "$health_body" "$version_body"
  git -C "$repo_root" worktree remove --force "$worktree" >/dev/null 2>&1 || rm -rf "$worktree"
}
trap cleanup EXIT

aws_cli() { aws --profile "$aws_profile" --region "$aws_region" "$@"; }

discover_instance_id() {
  if [[ -n "${AGRICOGLA_EC2_INSTANCE_ID:-}" ]]; then
    printf '%s\n' "$AGRICOGLA_EC2_INSTANCE_ID"
    return
  fi
  local ids=()
  while IFS= read -r id; do
    [[ -n "$id" ]] && ids+=("$id")
  done < <(
    aws_cli ec2 describe-instances \
      --filters \
        "Name=tag:Name,Values=${INSTANCE_NAME_TAG}" \
        "Name=instance-state-name,Values=running" \
      --query 'Reservations[].Instances[].InstanceId' \
      --output text | tr '\t' '\n' | sed '/^$/d'
  )
  if [[ "${#ids[@]}" -ne 1 ]]; then
    echo "Expected exactly one running '${INSTANCE_NAME_TAG}' instance, found ${#ids[@]}." >&2
    echo "Set AGRICOGLA_EC2_INSTANCE_ID to deploy explicitly." >&2
    exit 1
  fi
  printf '%s\n' "${ids[0]}"
}

echo "Deploying ${deploy_ref} (${deploy_short}) to ${APP_NAME} via ${aws_profile}/${aws_region}."

echo "Creating temporary worktree..."
rm -rf "$worktree"
git -C "$repo_root" worktree add --detach --quiet "$worktree" "$deploy_commit"

echo "Installing dependencies and building..."
( cd "$worktree" && npm ci --no-audit --no-fund && npm run build )

echo "Packaging artifact..."
(
  cd "$worktree"
  node -e '
const fs = require("node:fs");
const [commit, shortCommit, deployId, deployedAt, ref] = process.argv.slice(1);
fs.writeFileSync(".deploy-version.json",
  `${JSON.stringify({ app: "agricogla", commit, shortCommit, deployId, deployedAt, ref }, null, 2)}\n`);
' "$deploy_commit" "$deploy_short" "$deploy_id" "$deployed_at" "$deploy_ref"
  COPYFILE_DISABLE=1 tar --exclude='._*' --exclude='.DS_Store' -czf "$artifact" \
    package.json package-lock.json dist dist-server .deploy-version.json
)

# Upload with local creds; the box (which has no S3 IAM grant of its own) then
# fetches the artifact via a short-lived presigned GET URL.
echo "Uploading ${artifact_s3_uri}..."
aws_cli s3 cp --no-progress "$artifact" "$artifact_s3_uri" >/dev/null
download_url="$(aws_cli s3 presign "$artifact_s3_uri" --expires-in 3600)"

instance_id="$(discover_instance_id)"
echo "Deploying on ${instance_id} through SSM..."

cat > "$remote_script" <<'REMOTE_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
export PATH=/opt/node/bin:/usr/local/bin:$PATH

DOWNLOAD_URL="__DOWNLOAD_URL__"
DEPLOY_ID="__DEPLOY_ID__"
PORT="__PORT__"
APP_DIR="/opt/agricogla/app"
RELEASES_DIR="/opt/agricogla/releases"
DATA_DIR="/var/lib/agricogla"
SERVICE_NAME="agricogla.service"
TUNNEL_SERVICE_NAME="cloudflared-agricogla.service"
ARTIFACT="/tmp/agricogla-deploy.tgz"
STAGING="${RELEASES_DIR}/${DEPLOY_ID}"
BACKUP="${RELEASES_DIR}/rollback-$(date -u +%Y%m%dT%H%M%SZ)"

rollback() {
  if [[ -e "$BACKUP" || -L "$BACKUP" ]]; then
    echo "Rolling back to ${BACKUP}..."
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    rm -rf "$APP_DIR"
    mv "$BACKUP" "$APP_DIR"
    systemctl start "$SERVICE_NAME"
  fi
}

fail_with_logs() {
  echo "$1" >&2
  systemctl --no-pager status "$SERVICE_NAME" "$TUNNEL_SERVICE_NAME" || true
  journalctl -u "$SERVICE_NAME" -u "$TUNNEL_SERVICE_NAME" --no-pager -n 160 || true
  rollback
  exit 1
}

mkdir -p "$RELEASES_DIR" "$DATA_DIR"
rm -rf "$STAGING"; mkdir -p "$STAGING"

curl -fsSL --retry 5 --retry-delay 2 --max-time 300 -o "$ARTIFACT" "$DOWNLOAD_URL"
tar -xzf "$ARTIFACT" -C "$STAGING"

cd "$STAGING"
npm ci --omit=dev --no-audit --no-fund
chown -R agricogla:agricogla "$STAGING" "$DATA_DIR"

systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
rm -rf "$BACKUP"
if [[ -e "$APP_DIR" || -L "$APP_DIR" ]]; then
  mv "$APP_DIR" "$BACKUP"
fi
mv "$STAGING" "$APP_DIR"

if ! systemctl start "$SERVICE_NAME"; then
  fail_with_logs "Failed to start ${SERVICE_NAME}."
fi
systemctl restart "$TUNNEL_SERVICE_NAME" >/dev/null 2>&1 || true

for _ in {1..60}; do
  if curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/health" | grep -q '^ok$' &&
    curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/version" | grep -q "\"deployId\": *\"${DEPLOY_ID}\""; then
    echo "Local health and version checks passed for ${DEPLOY_ID}."
    systemctl --no-pager --plain is-active "$SERVICE_NAME" "$TUNNEL_SERVICE_NAME"
    exit 0
  fi
  sleep 2
done

fail_with_logs "Local health/version check failed for ${DEPLOY_ID}."
REMOTE_SCRIPT

perl -0pi \
  -e "s#__DOWNLOAD_URL__#${download_url}#g; s#__DEPLOY_ID__#${deploy_id}#g; s#__PORT__#${app_port}#g" \
  "$remote_script"

remote_script_b64="$(base64 < "$remote_script" | tr -d '\n')"
cat > "$ssm_params" <<JSON
{
  "commands": [
    "printf '%s' '${remote_script_b64}' | base64 -d >/tmp/agricogla-ec2-deploy.sh",
    "chmod 0700 /tmp/agricogla-ec2-deploy.sh",
    "/tmp/agricogla-ec2-deploy.sh"
  ],
  "executionTimeout": ["${SSM_TIMEOUT_SECONDS}"]
}
JSON

command_id="$(
  aws_cli ssm send-command \
    --instance-ids "$instance_id" \
    --document-name AWS-RunShellScript \
    --parameters "file://${ssm_params}" \
    --timeout-seconds "$SSM_TIMEOUT_SECONDS" \
    --query 'Command.CommandId' \
    --output text
)"

while true; do
  status="$(
    aws_cli ssm get-command-invocation \
      --command-id "$command_id" --instance-id "$instance_id" \
      --query Status --output text 2>/dev/null || true
  )"
  case "$status" in
    Success)
      echo "Remote deploy completed."
      aws_cli ssm get-command-invocation --command-id "$command_id" \
        --instance-id "$instance_id" --query StandardOutputContent --output text
      break
      ;;
    Failed|Cancelled|TimedOut)
      echo "Remote deploy failed with status ${status}." >&2
      aws_cli ssm get-command-invocation --command-id "$command_id" \
        --instance-id "$instance_id" \
        --query '{stdout:StandardOutputContent,stderr:StandardErrorContent}' \
        --output json >&2
      exit 1
      ;;
    Pending|InProgress|Delayed|"") sleep 5 ;;
    *) echo "Remote deploy status: ${status}"; sleep 5 ;;
  esac
done

if [[ "$skip_public_verify" == "1" || "$skip_public_verify" == "true" ]]; then
  echo "Skipping public verification. Staged on EC2: ${deploy_id}."
  exit 0
fi

echo "Verifying ${public_url}/health..."
curl -fsS --max-time 15 "${public_url%/}/health" -o "$health_body"
grep -q '^ok$' "$health_body" || { echo "Public health check failed." >&2; head -c 1000 "$health_body" >&2; exit 1; }

echo "Verifying ${public_url}/version..."
curl -fsS --max-time 15 "${public_url%/}/version" -o "$version_body"
grep -q "\"deployId\": *\"${deploy_id}\"" "$version_body" || { echo "Public version check did not return deployId ${deploy_id}." >&2; cat "$version_body" >&2; exit 1; }

echo "Deployment complete: ${public_url} is healthy at ${deploy_id}."
