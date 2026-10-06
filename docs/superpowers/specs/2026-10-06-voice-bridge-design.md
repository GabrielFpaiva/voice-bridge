# Voice Bridge — Design

Data: 2026-10-06

## Objetivo

Extensão do Chrome, de uso pessoal, que traduz a fala do Gabriel de português para inglês em tempo real no Google Meet. Os outros participantes ouvem o inglês na voz clonada do Gabriel (já existente no ElevenLabs).

## Escopo

**Dentro:**
- Apenas PT → EN, apenas a fala do Gabriel.
- Apenas Google Meet.
- Uso pessoal: chaves de API guardadas na própria extensão, instalação manual (modo desenvolvedor). Sem backend, login ou cobrança.

**Fora (YAGNI):** EN → PT (ouvir os outros), seletor de idioma, histórico, múltiplas vozes, Zoom/Teams, distribuição na Chrome Web Store.

## Critério de sucesso

- Atraso de aproximadamente 1 a 1,5 s entre o Gabriel falar e o inglês começar a sair. Latência zero não é possível em tradução (o português põe verbo e contexto no fim da frase); a meta é o mínimo viável.
- Um participante de teste no Meet ouve inglês com a voz clonada.
- Desligar a extensão devolve o microfone real sem corte na chamada.

## Arquitetura

Stack: TypeScript, Manifest V3, Vite, Vitest.

### 1. Injeção do microfone (`src/page/`)

Content script com `world: "MAIN"` e `run_at: document_start` substitui `navigator.mediaDevices.getUserMedia`. O Meet recebe um `MediaStream` cuja faixa é a saída de um `MediaStreamAudioDestinationNode` do nosso `AudioContext`.

- **Desligado:** o microfone real (obtido pelo `getUserMedia` original) alimenta a saída direto.
- **Ligado:** o microfone real alimenta só a transcrição; a saída toca o áudio TTS em inglês.
- A faixa entregue ao Meet é sempre a mesma; ligar/desligar só troca a fonte, sem renegociação WebRTC.
- O botão de mudo do Meet continua funcionando, pois age sobre a faixa falsa.
- A página não faz chamadas de rede (a CSP do Meet provavelmente bloqueia `api.elevenlabs.io`). Ela troca PCM com o offscreen document via content script (isolated world) e mensagens.

### 2. Pipeline em streaming (`src/offscreen/`)

Três conexões abertas desde que a extensão é ligada, cada uma em módulo próprio (`stt`, `translate`, `tts`):

1. **STT:** PCM do microfone → ElevenLabs Scribe Realtime → texto parcial.
2. **Tradução:** acumulador fecha um pedaço em pontuação ou ~5 palavras estáveis. O pedaço segue para o Claude Haiku 4.5 junto com as 2–3 frases anteriores como contexto; a resposta vem em streaming.
3. **TTS:** tokens em inglês entram no WebSocket do ElevenLabs TTS (modelo Flash, voz clonada em inglês). O áudio PCM volta em pedaços pequenos para a página.

Regras de atraso:
- Cada etapa começa ao receber o primeiro pedaço da anterior.
- A fila de áudio toca em ritmo normal e acelera (1,1x) se o atraso acumulado passar de ~1 s.
- Se o Gabriel falar de novo com áudio ainda tocando, o inglês novo entra na fila; o que já está saindo não é interrompido.
- Conexões ficam abertas o tempo todo (sem custo de reabrir a cada frase).

Falhas: se qualquer conexão cair, a extensão volta ao modo desligado (microfone real passa direto), sinaliza erro no ícone e tenta reconectar em segundo plano.

### 3. Interface (`src/background/`, `src/options/`)

- **Ícone:** clique liga/desliga. Selo cinza = desligado, verde = traduzindo, vermelho = falha.
- **Atalho:** `Alt+T` liga/desliga.
- **Opções:** chave ElevenLabs, chave Anthropic, ID da voz clonada, modelo de tradução, mostrar/esconder legenda. Chaves em `chrome.storage.local`, nunca expostas à página.
- **Legenda:** texto pequeno sobre o Meet mostrando o inglês que está saindo, para o Gabriel detectar traduções erradas.

### 4. Lógica pura (`src/core/`)

Sem rede e sem API do navegador:
- Acumulador de pedaços (quando fechar um trecho para traduzir).
- Fila de áudio (ritmo e aceleração).
- Máquina de estados: desligado → conectando → traduzindo → falha.

## Testes

- `core/`: test-first com Vitest (acumulador fecha em vírgula e em 5 palavras; fila acelera acima de 1 s; transições de estado).
- Módulos de rede ficam atrás de interfaces; testes usam versões falsas.
- Meet real (troca do microfone, atraso medido): roteiro manual com segunda aba como participante.

## Primeiro marco

Validar o maior risco antes do pipeline completo: o Meet aceita o microfone falso e o áudio em inglês sai com a voz do Gabriel (pode ser com texto fixo, sem STT/tradução).

## Riscos

- O Meet pode mudar a forma de pedir o microfone e quebrar a substituição.
- CSP do Meet: mitigada mantendo toda a rede fora da página.
- Atraso real pode passar da meta; só se mede no Meet de verdade.
- Traduções por pedaço podem sair truncadas; a legenda existe para isso ser visível.
