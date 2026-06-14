# Migrating Git Repos from GitHub to Codeberg (reusable guide)

This document was produced as the final artifact of a successful automated migration. It is deliberately repo-independent so it (or its content) can be copied into other projects you migrate in the future.

## Prerequisites (one-time per machine / per target account)

- GitHub CLI (`gh`) authenticated with a token that has `repo` (and `read:org` if using orgs) and permission to archive the source repo.
- SSH key(s) registered:
  - On GitHub for the source (owner or org) — test with `ssh -T git@github.com`
  - On Codeberg for the target user — test with `ssh -T git@codeberg.org` (should greet your Codeberg username).
- `CODEBERG_TOKEN` environment variable containing a Forgejo/Codeberg API token for the target user (scope must allow creating private repos and writing to them). Export it for the session:
  `export CODEBERG_TOKEN=...`
- Standard tools: `git`, `curl`, `python3` (used for tiny JSON pretty-printing in verification).

## 1. Create the empty target repository on Codeberg (via API)

```sh
REPO_NAME="your-repo-name"          # change per project
OWNER="your-codeberg-username"      # the account that will own it
API="https://codeberg.org/api/v1"

if curl -sS -f -H "Authorization: token $CODEBERG_TOKEN" \
     "$API/repos/$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "Repo already exists on Codeberg — OK."
else
  curl -sS -X POST \
    -H "Authorization: token $CODEBERG_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "'"$REPO_NAME"'",
      "description": "Short description of the project.",
      "private": true,
      "auto_init": false
    }' \
    "$API/user/repos"
fi

# Verify
curl -sS -H "Authorization: token $CODEBERG_TOKEN" \
  "$API/repos/$OWNER/$REPO_NAME" | python3 -c '
import sys, json
d=json.load(sys.stdin)
print(d.get("full_name"), "private=", d.get("private"), "empty=", d.get("empty"))
'
```

## 2. Add remote + push full history

```sh
git remote add codeberg git@codeberg.org:$OWNER/$REPO_NAME.git || true
git push codeberg --all
# Push any remote-tracking-only branches that --all missed
# git push codeberg origin/some-feature:refs/heads/some-feature
git push codeberg --tags
```

(If SSH is flaky, temporarily `git remote set-url codeberg https://$CODEBERG_TOKEN@codeberg.org/$OWNER/$REPO_NAME.git`, push, then restore the ssh URL.)

## 3. (Recommended) Add a migration notice as the final commit on main

Edit `README.md` (or the project's primary docs) to insert near the top, after the title:

```
> **Note:** This project has migrated from GitHub to Codeberg.
> Canonical location: https://codeberg.org/OWNER/REPO
> The GitHub location is now archived and read-only.
```

```sh
git add README.md
git commit -m "docs: record migration to Codeberg (OWNER/REPO); GitHub archived read-only"
git push codeberg main
# Optionally also push the notice to the old GitHub (so the archived copy has the pointer)
git push origin main
```

## 4. Re-point local clone (origin becomes Codeberg)

```sh
git remote rename origin github
git remote add origin git@codeberg.org:$OWNER/$REPO_NAME.git
git branch --set-upstream-to=origin/main main
git remote -v
git fetch --all --prune
```

## 5. Mark the GitHub repo read-only (archive)

```sh
gh repo edit GITHUB_OWNER/GITHUB_REPO \
  --description "Migrated to Codeberg. Active repo: https://codeberg.org/OWNER/REPO" \
  --homepage "https://codeberg.org/OWNER/REPO"

gh repo archive GITHUB_OWNER/GITHUB_REPO --yes

# Confirm
gh repo view GITHUB_OWNER/GITHUB_REPO --json nameWithOwner,isArchived,description,homepageUrl
```

(Optional but nice) Also update the Codeberg repo metadata via API (PATCH /repos/...).

## 6. Verification (copy these and adapt OWNER/REPO)

- Remotes & branches on both sides (`git remote -v`, `git ls-remote ...`)
- `gh ... isArchived == true`
- `curl ... /api/v1/repos/OWNER/REPO` (private, correct name)
- `git ls-remote` on both the codeberg URL and the github URL
- Project-specific checks still pass (west manifest, tests, build commands)
- The `MIGRATION.md` file exists in the working tree and is committed on the Codeberg main.

## After you are done (for this or future projects)

- Share the new Codeberg URL with the team.
- Old clones: `git remote set-url origin git@codeberg.org:OWNER/REPO.git` (or keep a `github` remote for `git fetch github`).
- The archived GitHub repo remains fetchable for a while but accepts no new pushes or PRs.
- Feel free to copy this `MIGRATION.md` (or its content) into other repositories you migrate.

_Generated as the final step of an automated migration. Adapt the placeholders for each new project._
