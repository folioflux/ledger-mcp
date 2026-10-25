# @folioflux/ledger-mcp

Local, read-only MCP server with deterministic finance tools over your own CSV bank exports.

```sh
node dist/cli.js --dir /path/to/exports
```

| Option         | Meaning                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `--dir <path>` | Folder with your CSV exports (required). Only `*.csv` files directly inside it are read. |
| `--help`       | Show help.                                                                               |
| `--version`    | Show the version.                                                                        |

The server speaks MCP over stdio, makes no network requests and never modifies your CSV files. Confirmed column mappings are stored in `<dir>/.ledger-mcp/mappings/`.

See the [main README](../../README.md) for client setup, the tool reference and the security model.

## License

MIT
