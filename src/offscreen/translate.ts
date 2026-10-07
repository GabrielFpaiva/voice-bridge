import type { Translator } from './ports';

const REQUEST_TIMEOUT_MS = 8000;

export const SYSTEM_PROMPT =
  'You are a live interpreter for a video call. Translate the Brazilian Portuguese text inside ' +
  '<fragment> into natural, casual spoken English. Output only the English translation, never ' +
  'explanations. The fragment may be an unfinished sentence: translate it as it is, without ' +
  'completing it. Use <context> only to keep names and terms consistent, and never translate it.';

export function buildUserPrompt(chunk: string, history: string[]): string {
  const ctx = history.length ? `<context>${history.join(' ')}</context>\n` : '';
  return `${ctx}<fragment>${chunk}</fragment>`;
}

export class ClaudeTranslator implements Translator {
  constructor(private cfg: { apiKey: string; model: string; fetchFn?: typeof fetch }) {}

  async translate(chunk: string, history: string[]): Promise<string> {
    const f = this.cfg.fetchFn ?? fetch;
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.cfg.model,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(chunk, history) }],
      }),
    });
    if (!res.ok) {
      let why: string | undefined;
      try {
        why = ((await res.json()) as { error?: { message?: string } }).error?.message;
      } catch {
        // body missing or not JSON: report the status alone
      }
      throw new Error(`translate ${res.status}${why ? `: ${why}` : ''}`);
    }
    const json = (await res.json()) as { content?: { text?: string }[] };
    return (json.content?.[0]?.text ?? '').trim();
  }
}
