# Sons de Conclusão de Tarefa — slots de arquivo

Drop MP3s aqui pra ativar slots que dependem de áudio real (animais, etc).
Sintetizados (plin, bell, chime, pop, tada, success, coin, level-up, clown-horn,
laser) já funcionam sem MP3.

## Slots esperados

| Filename       | Som esperado                  | Sugestão de fonte (CC0 / royalty-free) |
|----------------|-------------------------------|----------------------------------------|
| `lion.mp3`     | Rugido curto de leão (~1-2s)  | freesound.org → "lion roar" CC0        |
| `sheep.mp3`    | Mééé de ovelha (~0.5-1s)      | pixabay.com/sound-effects → "sheep"    |
| `dog-bark.mp3` | Au-au de cachorro (~0.8s)     | freesound.org → "dog bark" CC0         |

## Especificações ideais

- **Duração**: ≤ 1.5s (sons de conclusão devem ser curtos)
- **Formato**: MP3, mono, 96kbps (~30-50KB por arquivo)
- **Volume**: normalizado a -6dBFS (não estourar o output)

## Como adicionar mais slots

1. Adicione o arquivo neste diretório
2. Adicione entrada em `js/services/sounds.js` em `SOUND_LIBRARY`:

```js
{ id: 'novo-id', label: 'Nome amigável', icon: '🎵', category: 'fun', file: 'novo-id.mp3',
  description: 'O que toca.' },
```

3. Bumpa versão (PATCH) e commit.

Sons sintetizados (sem arquivo) usam `synth: true` e função em `SYNTH_PLAYERS`.

## Fontes recomendadas

- [freesound.org](https://freesound.org) — filtre por "Creative Commons 0"
- [pixabay.com/sound-effects](https://pixabay.com/sound-effects/) — todos uso livre
- [zapsplat.com](https://www.zapsplat.com) — exige cadastro grátis

## Comportamento se MP3 não existe

Se o usuário escolheu um som que ainda não tem arquivo, o sistema faz **fallback
silencioso pro `plin` default** — nunca fica completamente em silêncio (a não ser
que o user escolha "Mudo" explicitamente).
