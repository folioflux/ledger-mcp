import { lstat, mkdir, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CsvInput, FileFailure, ImportResult, Ledger, Mapping } from '@folioflux/ledger-core';
import {
  compareStrings,
  createLedger,
  importCsv,
  LedgerError,
  parseMapping,
  readCsvHead,
  sha256Hex,
} from '@folioflux/ledger-core';

/** Folder (inside the exports folder) where confirmed mappings are stored. */
export const MAPPINGS_DIR = path.join('.ledger-mcp', 'mappings');

/** Largest CSV file that will be read, in bytes. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Most CSV files read from one exports folder. */
export const MAX_FILES = 1000;

const CSV_NAME = /^[^/\\\0]+\.csv$/i;

/**
 * The exports folder. All file access goes through this class: it only reads
 * plain *.csv files directly inside the folder (no subfolders, no symlinks,
 * no paths) and only writes mapping files under .ledger-mcp/mappings/.
 */
export class Workspace {
  private constructor(readonly dir: string) {}

  /** Opens an exports folder. The path is resolved once, so later changes to symlinks do not matter. */
  static async open(dir: string): Promise<Workspace> {
    let resolved: string;
    try {
      resolved = await realpath(path.resolve(dir));
    } catch {
      throw new LedgerError('NOT_FOUND', `Exports folder not found: ${dir}`);
    }
    const stat = await lstat(resolved);
    if (!stat.isDirectory()) {
      throw new LedgerError('INVALID_ARGUMENT', `Not a folder: ${dir}`);
    }
    return new Workspace(resolved);
  }

  /** Names of the CSV files directly inside the folder, sorted by UTF-16 code units. */
  async listCsvFiles(): Promise<string[]> {
    const entries = await readdir(this.dir, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile() && CSV_NAME.test(entry.name) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort(compareStrings);
    if (names.length > MAX_FILES) {
      throw new LedgerError(
        'INVALID_ARGUMENT',
        `The exports folder has more than ${MAX_FILES} CSV files.`,
      );
    }
    return names;
  }

  /**
   * Reads one CSV file by its plain file name. Rejects anything that is not a
   * regular *.csv file directly inside the folder.
   */
  async readCsv(name: string): Promise<CsvInput> {
    if (!CSV_NAME.test(name) || name.startsWith('.') || name !== path.basename(name)) {
      throw new LedgerError(
        'INVALID_ARGUMENT',
        `"${name}" is not allowed. Use the plain name of a .csv file directly inside the exports folder (see list_transactions → files).`,
      );
    }
    const full = path.join(this.dir, name);
    if (path.dirname(full) !== this.dir) {
      throw new LedgerError('INVALID_ARGUMENT', `"${name}" is outside the exports folder.`);
    }
    let stat;
    try {
      stat = await lstat(full);
    } catch {
      throw new LedgerError('NOT_FOUND', `No file named "${name}" in the exports folder.`);
    }
    if (!stat.isFile()) {
      throw new LedgerError(
        'INVALID_ARGUMENT',
        `"${name}" is not a regular file (symlinks are not followed).`,
      );
    }
    if (stat.size > MAX_FILE_BYTES) {
      throw new LedgerError(
        'INVALID_ARGUMENT',
        `"${name}" is larger than ${MAX_FILE_BYTES} bytes.`,
      );
    }
    return { name, bytes: new Uint8Array(await readFile(full)) };
  }

  private mappingPath(headerSha256: string): string {
    return path.join(this.dir, MAPPINGS_DIR, `${headerSha256}.json`);
  }

  /** Relative path (with forward slashes) of the mapping file for a header hash. */
  mappingRelativePath(headerSha256: string): string {
    return `.ledger-mcp/mappings/${headerSha256}.json`;
  }

  /** Loads the saved mapping for a header hash, or null if there is none. Throws if the file is invalid. */
  async loadMapping(headerSha256: string): Promise<Mapping | null> {
    let text: string;
    try {
      const file = this.mappingPath(headerSha256);
      const stat = await lstat(file);
      if (!stat.isFile()) return null;
      text = await readFile(file, 'utf8');
    } catch {
      return null;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new LedgerError(
        'INVALID_MAPPING',
        `${this.mappingRelativePath(headerSha256)} is not valid JSON.`,
      );
    }
    try {
      const mapping = parseMapping(value);
      if (mapping.header_sha256 !== headerSha256) {
        throw new LedgerError('INVALID_MAPPING', 'header_sha256 does not match the file name.');
      }
      return mapping;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new LedgerError(
        'INVALID_MAPPING',
        `${this.mappingRelativePath(headerSha256)}: ${reason}`,
      );
    }
  }

  /** All valid saved mappings, sorted by header hash. Invalid files are skipped here. */
  private async savedMappings(): Promise<Mapping[]> {
    let names: string[];
    try {
      names = await readdir(path.join(this.dir, MAPPINGS_DIR));
    } catch {
      return [];
    }
    const mappings: Mapping[] = [];
    for (const name of names.sort(compareStrings)) {
      const match = /^([0-9a-f]{64})\.json$/.exec(name);
      if (!match?.[1]) continue;
      try {
        const mapping = await this.loadMapping(match[1]);
        if (mapping) mappings.push(mapping);
      } catch {
        // Reported when a file with that header is imported.
      }
    }
    return mappings;
  }

  /**
   * Writes a confirmed mapping to .ledger-mcp/mappings/<header_sha256>.json.
   * This is the only write the server ever makes. Returns the relative path.
   */
  async saveMapping(mapping: Mapping): Promise<string> {
    const folder = path.join(this.dir, MAPPINGS_DIR);
    await mkdir(folder, { recursive: true });
    const target = this.mappingPath(mapping.header_sha256);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(mapping, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
    await rename(temp, target);
    return this.mappingRelativePath(mapping.header_sha256);
  }

  /** Finds the saved mapping that applies to a file, if any. */
  async findMappingFor(input: CsvInput): Promise<Mapping | null> {
    const head = readCsvHead(input);
    if (head.header_sha256 !== null) {
      const direct = await this.loadMapping(head.header_sha256);
      if (direct) return direct;
    }
    // A mapping saved with a non-default delimiter or encoding hashes a header
    // that only appears when the file is read with those settings.
    for (const mapping of await this.savedMappings()) {
      if (mapping.delimiter === head.delimiter && mapping.encoding === head.encoding) continue;
      try {
        const other = readCsvHead(input, {
          delimiter: mapping.delimiter,
          encoding: mapping.encoding,
        });
        if (other.header_sha256 === mapping.header_sha256) return mapping;
      } catch {
        // Not readable with these settings.
      }
    }
    return null;
  }

  /**
   * Reads every CSV file in the folder into a ledger. Files that need a mapping
   * or cannot be parsed are listed in the result instead of failing the call.
   */
  async loadLedger(): Promise<Ledger> {
    const results: ImportResult[] = [];
    const failures: FileFailure[] = [];
    for (const name of await this.listCsvFiles()) {
      let input: CsvInput | null = null;
      try {
        input = await this.readCsv(name);
        const saved = await this.findMappingFor(input);
        results.push(importCsv(input, { saved }));
      } catch (error) {
        if (!(error instanceof LedgerError)) throw error;
        failures.push({
          file: name,
          source_sha256: input ? sha256Hex(input.bytes) : null,
          message: error.message,
        });
      }
    }
    return createLedger(results, failures);
  }
}
