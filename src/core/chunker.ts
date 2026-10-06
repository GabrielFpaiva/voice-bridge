const MAX_WORDS = 5;
const MIN_WORDS_AT_COMMA = 2;
const SENTENCE_END = /[.!?…]$/;
const SOFT_BREAK = /[,;:]$/;

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export class Chunker {
  private emitted = 0;

  push(partial: string): string[] {
    const all = words(partial);
    const stable = all.slice(0, -1);
    const out: string[] = [];
    let start = this.emitted;
    for (let i = start; i < stable.length; i++) {
      const size = i - start + 1;
      const w = stable[i];
      const closes =
        SENTENCE_END.test(w) || (SOFT_BREAK.test(w) && size >= MIN_WORDS_AT_COMMA) || size >= MAX_WORDS;
      if (closes) {
        out.push(stable.slice(start, i + 1).join(' '));
        start = i + 1;
      }
    }
    this.emitted = start;
    return out;
  }

  commit(final: string): string[] {
    const rest = words(final).slice(this.emitted);
    this.emitted = 0;
    return rest.length ? [rest.join(' ')] : [];
  }
}
