# Joias Findom V10

Protótipo match-3 responsivo para celular, tablet e desktop.

## V10

- 👑 e 😈 continuam dentro das peças amarela/roxa e agora têm um movimento interno bem leve, sem mover a peça-base.
- Pontuação ganhou animação de contagem no HUD: o número sobe até o novo total e pulsa quando recebe pontos.
- Feedback grande aparece sobre cada tabuleiro mostrando combo, pontos e segundos ganhos (ex.: `🔥 Cascata x2 · 👑 Coroa x2`, `+110 pts · +1s`).
- A ajuda mostra de forma explícita a regra de tempo: ↔/↕ +1s; 💣/🌈 +2s; cascata +1s; especiais ativados até +2s; máximo +4s por resolução.
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
