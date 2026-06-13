# Deploying agricogla

agricogla runs in production at **https://agricogla.dbloom.in**, served by a
single EC2 origin behind a Cloudflare Tunnel. The box is **shared** with
`polis.dbloom.in` (and the retired `redvblue.dbloom.in`): each app is an
isolated systemd service on its own localhost port plus a dedicated `cloudflared`
tunnel. This doc is the runbook — the fast path first, the one-time provisioning
and the topology after.

## Fast deploy

```bash
npm run deploy:prod                 # build main -> S3 -> SSM swap -> restart -> verify
npm run deploy:prod -- --ref HEAD   # deploy a specific git ref (branch/tag/sha)
```

That's it. [`scripts/deploy-prod.sh`](../scripts/deploy-prod.sh):

1. builds the ref in a **throwaway git worktree** (`npm ci && npm run build` →
   `dist/` + the esbuild server bundle `dist-server/cli-serve.js`);
2. tars `dist/ dist-server/ package*.json .deploy-version.json` and uploads it to
   S3 via a presigned PUT;
3. sends an **SSM** command to the box that downloads the artifact (presigned
   GET), `npm ci --omit=dev`, atomically swaps `/opt/agricogla/app`, and restarts
   `agricogla.service` (**rolling back** to the previous release on failure);
4. verifies `/health` (`ok`) and `/version` (the per-deploy `deployId`) **locally
   on the box and publicly through the tunnel**. `/version` echoing the deployId
   is the end-to-end proof the new code is actually live.

Notes:

- The script builds from **committed git state** and ignores a dirty working
  tree — commit first, then deploy (use `--ref HEAD` to ship your branch).
- Deploys are **SSM-only — there is no SSH key on the box** and the security
  group has no inbound rules.
- Useful env overrides: `COGENT_ORG_PROFILE` (AWS profile, default `cogora`),
  `AGRICOGLA_DEPLOY_REF`, `AGRICOGLA_EC2_INSTANCE_ID`, `AGRICOGLA_PUBLIC_URL`,
  `AGRICOGLA_PORT`, `AGRICOGLA_SKIP_PUBLIC_VERIFY=1`.

## Topology

| | value |
|---|---|
| Box | EC2 `i-0b9ff9416716820ac` (Amazon Linux 2023, t3.small, us-east-1), tagged `Name=polis`. AWS account `815935788409`, local profile `cogora`. |
| Service | `agricogla.service` runs `node /opt/agricogla/app/dist-server/cli-serve.js --port 8789 --agents scripted,scripted,scripted,scripted` as the `agricogla` user. App at `/opt/agricogla/app`, prior releases under `/opt/agricogla/releases`. |
| Port | app `127.0.0.1:8789`; tunnel metrics `127.0.0.1:2002` (polis uses 8788/2001). |
| Tunnel | Cloudflare Tunnel `agricogla` (`e9ab85ed-960b-4910-992f-aab34c7bc103`, `config_src=local`) as `cloudflared-agricogla.service`. Config `/etc/cloudflared/agricogla.yml`, token `/etc/cloudflared/agricogla.env`. |
| DNS | proxied CNAME `agricogla.dbloom.in → e9ab85ed-960b-4910-992f-aab34c7bc103.cfargotunnel.com` in the `dbloom.in` zone. |
| Artifacts | S3 `s3://polis-cogame-deploy-815935788409-us-east-1/agricogla/releases/` (shared bucket; the box never needs S3 IAM — it fetches via presigned GET). |

### Drive the box without SSH

```bash
aws --profile cogora --region us-east-1 ssm send-command \
  --instance-ids i-0b9ff9416716820ac --document-name AWS-RunShellScript \
  --parameters 'commands=["systemctl status agricogla.service cloudflared-agricogla.service --no-pager"]'
# read output: aws ... ssm get-command-invocation --command-id <id> --instance-id i-0b9ff9416716820ac
```

Or an interactive shell: `aws --profile cogora --region us-east-1 ssm start-session --target i-0b9ff9416716820ac`.

## One-time provisioning (already done)

Re-run only when rebuilding the box from scratch. Cloudflare creds live in SSM
Parameter Store (us-east-1, acct `815935788409`): `/aegis/cloudflare-email` +
`/aegis/cloudflare-api-key` (Global API Key → `X-Auth-Email`/`X-Auth-Key`
headers). Account `0abc983728c4e6eab6f27f9d0c9fe23a`, `dbloom.in` zone
`0e50cbe3df79d46911f15c1c2c151780`.

1. **Cloudflare tunnel** — `POST /accounts/{acct}/cfd_tunnel` with
   `{"name":"agricogla","config_src":"local","tunnel_secret":"<base64 32 bytes>"}`;
   fetch the run token from `/accounts/{acct}/cfd_tunnel/{id}/token`.
2. **DNS** — proxied CNAME `agricogla → {id}.cfargotunnel.com` in the zone.
3. **On the box** (via SSM, as root):
   - `useradd --system --home-dir /var/lib/agricogla --shell /sbin/nologin agricogla`
   - `/etc/cloudflared/agricogla.yml`:
     ```yaml
     ingress:
       - hostname: agricogla.dbloom.in
         service: http://127.0.0.1:8789
       - service: http_status:404
     ```
   - `/etc/cloudflared/agricogla.env`: `TUNNEL_TOKEN=<token>` (chmod 600)
   - `/etc/systemd/system/agricogla.service` — `User=agricogla`,
     `WorkingDirectory=/opt/agricogla/app`, `Environment=NODE_ENV=production`
     `AWS_REGION=us-east-1` `AGRICOGLA_BEDROCK_REGION=us-east-1`,
     `ExecStart=/usr/local/bin/node /opt/agricogla/app/dist-server/cli-serve.js --port 8789 --agents scripted,scripted,scripted,scripted`,
     `Restart=always`.
   - `/etc/systemd/system/cloudflared-agricogla.service` — `EnvironmentFile=/etc/cloudflared/agricogla.env`,
     `ExecStart=/usr/local/bin/cloudflared --no-autoupdate tunnel --config /etc/cloudflared/agricogla.yml --metrics 127.0.0.1:2002 --loglevel info run e9ab85ed-960b-4910-992f-aab34c7bc103`,
     `Restart=always`.
   - `systemctl daemon-reload && systemctl enable --now agricogla.service cloudflared-agricogla.service`
4. Then `npm run deploy:prod` ships the app code.

## Changing the agents

The four seats default to `scripted` (free, self-running demo). To switch to the
Bedrock LLM autopilots, the instance role needs `bedrock:InvokeModel` and the
unit's `ExecStart` needs `--agents llm,llm,llm,llm` (edit the unit on the box,
`daemon-reload`, restart). Seats are also switchable live per-panel in the UI.
```
