export interface Diagnosis {
  fatal: boolean;
  message: string;
}

const MAX_RAW = 50;

export function diagnose(err: Error): Diagnosis {
  const m = err.message;
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
