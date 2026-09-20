# Joias Findom V30

Protótipo match-3 responsivo para celular, tablet e desktop.

## V30 — polimento e performance

- Recompensas numéricas usam feixes curvos de luz, com sete segmentos por feixe e um único `requestAnimationFrame`. As parcelas chegam ao acumulador do destino; o placar principal recebe a soma ao terminar a jogada. Pontos/dinheiro partem após a quebra de cada etapa; tempo/movimentos também acumulam sem antecipar sua aplicação real. A última chegada leva 560ms, seguida de 160ms até começar a fusão. Nada disso bloqueia a resolução do tabuleiro. Coroa e ataques mantêm seus feedbacks específicos.
- Tabuleiros reconciliam as peças por ID, preservando DOM, seleção e animações ociosas. Somente peças novas/alteradas são criadas. Animações finitas são liberadas depois da queda; leituras de geometria de fusão/raios acontecem antes das escritas. HUD não reescreve texto/atributos idênticos.
- Medição em Edge headless, viewport 390×844 e CPU simulada 4× mais lenta: 100 renders idênticos do HUD passaram de **1.900 mutações para zero**; 20 renders do mesmo tabuleiro passaram de **1.280 nós adicionados e nenhuma peça reutilizada para zero nós adicionados e 64 peças reutilizadas**. O tempo da operação do tabuleiro caiu de aproximadamente 54ms para 10ms nessa medição. São medidas do trabalho de DOM, não uma promessa de FPS em aparelhos físicos. Reproduzir com `node tests/profile.cjs`.
- `gems.svg` mantém as seis formas/cores reconhecíveis com luz, volume, reflexos e facetas consistentes, independente da fonte de emoji do aparelho. Mesmo SVG e efeitos em celular/tablet/desktop, sem perfil visual simplificado. Glow e efeitos permanecem; reflexo difuso usa gradiente em vez de um filtro por peça, sem forçar camadas de composição permanentes para as 128 peças. Só animações ociosas fora da tela/aba oculta são pausadas.
- **Convidar jogador** abre o compartilhamento nativo com “Vem jogar Joias Findom comigo!” e o link da sala. Sem Web Share (ou caso falhe), copia o link; cancelar o painel nativo não copia nem abre outro diálogo. Se a área de transferência estiver indisponível, oferece cópia manual. O link não inclui assento ou Dev Tools. Conexões simultâneas ao lobby compartilham a mesma assinatura.
- Menu com títulos curtos, resumo compacto e regras completas acessíveis em “Bônus e regras”. Cache PWA `joias-findom-v30-polish` inclui as joias vetoriais e os áudios atuais.
- Verificação: `node --test tests/hud-rewards.cjs tests/polish.cjs` com Playwright instalado (`BROWSER_CHANNEL=msedge` para Edge). Cobertura de regras, voos/feixes, acumulação, reinício, áudio, Dev Tools, snapshots online simulados, compartilhamento com APIs simuladas, PWA offline e viewports 320/390/768/1024/1440px. Não envia convites nem usa salas reais do Firebase nos testes.

## V29 — pausa alinhada à fala

- Extra Move reproduz até 1,35s do áudio original, preservando a fala (~1,2s) e sua cauda. Retirada somente a sobra silenciosa do fim. Pausa de aproximadamente 1,43s, incluindo os 80ms de preparação do áudio, em vez de 1,96s. Sem alterar velocidade, início da palavra, recompensas ou animações de queda.
- Cache PWA `joias-findom-v29-shorter-move-pause`.

## V28 — dois tiques originais

- Relógio toca os primeiros 2,1s: inclui os dois tiques principais do arquivo (~0,7s e ~1,7s) e termina antes do terceiro (~2,7s). Volume, velocidade e envelope originais preservados, sem loop. Cache PWA `joias-findom-v28-two-ticks`.

## V27 — relógio original

- Relógio reproduz o MP3 original inteiro (aproximadamente 7,7s), em velocidade 1× e ganho 1, sem envelope de fade adicional nem loop. O arquivo foi conferido por SHA-256 contra o anexo original. Rival mantém o volume relativo de 35% e as prioridades do mixer continuam.
- Cache PWA `joias-findom-v27-original-clock`.

## V26 — tiques do relógio

- O som de ativação do congelamento passou de 1,25s para 3,2s, permitindo ouvir mais tiques. Volume baixo, fade final e ausência de loop preservados. Cache PWA `joias-findom-v26-clock-ticks`.

## V25 — destaque sem caixa e voz integral

- Removida a caixa sobre o tabuleiro durante a criação de especiais. Pausa, contornos nas peças, som por criação e voo acumulado ao HUD continuam.
- Extra Move começa do primeiro sample, com volume integral e 80ms de antecedência para preparar a saída e reduzir os sons comuns. Não usa fade de entrada/saída; outros poderes aguardam a palavra terminar em vez de interrompê-la. Sair/reiniciar ainda cancela o áudio normalmente.
- Cache PWA `joias-findom-v25-clean-voice`. Testes verificam ausência da caixa, pausas, anúncios distintos e voz sem interrupção por ataques.

