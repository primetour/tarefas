// Mock data — substituir por leituras Firestore (portal_destinations, portal_tips, portal_images) na Fase 2.
//
// Fotos usam picsum.photos (placeholder estável: mesmo seed = mesma foto). Em produção
// virão de portal_images filtradas pelo destino, hospedadas em R2 (Cloudflare).

const PIC = (seed, w = 1080, h = 1350) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

export const MOCK_DESTINOS = [
  {
    id: 'marrocos',
    nome: 'Marrocos',
    subtitulo: 'Oriente sensorial',
    capaUrl: PIC('marrocos-arch', 480, 360),
    disponivel: true,
    paletaFaixa: '#2BA9A7',
    slides: [
      { id: 'capa',        layoutId: 'capa',         nome: 'Marrocos',    titulo: 'Tudo sobre',          descricao: '',                                                                                                                fotoUrl: PIC('marrocos-arch') },
      { id: 'intro',       layoutId: 'foto-cima',    nome: 'Marrocos',    titulo: 'ORIENTE SENSORIAL',   descricao: 'Entre medinas ancestrais, desertos cinematográficos e cordilheiras milenares, o Marrocos revela uma cultura viva, moldada por impérios, rotas comerciais e saberes artesanais.', fotoUrl: PIC('marrocos-mosque') },
      { id: 'marrakech',   layoutId: 'lateral-esq',  nome: 'Marrakech',   titulo: 'RITMO ANCESTRAL',     descricao: 'Palácios, jardins islâmicos e souks tradicionais — herança cultural reconhecida pela UNESCO.',                   fotoUrl: PIC('marrocos-medina') },
      { id: 'fes',         layoutId: 'foto-cima',    nome: 'Fès',         titulo: 'CIDADE IMPERIAL',     descricao: 'Berço espiritual do país, com a maior medina viva do mundo e mais de 9.000 ruelas centenárias.',                fotoUrl: PIC('marrocos-fes') },
      { id: 'sahara',      layoutId: 'foto-cima',    nome: 'Saara',       titulo: 'DESERTO INFINITO',    descricao: 'Dunas douradas, acampamentos berberes e céus estrelados — silêncio e escala em outra dimensão.',                fotoUrl: PIC('marrocos-sahara') },
      { id: 'essaouira',   layoutId: 'lateral-dir',  nome: 'Essaouira',   titulo: 'BRISA ATLÂNTICA',     descricao: 'Cidade portuária branca e azul, com tradição gnawa, peixe fresco e ventos constantes do Atlântico.',            fotoUrl: PIC('marrocos-essaouira') },
      { id: 'atlas',       layoutId: 'foto-cima',    nome: 'Atlas',       titulo: 'MONTANHAS MILENARES', descricao: 'Vilarejos berberes em encostas, vales férteis e cumes nevados — o coração rural e autêntico.',                 fotoUrl: PIC('marrocos-atlas') },
      { id: 'chefchaouen', layoutId: 'lateral-dir',  nome: 'Chefchaouen', titulo: 'CIDADE AZUL',         descricao: 'Ruelas azuladas, atmosfera tranquila e vistas para o Rif — refúgio único no norte marroquino.',                fotoUrl: PIC('marrocos-chefchaouen') },
    ],
  },
  { id: 'egito',    nome: 'Egito',    subtitulo: 'Berço de impérios',    capaUrl: '', disponivel: false, paletaFaixa: '#C9933A' },
  { id: 'japao',    nome: 'Japão',    subtitulo: 'Tradição e futuro',    capaUrl: '', disponivel: false, paletaFaixa: '#C84A4A' },
  { id: 'italia',   nome: 'Itália',   subtitulo: 'Arte e mesa',          capaUrl: '', disponivel: false, paletaFaixa: '#3F8754' },
  { id: 'grecia',   nome: 'Grécia',   subtitulo: 'Mediterrâneo eterno',  capaUrl: '', disponivel: false, paletaFaixa: '#2C6AB3' },
  { id: 'patagonia',nome: 'Patagônia',subtitulo: 'Vento e gelo',         capaUrl: '', disponivel: false, paletaFaixa: '#5A7A8F' },
];

export const MOCK_FORMATOS = [
  { id: 'carrossel', label: 'Carrossel Instagram', descricao: '8 imagens 1080×1350 (4:5) para feed', disponivel: true,  defaultOn: true  },
  { id: 'story',     label: 'Story Instagram',     descricao: '8 imagens 1080×1920 (9:16) verticais', disponivel: true,  defaultOn: true  },
  { id: 'whatsapp',  label: 'WhatsApp',            descricao: 'Imagem quadrada + texto pronto',       disponivel: false, defaultOn: false },
  { id: 'email',     label: 'E-mail marketing',    descricao: 'Banner + corpo HTML',                   disponivel: false, defaultOn: false },
];

export const MOCK_TEMPLATES = [
  { id: 'classico-teal', label: 'Clássico Teal',  descricao: 'Faixa colorida com manuscrito + caixa-alta', cor: '#2BA9A7', disponivel: true },
  { id: 'areia-quente',  label: 'Areia Quente',   descricao: 'Tom terroso, ideal para destinos áridos',    cor: '#C9933A', disponivel: true },
  { id: 'azul-noturno',  label: 'Azul Noturno',   descricao: 'Tom marinho profundo, elegante',             cor: '#2C4A7C', disponivel: true },
  { id: 'editorial-noir',label: 'Editorial Noir', descricao: 'Preto e branco minimalista',                 cor: '#111111', disponivel: false },
];

// Layouts disponíveis pro IC trocar em cada slide (capa é fixa).
export const MOCK_LAYOUTS = [
  { id: 'lateral-esq', label: 'Esquerda', descricao: 'Texto à esquerda' },
  { id: 'lateral-dir', label: 'Direita',  descricao: 'Texto à direita' },
  { id: 'foto-cima',   label: 'Embaixo',  descricao: 'Texto embaixo' },
];

// Banco curado mock — em produção vem de `portal_images` filtrado por destino.
// Aqui simulamos 16 fotos pra cada destino mostrar variedade real no picker.
const BANCOS_CURADOS = {
  marrocos: [
    'arch','mosque','medina','fes','sahara','essaouira','atlas','chefchaouen',
    'souk','spice','lantern','tile','door','riad','palms','market',
  ].map((seed, i) => ({
    id: `marrocos-${seed}`,
    url: PIC(`marrocos-${seed}`, 600, 750),
    nome: `Marrocos — ${seed}`,
  })),
};

export function getBancoCurado(destinoId) {
  return BANCOS_CURADOS[destinoId] || [];
}
