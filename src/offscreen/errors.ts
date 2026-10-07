export interface Diagnosis {
  fatal: boolean;
  message: string;
}

const MAX_RAW = 50;

export function diagnose(err: Error): Diagnosis {
  const m = err.message;
  if (/api key id used/i.test(m)) {
    return { fatal: true, message: 'Isso é o ID da chave, não a chave. Use a que começa com sk_.' };
  }
  if (/^translate (401|403)/.test(m)) return { fatal: true, message: 'Chave da Anthropic inválida.' };
  if (/invalid api key|invalid_api_key|authenticated|unauthorized|^stt token (400|401|403)/i.test(m)) {
    return { fatal: true, message: 'Chave do ElevenLabs inválida.' };
  }
  if (/voice.*not.?found|voice_not_found|invalid_voice/i.test(m)) {
    return { fatal: true, message: 'ID da voz não encontrado.' };
  }
  if (/quota|credits/i.test(m)) return { fatal: true, message: 'Créditos do ElevenLabs acabaram.' };
  const raw = m.length > MAX_RAW ? `${m.slice(0, MAX_RAW)}…` : m;
  return { fatal: false, message: `Conexão caiu: ${raw}` };
}

export function describeFailure(err: Error, keys: { elevenKey: string; anthropicKey: string }): string {
  const d = diagnose(err);
  if (!d.fatal) return d.message;
  const key = err.message.startsWith('translate') ? keys.anthropicKey : keys.elevenKey;
  return `${d.message} (${err.message.slice(0, 40)} · chave …${key.slice(-4)})`;
}
