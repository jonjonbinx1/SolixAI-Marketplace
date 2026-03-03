---
name: git
version: "1.0.0"
contributor: solix
description: "Perform common Git repository operations: status, add, commit, branch, checkout, merge, push, pull, fetch, log, diff, stash, tag and safe resets."
tags:
  - vcs
  - git
  - developer

inputs:
  - name: goal
    type: string
    required: true
    description: "What to accomplish (e.g. 'commit all changes with message X', 'create branch feature/x and push', 'show last 10 commits')."
  - name: repositoryPath
    type: string
    required: false
    description: "Path to the git repository. Defaults to the workspace root."
  - name: operation
    type: string
    required: false
    description: "Explicit operation to perform. If omitted the skill will infer from `goal`."
  - name: params
    type: object
    required: false
    description: "Operation-specific parameters (e.g. message, branchName, remote)."

outputs:
  result:
    type: object
    description: "Operation-specific result and human-readable summary."
  summary:
    type: string
  nextSteps:
    type: array
    items:
      type: string
    nullable: true

verify: []

config:
  - key: defaultRepositoryPath
    label: Default Repository Path
    type: string
    default: "."
    description: "Path used when `repositoryPath` is not provided."

  - key: allowedOperations
    label: Allowed Operations
    type: multiselect
    options:
      - status
      - add
      - commit
      - push
      - pull
      - fetch
      - branch
      - checkout
      - merge
      - rebase
      - log
      - diff
      - stash
      - tag
      - reset
      - revert
    default:
      - status
      - add
      - commit
      - push
      - pull
      - branch
      - checkout
      - log
      - diff
    description: "Controls which git operations this skill is permitted to perform. Keep destructive ops (reset/revert/force-push) disabled unless explicitly allowed."

  - key: requireConfirmationForDestructiveOps
    label: Require Confirmation For Destructive Ops
    type: boolean
    default: true
    description: "When true, the agent will ask for explicit user confirmation before performing destructive operations such as force-push, reset --hard, or branch deletion."

  - key: defaultRemote
    label: Default Remote
    type: string
    default: "origin"
    description: "Default remote name to use for push/pull operations."

---

# Git

Use this skill to perform repository operations in a safe, auditable way. The skill must only call operations listed in `allowedOperations`; if a requested operation is not permitted the agent should inform the user and request configuration changes.

## Principles

- Safety first: Prompt for confirmation before any destructive action (`reset --hard`, `push --force`, `branch -D`, `revert`), unless `requireConfirmationForDestructiveOps` is false and the user explicitly allowed the operation.
- Least privilege: Only perform operations in `allowedOperations`.
- Explicit context: Always resolve `repositoryPath` before running commands, and refuse to act if the path is not a git repository.
- Auditability: Return both machine-readable results and a short human summary describing what was done.

## Supported operations (examples)

- `status` — show `git status --porcelain` and a human summary of staged/unstaged/untracked files.
- `add` — stage files. Params: `paths` (array) or `paths: ["."]` to add all.
- `commit` — create a commit. Params: `message`, `author` (optional), `sign` (optional).
- `push` — push to remote. Params: `remote` (default `defaultRemote`), `branch`, `force` (boolean).
- `pull` — pull from remote. Params: `remote`, `branch`, `rebase` (boolean).
- `fetch` — fetch updates.
- `branch` — create/list/delete branches. Params for create: `name`, `startPoint`.
- `checkout` — switch branches or restore files. Params: `branch`, `paths`.
- `merge` — merge a branch into current. Params: `source`, `noFastForward`.
- `rebase` — rebase current branch onto another. Use carefully.
- `log` — show commits. Params: `maxCount`, `format`.
- `diff` — show diffs. Params: `paths`, `commitRange`.
- `stash` — push/pop/list stashes.
- `tag` — create/list/delete tags.
- `reset` — soft/mixed/hard reset. Destructive when `--hard`.
- `revert` — create a revert commit for a specified commit.

## Process

1. Parse `goal` to determine the operation and parameters.
2. Verify the requested operation exists in `allowedOperations`.
3. Resolve `repositoryPath` (use `defaultRepositoryPath` if unset) and ensure it contains a git repository.
4. If operation is destructive and `requireConfirmationForDestructiveOps` is true, present a short explanation and ask for confirmation before proceeding.
5. Run the operation using a safe runtime helper (prefer a `git` tool or the `shell` tool exposed by the runtime). Capture stdout/stderr and exit code.
6. Return `result` with relevant fields (e.g. commit id, branch name, pushed refs) and `summary` explaining the outcome.

## Examples

- Commit staged changes with message:

```
Goal: "Commit staged changes with message 'Fix validation bug'"
Operation: commit
Params: { "message": "Fix validation bug" }
```

- Create and push a branch:

```
Goal: "Create branch feature/auth and push to remote"
Operation: branch
Params: { "name": "feature/auth", "startPoint": "main" }
Then: push with params { "branch": "feature/auth" }
```

- Show last 5 commits:

```
Operation: log
Params: { "maxCount": 5 }
```

## Safety notes

- Never expose secret credentials or tokens in command outputs. If the runtime returns environment or config values, redact secrets before returning them.
- Avoid running repository-altering commands on the wrong path — always confirm the repo root and current branch before destructive operations.
- If a command fails with merge conflicts, return the conflict details and suggest next steps rather than attempting automatic resolution.

## Integration guidance

- The runtime should expose a `git` tool or `shell` tool to execute commands. Prefer a language-native git library when available for parseable results.
- Map skill `allowedOperations` to tool-level permission gates where possible.

