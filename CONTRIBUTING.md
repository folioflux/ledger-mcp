# Contributing to ledger-mcp

Thanks for your interest in improving ledger-mcp. Bug reports, small fixes and focused improvements are welcome.

## Scope

ledger-mcp is deliberately small: a local, read-only MCP server that answers questions about CSV bank exports with deterministic, row-cited numbers. Please keep changes in that spirit. Larger ideas are best discussed in an issue first.

## Ground rules

- Be kind and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Use synthetic data only. Never commit real bank, personal or financial data, or secrets.
- Keep the server local and read-only: no network access, and no writes outside `.ledger-mcp/`.
- Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 22.12 or later and pnpm (the version is pinned in `package.json`; `corepack enable` installs it).

```sh
git clone https://github.com/folioflux/ledger-mcp.git
cd ledger-mcp
pnpm install
pnpm check
```

Useful scripts:

| Script               | What it does                                                |
| -------------------- | ----------------------------------------------------------- |
| `pnpm build`         | Build every package                                         |
| `pnpm lint`          | ESLint                                                      |
| `pnpm format`        | Format with Prettier (`format:check` only checks)           |
| `pnpm typecheck`     | Build and typecheck, including tests                        |
| `pnpm test`          | Vitest (the stdio test needs a prior build)                 |
| `pnpm golden:update` | Rewrite `fixtures/expected` after an intended output change |
| `pnpm demo`          | Scripted MCP session against the built server               |
| `pnpm check`         | Format check, lint, typecheck and tests                     |

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change with tests. Keep pull requests small and focused.
3. Run `pnpm check` and `pnpm demo`.
4. Update the README and `CHANGELOG.md` when behaviour changes.
5. Open a pull request and fill in the template.

Pull requests are squash-merged once CI passes and a maintainer has reviewed them.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
