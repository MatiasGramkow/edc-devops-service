# Dagligt Topdesk → Azure DevOps sync-job

Henter nye åbne Topdesk-tickets siden sidste kørsel og opretter et Product
Backlog Item per ticket i Azure DevOps (med tag `TOPdesk:<nr>` så dubletter
opdages). Bruger samme `.env.local` som Next.js-appen.

## Indhold

- `daily-sync.mjs` — selve sync-scriptet (Node 20+, ingen deps udover `fetch`).
- `run-daily-sync.sh` — wrapper som finder `node` på din Mac (Homebrew/nvm).
- `dk.edc.topdesk-devops-sync.plist` — macOS LaunchAgent: kører kl. 09:00 hverdage.
- `install-launchagent.sh` — installerer/genindlæser LaunchAgent'en.

## Installation (én gang)

```bash
cd /Users/matiasgramkow/Development/edc-devops-service
bash scripts/install-launchagent.sh
```

Verificér at den er loaded:

```bash
launchctl list | grep dk.edc.topdesk-devops-sync
```

## Manuel kørsel

```bash
# Vis hvad der ville ske, uden at skrive til DevOps:
node scripts/daily-sync.mjs --dry-run

# Kør rigtigt:
node scripts/daily-sync.mjs
```

State (sidste kørsel + sidste resultat) gemmes i `data/daily-sync-state.json`.
Slet filen for at "starte forfra" (vil så kigge 24 timer tilbage).

## Logs

- `~/Library/Logs/edc-topdesk-sync/stdout.log`
- `~/Library/Logs/edc-topdesk-sync/stderr.log`

## Afinstallation

```bash
bash scripts/install-launchagent.sh --uninstall
```

## Konfiguration

Læser fra `.env.local`:
- `TOPDESK_URL`, `TOPDESK_API_USER`, `TOPDESK_APP_TOKEN`
- `AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT`, `AZURE_DEVOPS_PAT`
- `TOPDESK_MY_OPERATOR_ID` (valgfri) — hvis sat, henter jobbet kun tickets
  tildelt netop denne operator. Hvis tom: alle åbne tickets.

### Find dit operator-UUID

```bash
node scripts/find-my-operator-id.mjs                  # bruger magr@edc.dk
node scripts/find-my-operator-id.mjs anden@edc.dk     # eller eksplicit
```

Output viser dit `id`, som du tilføjer i `.env.local`:

```
TOPDESK_MY_OPERATOR_ID=<uuid>
```

Derefter vil `daily-sync.mjs` (både manuel kørsel og LaunchAgent'en) kun
oprette PBI'er for tickets der er tildelt dig.

### Node-binary

Hvis du vil tvinge en bestemt node, sæt fx `NODE_BIN=/opt/homebrew/bin/node`
før `run-daily-sync.sh` (eller i plist'ens `EnvironmentVariables`).
