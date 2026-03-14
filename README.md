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

### Options

| Flag | Description |
|------|-------------|
| `--clone [target]` | Clone repositories only |
| `--update [target]` | Pull latest for repositories only |
| `--token <pat>` | GitHub personal access token |
| `--path <path>` | Base path for repos (default: cwd) |
| `--concurrency <n>` | Max parallel git operations (default: 10) |
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
