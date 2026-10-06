# Voice Bridge

Extensão do Chrome (uso pessoal) que traduz sua fala PT -> EN no Google Meet, com a sua voz do ElevenLabs.

## Instalar

1. `npm install && npm run build`
2. `chrome://extensions` -> Modo do desenvolvedor -> Carregar sem compactação -> pasta `dist/`
3. Abra as opções da extensão e preencha: chave ElevenLabs, chave Anthropic, ID da voz clonada (inglês).

## Usar

Entre numa reunião do Meet e aperte `Alt+T` (ou clique no ícone). Selo verde `ON` = traduzindo. De novo para desligar.

## Roteiro de teste manual

Precisa de duas janelas/perfis na mesma reunião (você e um "participante").

1. Marco 1 (sem APIs): no console do Meet rode `__vbTest()`. O participante ouve um tom de 2 s. Mudo do Meet silencia tudo.
2. Tradução: `Alt+T`, fale em português. O participante ouve inglês na sua voz e a legenda aparece. Meça o atraso (alvo: 1 a 1,5 s).
3. Desligar: `Alt+T` de novo. O participante volta a ouvir você normal, sem corte na chamada.
4. Falha: com a tradução ligada, desligue o wifi. Selo vermelho `!`, o seu microfone real volta a passar. Religue o wifi: volta sozinho para `ON` em ~3 s.
5. Recarregar a aba do Meet com a tradução ligada: a extensão volta para desligada (selo some).
6. Trocar o microfone nas configurações do Meet: o áudio continua saindo e a luz do microfone antigo apaga.
7. Ficar 3+ minutos calado com a tradução ligada e voltar a falar: continua funcionando (keepalive do TTS).
8. Falar uma frase longa sem pausar: o inglês sai aos pedaços, sem esperar a frase acabar.

## Resultado dos testes manuais

(preencher após rodar: data, atraso medido, o que quebrou)
