/**
 * PRIMETOUR — Portal de Dicas: Seed inicial
 * Execute uma vez para popular os Termos de Uso no Firestore
 *
 * Como usar:
 *   node scripts/portal-seed.js
 *
 * Variáveis de ambiente: mesmas do mc-sync.js
 */

const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});
const db = admin.firestore();

const TERMS_TEXT = `TERMO DE USO DO PORTAL DE DICAS DA PRIMETOUR

Última atualização: 30/07/2025

Este Termo de Uso regula o uso do PORTAL DE DICAS DA PRIMETOUR, criado e desenvolvido por PRIME TOUR AGÊNCIA DE VIAGENS E TURISMO LTDA., empresa com sede na Avenida Paulista, 854 – 8º andar – conjunto 82 – Bela Vista – CEP 01311-100 - São Paulo/SP, inscrita no CNPJ/MF sob o número 55.132.906/0001-51, sendo todos os direitos reservados a esta. Ao acessar ou utilizar o sistema, o usuário declara ter lido, compreendido e aceitado integralmente os termos e condições abaixo.

1. Objetivo do Sistema
O PORTAL DE DICAS é um sistema interno exclusivo da PRIMETOUR constantemente alimentado pela área de jornalismo com conteúdo e informações sobre diversos destinos. Consultores e ICs parceiros da PRIMETOUR poderão acessar esta plataforma para a geração de dicas de maneira automatizadas nos templates de suas áreas a serem disponibilizados aos clientes.

2. Cadastro e Acesso
2.1. Para utilizar o sistema, o usuário (colaboradores PrimeTour, PrimeTravel e ICs ativos) deverá efetuar o acesso unicamente por single sign on (SSO).
2.2. O usuário é o único responsável pela veracidade das informações prestadas e pela guarda de seu login e senha de acesso.
2.3. O uso da conta é pessoal e intransferível.
2.4. O uso do PORTAL DE DICAS é exclusivo para colaboradores autorizados pela PRIMETOUR a utiliza-lo, não podendo, em hipótese alguma, ser utilizado por ou para outra pessoa e ou para outra finalidade que não seja o envio a clientes viajantes da PRIMETOUR/PRIMETRAVEL/ICs ativos.
2.5. O uso pelo usuário do PORTAL DE DICAS é restrito para disponibilizar dicas dos destinos para clientes que viajarão aos destinos solicitados, e a cópia, reprodução e distribuição para outros fins pode caracterizar falha grave, cabíveis de punições, de acordo com a gravidade da falha.

3. Obrigações do Usuário
O usuário se compromete a:
Utilizar o sistema apenas para fins lícitos e autorizados pela PRIMETOUR; E se responsabiliza a verificar a validade das dicas antes de enviar aos clientes; Não tentar acessar áreas restritas da plataforma PORTAL DE DICAS sem autorização; Não modificar, copiar, distribuir, transmitir, exibir, realizar, reproduzir, publicar, licenciar, criar trabalhos derivados, transferir ou vender quaisquer informações, softwares ou serviços obtidos através do sistema PORTAL DE DICAS; Não praticar qualquer ato que possa comprometer a segurança, estabilidade e funcionamento do sistema PORTAL DE DICAS; Não utilizar o PORTAL DE DICAS para qualquer outra finalidade que não seja envio de tamplets a clientes viajantes; Não conceder, facilitar ou permitir acesso ao PORTAL DE DICAS a pessoas não autorizadas pela PRIMETOUR; Não divulgar o conteúdo do PORTAL DE DICAS fora dos limites estabelecidos pela PRIMETOUR; arcar com 100% dos danos e prejuízos causados por sua conduta em desacordo com o quanto estipulado neste Termo de Uso, tanto a PRIMETOUR quanto a terceiros.

4. Sigilo, Confidencialidade, Privacidade e Proteção de Dados
A utilização do sistema PORTAL DE DICAS está sujeita à Política de Privacidade da PRIMETOUR, que trata sobre coleta, uso e proteção dos dados pessoais do usuário; O usuário do PORTAL DE DICAS se compromete a manter o sigilo, a confidencialidade, a disponibilidade e a integridade das informações e dos recursos/ferramentas de tecnologia da plataforma que tiver acesso, guarda ou manuseio; O usuário concorda que não revelará, reproduzirá, utilizará ou dará conhecimento, em hipótese alguma, a terceiros e/ou qualquer outra pessoa não autorizada, bem como não permitirá que seus colaboradores e ou prepostos façam uso dessas informações de forma indevida, exceto encaminhamento das informações aos seus clientes; A presente obrigação de guarda do sigilo permanecerá em vigor e vinculará legalmente o usuário não só a vigência de seu trabalho com a PRIMETOUR, bem como e, principalmente, após o encerramento de tal relação, não podendo nenhum conteúdo do PORTAL DE DICAS ser aproveitado em outros trabalhos que serão desenvolvidos para e com outras empresas. O usuário se obriga a realizar o tratamento de dados pessoais de acordo com as disposições legais vigentes, bem como nos moldes da Lei 13.709/2018, a Lei Geral de Proteção de Dados Pessoais (LGPD), visando dar a efetiva proteção aos dados coletados de pessoas naturais, utilizando-os somente para os fins necessários à consecução da viagem a ser realizada pelo cliente, ou nos limites do consentimento expressamente manifestado por escrito por seus respectivos titulares.

5. Direitos de Propriedade Intelectual
Todo o conteúdo disponível no PORTAL DE DICAS, incluindo, informações, textos, gráficos, logotipos, ícones, imagens, áudio, vídeo e software, é de propriedade exclusiva da PRIME TOUR AGÊNCIA DE VIAGENS E TURISMO LTDA, sendo protegido pelas leis de direitos autorais e de propriedade intelectual. O PORTAL DE DICAS constitui propriedade intelectual protegida e reservada exclusivamente à PRIMETOUR, de modo que a infração de qualquer disposição desta cláusula configurará violação de propriedade intelectual, com a responsabilização do usuário e seus representantes responsáveis, tanto civil como criminalmente, no forma da lei.

6. Limitação de Responsabilidade
A PRIMETOUR não se responsabiliza por: Falhas técnicas, operacionais ou de conectividade do sistema PORTAL DE DICAS; Danos decorrentes do uso inadequado do sistema pelo usuário; Perda de dados causada por falha do usuário, terceiros ou força maior; Não verificação por parte do usuário da validade das dicas apostas no PORTAL DE DICAS antes de enviar aos clientes.

7. Modificações
A PRIMETOUR reserva-se o direito de alterar, suspender ou descontinuar o sistema PORTAL DE DICAS, bem como alterar este Termo de Uso a qualquer momento, mediante aviso prévio aos usuários.

8. Vigência e Rescisão
Este termo vige por prazo indeterminado. A PRIMETOUR também poderá suspender ou cancelar o acesso do usuário em caso de violação deste Termo.

9. Penalidade
O usuário reconhece e aceita que, na hipótese de violação comprovada de quaisquer das cláusulas deste Termo de Uso arcará com uma multa equivalente a 30 vezes o valor do salário-mínimo nacional vigente a época da infração, além da obrigação de indenizar a PRIMETOUR e ou terceiros pelos prejuízos, perdas e danos, inclusive lucros cessantes, que vier a acarretar decorrente do não cumprimento de qualquer obrigação assumida.

Legislação Aplicável e Foro
Este termo será regido pelas leis da República Federativa do Brasil, sendo eleito o foro da comarca de São Paulo como o único competente para dirimir quaisquer dúvidas ou controvérsias decorrentes deste instrumento.

PRIME TOUR AGÊNCIA DE VIAGENS E TURISMO LTDA`;