## V24 — pausa na conquista do especial

- Cada criação confirmada de seta, bomba ou Arco-íris destaca sua combinação antes da fusão/quebra/queda. O aviso fica na metade oposta do tabuleiro para deixar as peças de origem visíveis.
- Em Turnos, cada especial anuncia `EXTRA MOVE!` e `+1 MOV.` com a voz. A pausa parte de 1,5s e acompanha a duração do áudio já carregado, limitada a 2,2s. Duas criações recebem dois anúncios distintos, inclusive na mesma etapa; o total acumulado continua voando ao HUD no fim, sem repetir a voz nem conceder movimentos duplicados.
- Em Corrida, a criação mostra `JOIA ESPECIAL!`, o tipo e seu bônus de tempo por 1,1s, com o sparkle existente. O Arco-íris também recebe sparkle em Turnos. Matches comuns continuam sem essa pausa; regras de relógio, valores, somas, quebra/queda, poderes e voos são preservados.
- Destaque por contorno, opacidade e escala, sem flashes/brightness/reflow forçado. Movimento reduzido mantém a pausa de leitura, sem zoom. Sair ou reiniciar durante o destaque descarta a resolução antiga.
- Cache PWA atualizado para `joias-findom-v24-creation-moments`.

## V23 — áudio dos poderes

- Os cinco MP3s fornecidos estão em `audio/`: `clock.mp3` (dragon-studio-clock-ticking-sfx-467486), `extra-move.mp3` (ttsmaker-file-2026-9-19-8-20-45), `crown.mp3` (floraphonic-power-up-sparkle-1-177983), `cash.mp3` (ribhavagrawal-coin-recieved-230517) e `devil.mp3` (freesound_community-evil-laugh-89423). Arquivos originais, sem recodificação.
- Relógio toca somente na ativação, por 1,25s com fade e volume baixo. Extra Move toca quando os movimentos realmente aumentam; Coroa na ativação/subida; Diabinho na aplicação efetiva da penalidade. Dinheiro acompanha o início do voo do bônus acumulado.
- Mesmo AudioContext de match/bomba, com pré-carregamento na interação inicial. Até dois poderes simultâneos, espaçamento de 180ms, vozes sem sobreposição, repetições agrupadas e fila curta que descarta sons atrasados. Rival usa 35% do volume local; ataque recebido ganha prioridade e volume local. Match/bomba mantêm arquivos e variação de cascata, com redução suave para 58% durante os poderes.
- Online usa contadores opcionais `powerAudioEvents` no jogador para distinguir ativações de correções de tempo e não repetir áudio em snapshots. A entrada em uma partida estabelece a referência sem reproduzir eventos antigos. Nenhuma regra depende desses campos.
- Cache PWA `joias-findom-v23-power-audio` inclui os cinco arquivos. A suíte `tests/hud-rewards.cjs` verifica eventos, mixer Web Audio, decodificação dos MP3s e reprodução disponível offline, além das regressões do HUD.

## V22 — direção de arte de joias neon

- Camada visual em `jewel-theme.css`: roxo/azul, ouro e pink, emblema lapidado e atmosfera estática de luz e pequenos pontos luminosos.
- HUD com placas ornamentadas e centro de duelo; tabuleiros em molduras metálicas, quadriculado fixo e profundidade suave.
- Botões com relevo e guia de peças integrado. Layout adaptado para celular, tablet e desktop, preservando os destinos dos voos.
- Sem alterar regras, balanceamento, peças, animações de quebra/queda, voos, rede ou Dev Tools. Sem imagens/fontes externas ou novos efeitos de brilho intermitente. Tema incluído no cache offline do PWA.

## V21 — voos de recompensa legíveis

- Pontos e dinheiro direto são apresentados pelo total da cascata, assim como os bônus de tempo/movimentos. Os avisos nascem na região da jogada: 360 ms para leitura, 620 ms de viagem, 140 ms de pausa antes da chegada, 180 ms para encostar no HUD e 120 ms de impacto antes da atualização. A contagem e o fade encerram o ciclo em cerca de 2 segundos. Tipos diferentes partem com 160 ms de intervalo e posições separadas.
- Os valores reais, multiplicadores, relógios, penalidades e publicações online continuam seguindo as regras e o ritmo anteriores. A espera é apenas visual e não bloqueia a próxima jogada.
- Dinheiro individual fica junto ao jogador; o centro mantém a diferença financeira do duelo. No celular, os dois jogadores têm colunas próprias e o HUD acompanha a rolagem em telas com altura suficiente.
- `⏸ CONGELADO · 6,4s` permanece ao lado do relógio, soma congelamentos e desaparece ao terminar. A coroa permanece com multiplicador e duração/movimentos restantes.
- Diabinho sai do tabuleiro atacante e voa até o relógio atingido. Em Turnos, o relógio inativo mostra o tempo previsto para o próximo turno, preservando a penalidade de 10s e seu limite atual.
- O último evento permanente e os avisos duplicados foram removidos; os voos continuam fazendo parte da linguagem visual. Quebra/queda foram preservadas. A geometria dos voos é medida na partida e atualizada ao rolar/redimensionar, sem leituras de layout em todo frame; dinheiro reutiliza o DOM e snapshots online iguais não recriam os tabuleiros. Reflows necessários para reinício de outras animações não foram removidos.
- Somente na preferência de movimento reduzido os avisos permanecem junto ao HUD, com o mesmo tempo de leitura e sem voo/pulso. A última recompensa termina antes de abrir a tela de resultado; o encerramento lógico da partida continua imediato.

