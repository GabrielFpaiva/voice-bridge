import { describe, expect, it } from 'vitest';
import { buildUserPrompt, ClaudeTranslator } from '../../src/offscreen/translate';

describe('translator', () => {
  it('builds a prompt with context only when there is history', () => {
    expect(buildUserPrompt('tudo bem', [])).toBe('<fragment>tudo bem</fragment>');
    expect(buildUserPrompt('tudo bem', ['oi', 'pessoal'])).toBe(
      '<context>oi pessoal</context>\n<fragment>tudo bem</fragment>',
    );
  });

  it('calls the messages api with the right headers and trims the answer', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: ' Hello there, ' }] }) };
    }) as unknown as typeof fetch;
    const t = new ClaudeTranslator({ apiKey: 'K', model: 'm1', fetchFn: fakeFetch });
    expect(await t.translate('olá pessoal,', ['oi'])).toBe('Hello there,');
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages');
    const h = seen!.init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('K');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(seen!.init.body as string);
    expect(body.model).toBe('m1');
    expect(body.messages[0].content).toContain('<fragment>olá pessoal,</fragment>');
  });

  it('returns an empty string when the answer has no text', async () => {
    const fakeFetch = (async () => ({ ok: true, json: async () => ({ content: [] }) })) as unknown as typeof fetch;
    const t = new ClaudeTranslator({ apiKey: 'K', model: 'm1', fetchFn: fakeFetch });
    expect(await t.translate('x', [])).toBe('');
  });

  it('throws on http errors', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 529 })) as unknown as typeof fetch;
    const t = new ClaudeTranslator({ apiKey: 'K', model: 'm1', fetchFn: fakeFetch });
    await expect(t.translate('x', [])).rejects.toThrow('529');
  });

  it('aborts a hung request instead of waiting forever', async () => {
    let signal: AbortSignal | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return { ok: true, json: async () => ({ content: [] }) };
    }) as unknown as typeof fetch;
    await new ClaudeTranslator({ apiKey: 'K', model: 'm1', fetchFn: fakeFetch }).translate('x', []);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('puts the API error message in the thrown error', async () => {
    const fakeFetch = (async () => ({
      ok: false,
      status: 400,
      json: async () => ({ type: 'error', error: { type: 'invalid_request_error', message: 'credit balance is too low' } }),
    })) as unknown as typeof fetch;
    const t = new ClaudeTranslator({ apiKey: 'K', model: 'm1', fetchFn: fakeFetch });
    await expect(t.translate('x', [])).rejects.toThrow('translate 400: credit balance is too low');
  });
});
