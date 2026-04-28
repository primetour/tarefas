/**
 * Harness Node — gera PDF de teste com dados mock e salva em /tmp.
 * Roda: cd tests && node pdfHarness.mjs
 *
 * Importa generatePdfStandalone diretamente do source. Os imports do
 * firebase em portalGenerator.js são lazy, então não disparam aqui.
 */
import { jsPDF } from 'jspdf';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generatePdfStandalone } from '../js/services/portalGenerator.js';

// Logo placeholder: PNG transparente 200×60 com letra B preta centralizada
// Pequeno mas válido — pra testar layout/posicionamento.
const LOGO_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAMgAAAA8CAYAAAAjW/WRAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAlElEQVR4nO3RsQnAMBADQEsd/B23tWMKL+CtklJK/+e+cu5ynTmvRPf/uZBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSuJBSPnoBL08DlOvZJOgAAAAASUVORK5CYII=';
const LOGO_DATAURL = 'data:image/png;base64,' + LOGO_PNG_B64;

// Mock data — 1 destino, 4 segmentos pra cobrir todos os modos
const mockTip = {
  segments: {
    informacoes_gerais: {
      info: {
        descricao: 'Nova York é daqueles ímãs poderosos que nos fazem voltar sempre. Uma nova peça da Broadway pode ser uma desculpa. A neve no Central Park, o sol, um desejo de renovar o guarda-roupa. A verdade é que a cidade é tão multifacetada que é difícil não se viciar nela. Grandes monumentos, museus, compras — as mais belas lojas das melhores marcas estão em Nova York.\n\nCLIMA — TEMPERATURA ANUAL (MÉDIAS)\nMáx: Jan 3°C · Fev 5°C · Mar 9°C · Abr 15°C · Mai 21°C · Jun 26°C · Jul 29°C · Ago 28°C · Set 25°C · Out 18°C · Nov 12°C · Dez 7°C\nMin: Jan -3°C · Fev -3°C · Mar 1°C · Abr 7°C · Mai 12°C · Jun 17°C · Jul 21°C · Ago 21°C · Set 17°C · Out 11°C · Nov 4°C · Dez 1°C\n\nREPRESENTAÇÃO BRASILEIRA\nConsulado-Geral do Brasil em Nova York East 41st Street 225 Tel. (917) 777 7793',
        dica: 'Tenha em mente que estabelecimentos podem fechar e mudar de endereço. Para conferir valores, dias e horários, solicite a ajuda de seu concierge.',
        populacao: '8.258.035 habitantes',
        moeda: 'Dólar americano',
        lingua: 'Inglês',
        religiao: 'Cristianismo',
        fusoSinal: '-',
        fusoHoras: '1',
        voltagem: '110V',
        ddd: '1',
        representacao: {
          nome: 'Consulado-Geral do Brasil em Nova York',
          endereco: 'East 41st Street 225',
          telefone: '(917) 777 7793 (emergências consulares)',
        },
      },
    },
    bairros: {
      items: [
        { title: 'Brooklyn Heights', description: 'É um distrito histórico, com poucos prédios altos. Fica na beira do East River, e seu calçadão tem lindas vistas para Manhattan.' },
        { title: 'Chinatown', description: 'Um mundo à parte no universo de Manhattan. É o único bairro da região que ainda não foi engolido por novas levas de apartamentos de luxo.' },
        { title: 'SOHO', description: 'Arte, moda, design e aquela atmosfera cool. O bairro é dotado da maior quantidade de prédios com estrutura de ferro fundido do mundo.' },
      ],
    },
    atracoes: {
      items: [
        { categoria: 'Edifícios e construções urbanas', titulo: 'Biblioteca — Public Library', descricao: 'Quando foi inaugurado em 1911, o principal edifício de pesquisa do sistema de biblioteca pública de NYC era também a maior estrutura de mármore construída nos EUA.', endereco: '5th Avenue 455 com a 42nd Street', telefone: '(917) 275 6975', site: 'https://nypl.org' },
        { categoria: 'Edifícios e construções urbanas', titulo: 'Empire State Building', descricao: 'Com a trágica queda do World Trade Center, este símbolo de Nova York é novamente o arranha-céu mais reconhecível da cidade, com 320 metros e 86 andares acessíveis ao público.', endereco: '5th Avenue 338', telefone: '(212) 736 3100', site: 'https://esbnyc.com' },
        { categoria: 'Galerias de arte', titulo: 'David Zwirner Gallery', descricao: 'Galeria especializada em arte contemporânea, fundada pelo alemão David Zwirner. Existem quatro espaços em Nova York.', endereco: 'Walker Street 52', telefone: '(212) 727 2070', site: 'https://davidzwirner.com' },
        { categoria: 'Galerias de arte', titulo: 'Pace Gallery', descricao: 'Foi fundada em 1960 por Arne Glimcher. Desde essa época manteve e desenvolveu seu legado como uma galeria de arte que monta exposições históricas e contemporâneas seminais.', endereco: 'West 25th Street 540', telefone: '(212) 421 3292', site: 'https://pacegallery.com' },
      ],
    },
  },
};

const mockArea = {
  name: 'BTG Partners',
  logoUrl: LOGO_DATAURL,
  colors: { primary: '#475569', secondary: '#1F2937' },
};

const mockDest = { id: 'mock-ny', city: 'Nova York', country: 'Estados Unidos', continent: 'América do Norte' };

const mockImgFetcher = async (url) => url || null;
// Force fallback pra helvetica (não dispara fetch da Poppins no Node)
const mockFontLoader = async () => { throw new Error('skipping Poppins in Node'); };
const mockComposite  = async ({ logoDataUrl }) => logoDataUrl;

const outPath = join(tmpdir(), 'test-portal.pdf');

const result = await generatePdfStandalone({
  allTips: [{ tip: mockTip, dest: mockDest }],
  segments: ['informacoes_gerais', 'bairros', 'atracoes'],
  areaName: mockArea.name,
  area: mockArea,
  colors: mockArea.colors,
  filename: outPath,
  imagesByDest: { 'mock-ny': { hero: null, gallery: [], _overrides: {} } },
  _jsPDFCtor: jsPDF,
  _imgFetcher: mockImgFetcher,
  _fontLoader: mockFontLoader,
  _compositeLogo: mockComposite,
  _saveOverride: async (arrBuf, fname) => {
    writeFileSync(fname, Buffer.from(arrBuf));
  },
});

console.log('✓ PDF gerado:', result.filename);