async function seed() {
  console.log('Iniciando seed do Portal de Dicas...\n');

  // 1. Seed Terms of Use
  const termsRef = db.collection('portal_terms').doc('v1_20250730');
  const termsSnap = await termsRef.get();
  if (!termsSnap.exists) {
    await termsRef.set({
      version:   'v1_20250730',
      text:      TERMS_TEXT,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'system',
    });
    console.log('✓ Termos de Uso criados (v1_20250730)');
  } else {
    console.log('— Termos de Uso já existem, pulando.');
  }

  // 2. Seed default Areas
  const DEFAULT_AREAS = [
    { id: 'btg-partners',  name: 'BTG Partners',  colors: { primary: '#38BDF8', secondary: '#0F172A' } },
    { id: 'btg-ultrablue', name: 'BTG Ultrablue', colors: { primary: '#818CF8', secondary: '#0F172A' } },
    { id: 'centurion',     name: 'Centurion',     colors: { primary: '#34D399', secondary: '#0F172A' } },
    { id: 'lazer',         name: 'Lazer',         colors: { primary: '#D4A843', secondary: '#0F172A' } },
    { id: 'operadora',     name: 'Operadora',     colors: { primary: '#F97316', secondary: '#0F172A' } },
    { id: 'pts-bradesco',  name: 'PTS Bradesco',  colors: { primary: '#F472B6', secondary: '#0F172A' } },
  ];

  for (const area of DEFAULT_AREAS) {
    const ref  = db.collection('portal_areas').doc(area.id);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        ...area,
        templates:   [],
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
        createdBy:   'system',
        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`✓ Área criada: ${area.name}`);
    } else {
      console.log(`— Área já existe: ${area.name}`);
    }
  }

  console.log('\n✅ Seed concluído.');
}

seed().catch(e => { console.error('Erro:', e); process.exit(1); });
