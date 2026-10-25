## What changed

<!-- A short description of the change and why it is needed. -->

## How to test

<!-- Commands or steps a reviewer can run. -->

## Checklist

- [ ] `pnpm check` passes locally
- [ ] Tests cover the change (including determinism, if output changed)
- [ ] Golden files updated with `pnpm golden:update` only when the output change is intended
- [ ] Sample data is synthetic: no real bank exports, names or account numbers
- [ ] The server is still local and read-only (no network access, no writes outside `.ledger-mcp/`)
- [ ] CHANGELOG.md updated for user-visible changes
