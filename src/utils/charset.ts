/**
 * Character encoding detection utilities for HTML text
 * Based on the Haskell implementation from https://github.com/dahlia/html-charset/tree/main
 */

import jschardet from "jschardet";

export type EncodingName =
  | "UTF-8"
  | "UTF-16LE"
  | "UTF-16BE"
  | "UTF-32BE"
  | "UTF-32LE"
  | "GB-18030"
  | "ISO-8859-1"
  | "UTF-7"
  | "ASCII"
  | (string & {});

/**
 * Detect the character encoding from a given HTML fragment.
 * The precedence order for determining the character encoding is:
 * 1. A BOM (byte order mark) before any other data in the HTML document
 * 2. A <meta> declaration with a charset attribute or an http-equiv attribute
 *    set to Content-Type and a value set for charset (only first 1024 bytes)
 * 3. Charset detection heuristics (using jschardet)
 *
 * @param fragment - The HTML fragment as Uint8Array
 * @returns The detected encoding name or null if not detected
 */
export function detect(fragment: Uint8Array | null): EncodingName | null {
  if (!fragment) {
    return null;
  }
  // Try BOM detection first
  const bomResult = detectBom(fragment);
  if (bomResult) {
    return bomResult;
  }

  // Try meta charset detection (only first 1024 bytes)
  const metaResult = detectMetaCharset(
    fragment.subarray(0, Math.min(1024, fragment.length)),
  );
  if (metaResult) {
    return metaResult;
  }

  // Fall back to charset detection heuristics
  return detectEncodingName(fragment);
}

/**
 * Detect the character encoding from a BOM (byte order mark)
 *
 * @param fragment - The HTML fragment as Uint8Array
 * @returns The detected encoding name or null if no valid BOM found
 */
export function detectBom(fragment: Uint8Array): EncodingName | null {
  if (fragment.length < 2) {
    return null;
  }

  const firstTwo = fragment.subarray(0, 2);

  // UTF-16BE: FE FF
  if (firstTwo[0] === 0xfe && firstTwo[1] === 0xff) {
    return "UTF-16BE";
  }

  // UTF-8: EF BB BF
  if (firstTwo[0] === 0xef && firstTwo[1] === 0xbb) {
    if (fragment.length >= 3 && fragment[2] === 0xbf) {
      return "UTF-8";
    }
    return null;
  }

  // UTF-32BE: 00 00 FE FF
  if (firstTwo[0] === 0x00 && firstTwo[1] === 0x00) {
    if (fragment.length >= 4 && fragment[2] === 0xfe && fragment[3] === 0xff) {
      return "UTF-32BE";
    }
    return null;
  }

  // UTF-16LE: FF FE
  if (firstTwo[0] === 0xff && firstTwo[1] === 0xfe) {
    // Check if this might be UTF-32LE: FF FE 00 00
    if (fragment.length >= 4 && fragment[2] === 0x00 && fragment[3] === 0x00) {
      return "UTF-32LE";
    }
    return "UTF-16LE";
  }

  // GB-18030: 84 31 95 33
  if (firstTwo[0] === 0x84 && firstTwo[1] === 0x31) {
    if (fragment.length >= 4 && fragment[2] === 0x95 && fragment[3] === 0x33) {
      return "GB-18030";
    }
    return null;
  }

  return null;
}

/**
 * Detect the character encoding from meta charset declarations in HTML
 *
 * @param fragment - The HTML fragment as Uint8Array (first 1024 bytes)
 * @returns The detected encoding name or null if no meta charset found
 */
function detectMetaCharset(fragment: Uint8Array): EncodingName | null {
  const text = new TextDecoder("latin1").decode(fragment);

  // Look for meta charset attribute
  const charsetMatch = text.match(
    /<meta[^>]*charset\s*=\s*["']?([^"'\s>/]+)["']?[^>]*>/i,
  );
  if (charsetMatch?.[1]) {
    return charsetMatch[1].toUpperCase() as EncodingName;
  }

  // Look for meta http-equiv with charset in content
  const httpEquivMatch = text.match(
    /<meta[^>]*http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["']?[^"']*charset\s*=\s*([^"'\s>/;]+)[^>]*>/i,
  );
  if (httpEquivMatch?.[1]) {
    return httpEquivMatch[1].toUpperCase() as EncodingName;
  }

  return null;
}

/**
 * Detect encoding using jschardet heuristics
 *
 * @param fragment - The HTML fragment as Uint8Array
 * @returns The detected encoding name or null if not detected
 */
function detectEncodingName(fragment: Uint8Array): EncodingName | null {
  try {
    const text = new TextDecoder("latin1").decode(fragment);
    const result = jschardet.detect(text);
    if (result.confidence > 0.5 && result.encoding) {
      // Normalize common encoding names
      const encoding = result.encoding.toUpperCase();
      if (encoding === "ascii") return "ISO-8859-1";
      if (encoding === "windows-1252") return "ISO-8859-1";
      return encoding;
    }
  } catch (error) {
    console.warn("Charset detection failed:", error);
    return null;
  }
  return null;
}
