// Minimal declarations for the WHATWG encoding API, which is available in Node.js,
// browsers and other modern runtimes. Declared here so the core package does not
// depend on Node.js or DOM type definitions.

interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

declare class TextDecoder {
  constructor(label?: string, options?: TextDecoderOptions);
  readonly encoding: string;
  decode(input?: Uint8Array): string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
