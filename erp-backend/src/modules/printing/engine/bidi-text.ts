import bidiFactory = require('bidi-js');

/**
 * Right-to-left support for PDFKit.
 *
 * Shaping: PDFKit lays text out with fontkit, which applies the font's
 * OpenType Arabic features (init/medi/fina/isol, rlig lam-alef ligatures,
 * mark positioning) to every space-separated word, and reverses the glyphs of
 * a word whose first strong script is right-to-left. That gives correctly
 * joined Arabic words, but PDFKit keeps the *words* (and digits, Latin text)
 * in logical order, so a sentence comes out backwards.
 *
 * Ordering: this helper runs the Unicode Bidirectional Algorithm (bidi-js)
 * over a line and returns "visual chunks": pieces to be drawn left-to-right
 * one after the other. Each chunk is a single word or run of the same
 * embedding level, given in the character order PDFKit must receive so that,
 * after fontkit's own reversal of RTL words, the glyphs end up in visual
 * order. Arabic letters are always handed over in logical order so fontkit
 * can shape them; mirrored characters (brackets) are substituted.
 */

const bidi = bidiFactory();

export type Direction = 'rtl' | 'ltr';

export interface VisualChunk {
  /** Text to hand to PDFKit as is. */
  text: string;
  /** Embedding level is odd (right-to-left run). */
  rtl: boolean;
  /** Whitespace-only chunk. */
  space: boolean;
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const NEUTRAL_SCRIPT_RE = /[\p{Script=Common}\p{Script=Inherited}]/u;
const RTL_SCRIPT_RE = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const SPACE_RE = /\s/;
/** Bidi isolate / embedding controls: used for ordering, never drawn. */
const ISOLATES_RE = /[\u2066-\u2069\u202A-\u202E\u200E\u200F]/g;

/**
 * Wraps a value (date, number, code) in a left-to-right isolate so it keeps
 * its natural order inside Arabic text (e.g. 2026-10-08 after an Arabic word
 * would otherwise be shown as 08-10-2026 per the bidi rules).
 */
export function ltr(value: unknown): string {
  return `\u2066${value ?? ''}\u2069`;
}

/** True when the text contains Arabic letters. */
export function hasArabic(text: string | null | undefined): boolean {
  return !!text && ARABIC_RE.test(text);
}

/**
 * Mirrors fontkit's direction detection: the first character whose script is
 * not Common/Inherited decides; right-to-left scripts are reversed by fontkit.
 */
export function fontkitReverses(text: string): boolean {
  for (const ch of text) {
    if (NEUTRAL_SCRIPT_RE.test(ch)) continue;
    return RTL_SCRIPT_RE.test(ch);
  }
  return false;
}

const reverse = (s: string) => Array.from(s).reverse().join('');

/**
 * Splits one line (no line breaks) into visual chunks, left to right.
 * `base` is the paragraph direction (rtl for Arabic documents).
 */
export function visualChunks(line: string, base: Direction): VisualChunk[] {
  if (!line) return [];
  const text = line.replace(/[\r\n\t]+/g, ' ');
  const embedding = bidi.getEmbeddingLevels(text, base);
  const levels = embedding.levels;
  const mirrored = bidi.getMirroredCharactersMap(text, embedding.levels);

  // Visual order of the logical indices.
  const order = Array.from({ length: text.length }, (_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(text, embedding)) {
    const part = order.slice(start, end + 1).reverse();
    order.splice(start, part.length, ...part);
  }

  // Group consecutive visual positions that belong to the same run and word.
  const groups: number[][] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
  };
  for (const idx of order) {
    const ch = text[idx];
    const isSpace = SPACE_RE.test(ch);
    if (current.length) {
      const prev = current[current.length - 1];
      const prevSpace = SPACE_RE.test(text[prev]);
      const odd = levels[prev] % 2 === 1;
      const adjacent = odd ? prev - idx === 1 : idx - prev === 1;
      if (isSpace !== prevSpace || levels[prev] !== levels[idx] || !adjacent) flush();
    }
    current.push(idx);
  }
  flush();

  return groups
    .map((g) => {
      const rtl = levels[g[0]] % 2 === 1;
      const sorted = [...g].sort((a, b) => a - b);
      // Bidi mirroring (brackets) applies to RTL runs; fontkit does not mirror.
      const logical = sorted
        .map((i) => (rtl ? mirrored.get(i) ?? text[i] : text[i]))
        .join('')
        .replace(ISOLATES_RE, '');
      const space = SPACE_RE.test(text[g[0]]);
      // Desired visual order: rtl -> reversed logical, ltr -> logical.
      // fontkit reverses RTL-script words itself (keeping Arabic shaping in
      // logical order), so pass the logical text whenever fontkit flips it.
      const flips = fontkitReverses(logical);
      return { text: rtl === flips ? logical : reverse(logical), rtl, space };
    })
    .filter((c) => c.text.length > 0);
}

/**
 * Plain visual string (for tests and diagnostics): what a reader sees from
 * left to right, Arabic letters unshaped.
 */
export function visualString(line: string, base: Direction): string {
  return visualChunks(line, base)
    .map((c) => (fontkitReverses(c.text) ? reverse(c.text) : c.text))
    .join('');
}

/** Paragraph direction for a text given the document language. */
export function baseDirection(lang: 'ar' | 'en'): Direction {
  return lang === 'ar' ? 'rtl' : 'ltr';
}
