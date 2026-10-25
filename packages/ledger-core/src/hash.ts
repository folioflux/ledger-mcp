import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const encoder = new TextEncoder();

/** SHA-256 of bytes or of the UTF-8 encoding of a string, as lower-case hex. */
export function sha256Hex(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  return bytesToHex(sha256(bytes));
}

/** A JSON value that canonicalJson accepts. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

/**
 * Serializes a JSON value with object keys sorted by UTF-16 code units and no
 * insignificant whitespace, so equal values always produce identical bytes.
 * Object members whose value is undefined are omitted.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('canonicalJson: non-finite numbers are not valid JSON');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: JsonValue) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as { readonly [key: string]: JsonValue | undefined };
  const keys = Object.keys(record).sort(compareStrings);
  const members: string[] = [];
  for (const key of keys) {
    const member = record[key];
    if (member !== undefined) {
      members.push(`${JSON.stringify(key)}:${canonicalJson(member)}`);
    }
  }
  return `{${members.join(',')}}`;
}

/** Locale-independent string comparison by UTF-16 code units. */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Encodes a string's UTF-8 bytes as unpadded base64url. */
export function toBase64Url(text: string): string {
  const bytes = encoder.encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const chunk = (b0 << 16) | (b1 << 8) | b2;
    const remaining = bytes.length - i;
    out += BASE64URL.charAt((chunk >> 18) & 63);
    out += BASE64URL.charAt((chunk >> 12) & 63);
    if (remaining > 1) out += BASE64URL.charAt((chunk >> 6) & 63);
    if (remaining > 2) out += BASE64URL.charAt(chunk & 63);
  }
  return out;
}

/** Decodes unpadded base64url into a UTF-8 string. Returns null if malformed. */
export function fromBase64Url(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded) || encoded.length % 4 === 1) {
    return null;
  }
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of encoded) {
    buffer = (buffer << 6) | BASE64URL.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}
