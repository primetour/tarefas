# Sons de Conclusão de Tarefa — banco de arquivos

Banco real de MP3s usado pelo `js/services/sounds.js` quando o som escolhido
pelo user é `file: ...`. Sintetizados (plin, sino, carrilhão, pop, tada,
sucesso UI, moeda, level-up, laser) não dependem desta pasta.

## Sons atuais

| Filename            | Som                       | Tamanho |
|---------------------|---------------------------|---------|
| `lion.mp3`          | 🦁 Leão rugindo           | ~68KB   |
| `sheep.mp3`         | 🐑 Ovelha                 | ~24KB   |
| `clown-horn.mp3`    | 🤡 Buzina de palhaço      | ~96KB   |
| `explosion.mp3`     | 💥 Explosão               | ~97KB   |
| `woah.mp3`          | 😱 Woooooaah              | ~73KB   |
| `i-got-this.mp3`    | 😎 I got this             | ~23KB   |
| `johnny-bacon.mp3`  | 🥓 Johnny Bacon           | ~55KB   |

## Como adicionar mais sons

1. Drop arquivo MP3 nesta pasta com nome slugified (lowercase, kebab-case, sem acentos)
2. Adiciona entrada em `js/services/sounds.js` em `SOUND_LIBRARY`:

```js
{ id: 'novo-id', label: 'Nome amigável', icon: '🎵', category: 'fun',
  file: 'novo-id.mp3', description: 'O que toca.' },
```

3. Bumpa versão (PATCH) e commit.

## Especificações

- **Duração ideal**: ≤ 1.5s (sons de conclusão devem ser curtos)
- **Formato**: MP3, mono ou estéreo, 96-128kbps
- **Volume**: normalizado (não estourar o output, ideal -6dBFS)

## Comportamento se MP3 não existe

Se o usuário escolheu um som que ainda não tem arquivo, o sistema faz **fallback
silencioso pro `plin` default** — nunca fica completamente em silêncio (a não ser
que o user escolha "Mudo" explicitamente).

## Fontes recomendadas (CC0 / royalty-free)

- [freesound.org](https://freesound.org) — filtre por "Creative Commons 0"
- [pixabay.com/sound-effects](https://pixabay.com/sound-effects/) — todos uso livre
- [zapsplat.com](https://www.zapsplat.com) — exige cadastro grátis