### Verificação do HUD

Com Node.js e Playwright disponíveis, execute `node --test tests/hud-rewards.cjs`. Use `BROWSER_CHANNEL=msedge` ou `chrome` para um navegador instalado; sem essa variável, o teste usa o Chromium do Playwright. O teste serve o projeto apenas em `127.0.0.1` e não acessa salas reais do Firebase. `JOIAS_SCREENSHOT_DIR` permite salvar capturas da conferência responsiva.

## Histórico — V10

- 👑 e 😈 continuam dentro das peças amarela/roxa e agora têm um movimento interno bem leve, sem mover a peça-base.
- Pontuação ganhou animação de contagem no HUD: o número sobe até o novo total e pulsa quando recebe pontos.
- Feedback grande aparece sobre cada tabuleiro mostrando combo, pontos e segundos ganhos (ex.: `🔥 Cascata x2 · 👑 Coroa x2`, `+110 pts · +1s`).
- Na V10, a ajuda ainda documentava a regra antiga de bônus de tempo; ela foi substituída pelas regras da V18 abaixo.
- Aposta fixa foi removida. Agora a partida usa conversão de pontos em dinheiro. O padrão é **100 pontos = R$ 1,00** (R$ 0,01/ponto), com outras conversões disponíveis no menu.
- No VS, o acerto financeiro final usa a **diferença de pontos**. Ex.: 900 × 700 = 200 pontos de diferença; na regra padrão, R$ 2,00.
- O HUD mostra em tempo real o equivalente financeiro da pontuação de cada lado.
- Multiplayer Firebase, embaralhamento automático, peças especiais, bots, áudio e PWA continuam preservados.

## Multiplayer
Escolha **Pessoa — online (Firebase)**. O jogo cria uma sala e exibe um botão para copiar o link. Cada pessoa abre o link no próprio aparelho, escolhe Jogador 1 ou Jogador 2, informa os nomes e marca Pronto. A sala reutiliza o mesmo projeto Firebase do Buraco, em documentos `buracoGames/jewels-<código>`.

## Rodar localmente
Não abra por `file://`. Use um servidor HTTP, por exemplo:

```bash
py -m http.server 8000
```

Depois abra `http://localhost:8000`.

## API de integração
`window.JewelsGame.startChallenge(options)` continua disponível para desafios solo/contra bot. A V10 aceita `pointValue` (padrão `0.01`) e o resultado inclui `scoreDifference`, `pointValue`, `playerMoney`, `opponentMoney`, `moneyDelta` e o alias `virtualDelta`.


## V11
- Dinheiro do VS passou para o centro do HUD: mostra quem está na frente e o valor atual da diferença de pontos.
- Coroa amarela agora ativa pontos x2 por 8 segundos, com barra/contador individual por jogador.
- Feedback de jogada foi simplificado para números flutuantes (+pontos / +tempo), sem caixa escura, e o último combo fica visível acima de cada tabuleiro.
- Pontuação conta até o novo valor com animação mais evidente.
- Bombas tocam `audio/bomb.mp3` quando são ativadas.


## V18 — bônus por modo

- Corrida: criar seta +4s, bomba +6s, Arco-íris +5s; cascatas x2 +1s e x3+ +2s, sem teto de tempo extra.
- Turnos: 90s por vez; criar seta/bomba/Arco-íris rende +1 movimento, acumulável sem limite.
- ⏳ congela o relógio por 10s; 😈 tira 3s do relógio atual na Corrida ou 10s do próximo turno rival; 💸 gera R$ 3,00.
- 👑 acumula x2 → x4 → x8 → ...; duração cresce por nível.
- Arco-íris ganhou uma joia multicolorida própria e o lado do bot usa animações mais estáveis para evitar flicker em tablets rápidos.


## V19 — ritmo visual e ataque

- Matches agora têm uma curta fase de leitura antes de quebrar; a quebra e a queda ficaram um pouco mais lentas e com pequeno assentamento.
- Reduzidos flashes de brilho; animações priorizam escala/opacidade para diminuir sensação de estrobo em tablets rápidos.
- O bot usa o mesmo ritmo legível, mas continua sem efeitos de brilho agressivos.
- 😈 ganhou animação de ataque: `-3s` na Corrida ou `-10s` no próximo turno voa até o relógio adversário e o HUD atingido reage.
- O ritmo foi ajustado para deixar clara a sequência: combinação → quebra → queda → cascata → recompensa.
