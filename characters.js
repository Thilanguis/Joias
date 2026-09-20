// Presentation and initial tuning. Existing gem, score and clock rules stay in app.js.
export const CHARACTERS = Object.freeze({
  prism: { name: 'Rainha Prismática', cast: 'PRISMA REAL', icon: '👸', art: './assets/characters/prism.webp', color: '#dfb3ff', charge: 1100,
    race: 'Ativa um arco-íris e limpa uma cor.', turns: 'Ativa um arco-íris e limpa uma cor.' },
  chaos: { name: 'Lorde do Caos', cast: 'REINADO DO CAOS', icon: '😈', art: './assets/characters/chaos.webp', color: '#f397ca', charge: 500,
    race: 'Dois ataques: −6s do rival.', turns: 'Dois ataques: −20s no próximo turno rival (mín. 30s).' },
  time: { name: 'Senhora do Tempo', cast: 'TEMPO SUSPENSO', icon: '⏳', art: './assets/characters/time.webp', color: '#98eaff', charge: 850,
    race: 'Congela 10s e acrescenta +3s.', turns: 'Congela 10s e concede +1 movimento.' },
  demolition: { name: 'Demolidora', cast: 'EXPLOSÃO REAL', icon: '💣', art: './assets/characters/demolition.webp', color: '#ffc88a', charge: 1000,
    race: 'Cria e explode duas bombas 3×3.', turns: 'Cria e explode duas bombas 3×3.' },
});

export function characterProfile(raw = {}) {
  return {
    name: String(raw.name || 'Você').trim().slice(0, 18) || 'Você',
    pix: String(raw.pix || '').trim().slice(0, 100),
    character: Object.hasOwn(CHARACTERS, raw.character) ? raw.character : 'prism',
  };
}
