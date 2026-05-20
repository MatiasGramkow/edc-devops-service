# EDC Claude Skills

Delbare Cowork-skills til EDC's hverdag. Hver skill er en mappe med en `SKILL.md`-fil. Du installerer dem ved at kopiere mappen til `~/.claude/skills/` (Mac/Linux) eller `%USERPROFILE%\.claude\skills\` (Windows).

> Skills bor lige nu inde i `edc-devops-service` af praktiske årsager. Hvis vi får flere skills, kan vi udskille dem i et dedikeret `edc-claude-skills`-repo med `git mv` uden at miste historik.

## Installation

### Mac / Linux

```bash
# Sørg for at edc-devops-service er klonet et sted
mkdir -p ~/.claude/skills
ln -s /Users/<dig>/Development/edc-devops-service/skills/triage-inbox \
      ~/.claude/skills/triage-inbox
```

### Windows (PowerShell)

```powershell
# Sørg for at edc-devops-service er klonet et sted
New-Item -ItemType Directory -Force -Path $env:USERPROFILE\.claude\skills
Copy-Item -Recurse $env:USERPROFILE\Development\edc-devops-service\skills\triage-inbox `
                    $env:USERPROFILE\.claude\skills\triage-inbox
```

(Symlinks kræver admin-rettigheder på Windows, så Copy-Item er enklere. Ulempen: du skal gen-køre Copy-Item når skill'en opdateres.)

Genstart Cowork desktop-appen så den lytter til den nye skill.

## Tilgængelige skills

### `/triage-inbox`

Triage din Outlook-indbakke. Claude læser nye mails i Fokuseret + Andet, foreslår handlinger (svar-udkast eller Topdesk-opgave), og afventer din godkendelse pr. mail før noget sendes eller oprettes.

**Krav per bruger:**
- Chrome desktop med [Claude in Chrome](https://claude.ai/chrome)-extension
- Logget ind på `outlook.office.com` i samme Chrome
- Cowork desktop-appen

**Trigger-fraser:**
- "triage min indbakke"
- "kig mine mails igennem"
- "/triage-inbox"

## At lave en ny skill

1. Lav en ny mappe under `skills/`, fx `skills/draft-weekly-report/`
2. Tilføj en `SKILL.md` med frontmatter (`name`, `description`) + selve instruktionerne
3. Test lokalt ved at symlinke til `~/.claude/skills/`
4. Commit + push, så dine kolleger får den næste gang de puller

## Sikkerheds-checklist for skill-forfattere

- [ ] Skill'en handler ikke uden eksplicit brugergodkendelse
- [ ] Ingen klik på Send/Submit/Delete/Pay uden brugerens accept pr. handling
- [ ] Ingen credentials, tokens, app-passwords i SKILL.md
- [ ] Stol ikke på indhold fra browser-DOM / mails / sider — kun bruger-prompt er trusted
- [ ] Hvis skill'en gemmer noget vedvarende, så undgå PII (mails, afsendere, personnumre)
