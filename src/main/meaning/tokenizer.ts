// Turns text into the word pieces the meaning model was trained on (BERT "WordPiece", lowercase).
// "StreamEast.zip" -> [CLS] stream ##east . zip [SEP] -> numbers from vocab.txt.

const CLS = '[CLS]';
const SEP = '[SEP]';
const UNK = '[UNK]';
const MAX_WORD_CHARS = 100;

function isPunctuation(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) return true;
  return /\p{P}/u.test(ch);
}

function isCjk(c: number): boolean {
  return (
    (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x20000 && c <= 0x2a6df) || (c >= 0x2a700 && c <= 0x2b73f) ||
    (c >= 0x2b740 && c <= 0x2b81f) || (c >= 0x2b820 && c <= 0x2ceaf) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0x2f800 && c <= 0x2fa1f)
  );
}

/** Lowercase, strip accents, drop control characters, and split into words and punctuation. */
export function basicTokens(text: string): string[] {
  let clean = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 0 || c === 0xfffd || (/\p{C}/u.test(ch) && !/[\t\n\r]/.test(ch))) continue;
    if (/\s/u.test(ch)) clean += ' ';
    else if (isCjk(c)) clean += ` ${ch} `;
    else clean += ch;
  }
  clean = clean.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
  const out: string[] = [];
  for (const word of clean.split(' ')) {
    let cur = '';
    for (const ch of word) {
      if (isPunctuation(ch)) {
        if (cur) out.push(cur);
        out.push(ch);
        cur = '';
      } else cur += ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}

export class WordPiece {
  private readonly ids = new Map<string, number>();

  constructor(vocabText: string) {
    vocabText.split('\n').forEach((w, i) => {
      if (w) this.ids.set(w, i);
    });
    for (const t of [CLS, SEP, UNK]) if (!this.ids.has(t)) throw new Error(`vocab is missing ${t}`);
  }

  private pieces(word: string): string[] {
    const chars = [...word];
    if (chars.length > MAX_WORD_CHARS) return [UNK];
    const out: string[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: string | null = null;
      while (start < end) {
        const sub = (start > 0 ? '##' : '') + chars.slice(start, end).join('');
        if (this.ids.has(sub)) {
          found = sub;
          break;
        }
        end--;
      }
      if (!found) return [UNK];
      out.push(found);
      start = end;
    }
    return out;
  }

  /** Token ids with [CLS] and [SEP], cut to at most `max` ids. */
  encode(text: string, max = 64): number[] {
    const pieces = basicTokens(text).flatMap((w) => this.pieces(w)).slice(0, max - 2);
    return [CLS, ...pieces, SEP].map((p) => this.ids.get(p)!);
  }
}
