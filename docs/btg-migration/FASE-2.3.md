# Fase 2.3 — Import de oferta via Excel/Word (CONCLUÍDA)

> Data: 2026-05-18 · Commit: `2fa3ee8`

## Objetivo
Permitir criar ofertas a partir de planilhas/documentos legados sem digitar tudo a mão. Port do `lib/import-oferta-parser.ts` do BTG Next.js pra vanilla JS, mais UI standalone.

## Formatos suportados
- **Excel layout A**: 2 colunas (campo, valor) por linha — uma oferta por arquivo.
- **Excel layout B**: linha 1 = headers, linha 2 = primeiro registro de dados.
- **Word (.docx)**: parágrafos no formato `Campo: valor`. Aceita multiline pra descrição etc.

Detecção do layout Excel é automática (heurística baseada na primeira célula).

## Aliases de campos
~200 mapeamentos pra acomodar variações comuns. Exemplos:
- `destino` | `rota` | `local` → `destino_rota`
- `nome` | `titulo` | `título` → `nome_da_oferta`
- `descrição` | `descricao` | `resumo` | `sobre` → `descricao`
- `preço` | `preco` | `valor` → `preco`
- `cia. aérea` | `companhia aerea` | `ciasaerea` → `companhia_aerea`

Aliases mantidos idênticos ao parser original — qualquer Excel/Word que funcionava no BTG Next.js funciona aqui.

## Conversores por tipo
- **Datas**: aceita `DD/MM/YYYY`, `YYYY-MM-DD` e Excel date serial (number). Converte tudo pra ISO.
- **Moeda**: detecta `R$` (default), `US$`, `EUR`.
- **Parcelamento**: extrai número 1-10 do texto.
- **tipo_cartao**: split por `;,/|`, valida cada valor contra Partners/Ultrablue/Operadora.
- **Booleanos**: `sim`/`yes`/`true`/`1` → true; resto → false.

## Arquivos
| Path | Linhas | Função |
|---|---|---|
| `btg/shared/btg-importer.js` | ~340 | Parser autocontido. Exports: `parseFile(file)`, `parseXlsxBuffer(buf)`, `parseDocxBuffer(buf)`. |
| `btg/dashboard/import/index.html` | ~250 | UI standalone com dropzone, preview de campos detectados, lista de avisos, alerta de obrigatórios faltantes, botão "Salvar como nova oferta". |

Dependências (CDN ESM, sem bundler):
- `xlsx@0.18.5` (Excel parsing)
- `mammoth@1.6.0` (Word text extraction)

## Limitações
- **Imagem não é importada**: o parser não embute upload. Após import, abrir a oferta no editor (`/btg/dashboard/ofertas/editar/?id=XXX`) e escolher imagem via picker.
- **Excel layout B** (tabular): só importa a primeira linha de dados. Pra bulk import de N ofertas seria preciso loop — não implementado.
- **DOCX com formatação rica** (tabelas, bullets): só extrai texto plano. Padrão `Campo: valor` precisa estar literal.

## URL pública
`https://gestor-btg-lp-builder-staging.web.app/btg/dashboard/import/`
