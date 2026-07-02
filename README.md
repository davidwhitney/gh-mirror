# gh-mirror

Clone and update all repositories for a GitHub user or organisation, in parallel.

Repos are organised as `<base-path>/<owner>/<repo>`.

## Install

```bash
npm install -g gh-mirror
```

## Authentication

Provide a GitHub Personal Access Token via one of:

- `--token <pat>` CLI flag
- `GITHUB_TOKEN` environment variable
- `GH_TOKEN` environment variable

Create a token at https://github.com/settings/tokens with the `repo` scope (private repos) or `public_repo` (public only).

## Usage

```
gh-mirror [options] [target]
```

By default (no `--clone` or `--update` flag), both clone and update are run. Freshly cloned repos are skipped during update.

```bash
# Clone new + update existing repos for a user or org
gh-mirror MyOrg

# Clone new + update all from manifest
gh-mirror
```

### Clone only

```bash
gh-mirror --clone MyOrg
gh-mirror --clone "MyOrg/Acq*"
gh-mirror --clone                  # clone new repos from manifest
```

### Update only

```bash
gh-mirror --update
gh-mirror --update "MyOrg/RepoName"
gh-mirror --update "Some*Glob*"
```

### Clean up inactive repos

**On by default.** Every run scans the locally-cloned repos and moves any that are
no longer mirroring candidates into a `.removed` folder under the base path
(`<base-path>/.removed/<owner>/<repo>`). A repo is considered inactive when it has
been **archived** on the remote (unless `--include-archived` is passed) or is **no
longer present** in the remote listing at all (deleted, renamed, or transferred).

Nothing is deleted — repos are moved to `.removed` so you can review or restore
them. If an org can't be listed (e.g. auth failure), its repos are left untouched.
Cleaning is scoped to the same target the run operated on, falling back to every
owner in the manifest.

```bash
gh-mirror MyOrg                       # clone + update + clean, scoped to MyOrg
gh-mirror --no-clean-inactive MyOrg   # skip the clean step
gh-mirror --delete-inactive MyOrg     # permanently delete instead of archiving
```

Pass `--delete-inactive` to permanently `rm` inactive repos instead of moving them
to `.removed`. This is irreversible, so the move-to-`.removed` behaviour remains the
default.

### Re-clone broken repos

**On by default.** Clone and update are self-healing: if a repo fails to clone
cleanly, fails to pull, or has diverged, it is removed from disk and cloned fresh
from the remote instead of just reporting the failure.

```bash
gh-mirror MyOrg                          # re-clones broken repos automatically
gh-mirror --no-reclone-on-error MyOrg    # just report failures instead
```

### Options

| Flag | Description |
|------|-------------|
| `--clone [target]` | Clone repositories only |
| `--update [target]` | Pull latest for repositories only |
| `--clean-inactive` | Move archived / removed repos to `.removed` (on by default) |
| `--no-clean-inactive` | Don't move inactive repos to `.removed` |
| `--delete-inactive` | Permanently delete inactive repos instead of archiving |
| `--token <pat>` | GitHub personal access token |
| `--path <path>` | Base path for repos (default: cwd) |
| `--concurrency <n>` | Max parallel git operations (default: 10) |
| `--include-archived` | Include archived repositories (excluded by default) |
| `--timeout <seconds>` | Git operation timeout in seconds (default: 300) |
| `--force`, `-f` | Force update all repos, skipping the `pushed_at` check |
| `--reclone-on-error` | Remove and re-clone repos that fail to clone/pull (on by default) |
| `--no-reclone-on-error` | Report clone/pull failures instead of re-cloning |
| `--help` | Show help |

## Manifest

A `.gh-mirror/manifest.json` file is created in the base path to track configured owners and concurrency settings:

```json
{
  "orgs": ["MyOrg", "some-user"],
  "concurrency": 10
}
```

Running `--clone` without a target uses the manifest to discover and clone any new repos across all tracked owners.

## Concurrency

Git operations (clone/pull) run in parallel. Set the degree of parallelism with `--concurrency`:

```bash
gh-mirror --concurrency 8 --clone MyOrg
```

The concurrency value is saved to the manifest and reused in future runs unless overridden.

## License

MIT
