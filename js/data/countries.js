/**
 * PRIMETOUR — Países (SSOT geográfico)
 *
 * Lista HARDCODED dos países do modelo geográfico canônico.
 * Códigos seguem ISO 3166-1 alpha-2 (estável, internacional).
 *
 * Estrutura:
 *   {
 *     code: 'AR',           // ISO 3166-1 alpha-2 (estável, NÃO ALTERAR)
 *     pt: 'Argentina',      // Label canônico pt-BR
 *     en: 'Argentina',      // Label en (pra match Envision/Unsplash)
 *     continent: 'SA',      // FK pra continents.js
 *     aliases: [...],       // Outros nomes vistos (opcional)
 *   }
 *
 * Aliases incluem:
 *   - Versões sem/com acento ("Mexico"/"México")
 *   - Variações ortográficas ("Coréia"/"Coreia")
 *   - Idioma original ("Japan"/"Japão", "Italy"/"Itália")
 *   - Casos especiais Envision detectados em campo ("África" → "África do Sul")
 *
 * Casos especiais NÃO-ISO mas presentes em Envision (mantidos pra
 * retrocompat de filtros antigos):
 *   - Inglaterra (GB-ENG) — constituente UK
 *   - Escócia    (GB-SCT) — constituente UK
 *   - País de Gales (GB-WLS)
 *   - Irlanda do Norte (GB-NIR)
 *
 * Cuidados:
 *   - NÃO ALTERAR `code`. É FK estável em portal_destinations.
 *   - Renomear `pt` é cosmético — UI usa code internamente.
 *   - Adicionar país novo: append no fim do array, escolher continente correto.
 *
 * Fonte: ISO 3166-1 + adições Envision (sprint v4.59 — Geography SSOT).
 */

export const COUNTRIES = Object.freeze([
  // ───────── América do Sul (SA) ─────────
  { code: 'AR', pt: 'Argentina',  en: 'Argentina', continent: 'SA' },
  { code: 'BO', pt: 'Bolívia',    en: 'Bolivia',   continent: 'SA', aliases: ['Bolivia'] },
  { code: 'BR', pt: 'Brasil',     en: 'Brazil',    continent: 'SA', aliases: ['Brazil'] },
  { code: 'CL', pt: 'Chile',      en: 'Chile',     continent: 'SA' },
  { code: 'CO', pt: 'Colômbia',   en: 'Colombia',  continent: 'SA', aliases: ['Colombia'] },
  { code: 'EC', pt: 'Equador',    en: 'Ecuador',   continent: 'SA', aliases: ['Ecuador'] },
  { code: 'GY', pt: 'Guiana',     en: 'Guyana',    continent: 'SA' },
  { code: 'PY', pt: 'Paraguai',   en: 'Paraguay',  continent: 'SA', aliases: ['Paraguay'] },
  { code: 'PE', pt: 'Peru',       en: 'Peru',      continent: 'SA' },
  { code: 'SR', pt: 'Suriname',   en: 'Suriname',  continent: 'SA' },
  { code: 'UY', pt: 'Uruguai',    en: 'Uruguay',   continent: 'SA', aliases: ['Uruguay'] },
  { code: 'VE', pt: 'Venezuela',  en: 'Venezuela', continent: 'SA' },
  { code: 'GF', pt: 'Guiana Francesa', en: 'French Guiana', continent: 'SA' },
  { code: 'FK', pt: 'Ilhas Malvinas',  en: 'Falkland Islands', continent: 'SA', aliases: ['Falkland Islands', 'Malvinas'] },

  // ───────── América do Norte + Central + Caribe (NA) ─────────
  { code: 'US', pt: 'Estados Unidos', en: 'United States', continent: 'NA', aliases: ['EUA', 'USA', 'United States of America'] },
  { code: 'CA', pt: 'Canadá',         en: 'Canada',        continent: 'NA', aliases: ['Canada'] },
  { code: 'MX', pt: 'México',         en: 'Mexico',        continent: 'NA', aliases: ['Mexico'] },
  { code: 'CR', pt: 'Costa Rica',     en: 'Costa Rica',    continent: 'NA' },
  { code: 'PA', pt: 'Panamá',         en: 'Panama',        continent: 'NA', aliases: ['Panama'] },
  { code: 'GT', pt: 'Guatemala',      en: 'Guatemala',     continent: 'NA' },
  { code: 'HN', pt: 'Honduras',       en: 'Honduras',      continent: 'NA' },
  { code: 'SV', pt: 'El Salvador',    en: 'El Salvador',   continent: 'NA' },
  { code: 'NI', pt: 'Nicarágua',      en: 'Nicaragua',     continent: 'NA', aliases: ['Nicaragua'] },
  { code: 'BZ', pt: 'Belize',         en: 'Belize',        continent: 'NA' },
  { code: 'CU', pt: 'Cuba',           en: 'Cuba',          continent: 'NA' },
  { code: 'JM', pt: 'Jamaica',        en: 'Jamaica',       continent: 'NA' },
  { code: 'HT', pt: 'Haiti',          en: 'Haiti',         continent: 'NA' },
  { code: 'DO', pt: 'República Dominicana', en: 'Dominican Republic', continent: 'NA', aliases: ['Dominican Republic'] },
  { code: 'PR', pt: 'Porto Rico',     en: 'Puerto Rico',   continent: 'NA', aliases: ['Puerto Rico'] },
  { code: 'BS', pt: 'Bahamas',        en: 'Bahamas',       continent: 'NA' },
  { code: 'BB', pt: 'Barbados',       en: 'Barbados',      continent: 'NA' },
  { code: 'TT', pt: 'Trinidad e Tobago', en: 'Trinidad and Tobago', continent: 'NA' },
  { code: 'AG', pt: 'Antígua e Barbuda', en: 'Antigua and Barbuda', continent: 'NA' },
  { code: 'KY', pt: 'Ilhas Cayman',   en: 'Cayman Islands', continent: 'NA', aliases: ['Cayman Islands'] },
  { code: 'AW', pt: 'Aruba',          en: 'Aruba',         continent: 'NA' },
  { code: 'CW', pt: 'Curaçao',        en: 'Curaçao',       continent: 'NA' },
  { code: 'GL', pt: 'Groenlândia',    en: 'Greenland',     continent: 'NA', aliases: ['Greenland'] },
  { code: 'BM', pt: 'Bermudas',       en: 'Bermuda',       continent: 'NA', aliases: ['Bermuda'] },
  { code: 'TC', pt: 'Ilhas Turcas e Caicos', en: 'Turks and Caicos Islands', continent: 'NA' },
  { code: 'VG', pt: 'Ilhas Virgens Britânicas', en: 'British Virgin Islands', continent: 'NA' },
  { code: 'VI', pt: 'Ilhas Virgens Americanas', en: 'U.S. Virgin Islands', continent: 'NA' },

  // ───────── Europa (EU) ─────────
  { code: 'AL', pt: 'Albânia',           en: 'Albania',          continent: 'EU' },
  { code: 'AD', pt: 'Andorra',           en: 'Andorra',          continent: 'EU' },
  { code: 'AT', pt: 'Áustria',           en: 'Austria',          continent: 'EU', aliases: ['Austria'] },
  { code: 'BE', pt: 'Bélgica',           en: 'Belgium',          continent: 'EU', aliases: ['Belgium'] },
  { code: 'BA', pt: 'Bósnia e Herzegovina', en: 'Bosnia and Herzegovina', continent: 'EU' },
  { code: 'BG', pt: 'Bulgária',          en: 'Bulgaria',         continent: 'EU', aliases: ['Bulgaria'] },
  { code: 'HR', pt: 'Croácia',           en: 'Croatia',          continent: 'EU', aliases: ['Croatia'] },
  { code: 'CY', pt: 'Chipre',            en: 'Cyprus',           continent: 'EU' },
  { code: 'CZ', pt: 'República Tcheca',  en: 'Czech Republic',   continent: 'EU', aliases: ['Tchéquia', 'Chéquia', 'Czechia'] },
  { code: 'DK', pt: 'Dinamarca',         en: 'Denmark',          continent: 'EU', aliases: ['Denmark'] },
  { code: 'EE', pt: 'Estônia',           en: 'Estonia',          continent: 'EU' },
  { code: 'FI', pt: 'Finlândia',         en: 'Finland',          continent: 'EU', aliases: ['Finland'] },
  { code: 'FR', pt: 'França',            en: 'France',           continent: 'EU', aliases: ['France'] },
  { code: 'DE', pt: 'Alemanha',          en: 'Germany',          continent: 'EU', aliases: ['Germany'] },
  { code: 'GR', pt: 'Grécia',            en: 'Greece',           continent: 'EU', aliases: ['Greece', 'Grecia'] },
  { code: 'HU', pt: 'Hungria',           en: 'Hungary',          continent: 'EU', aliases: ['Hungary'] },
  { code: 'IS', pt: 'Islândia',          en: 'Iceland',          continent: 'EU', aliases: ['Iceland', 'Islandia'] },
  { code: 'IE', pt: 'Irlanda',           en: 'Ireland',          continent: 'EU', aliases: ['Ireland'] },
  { code: 'IT', pt: 'Itália',            en: 'Italy',            continent: 'EU', aliases: ['Italy', 'Italia'] },
  { code: 'LV', pt: 'Letônia',           en: 'Latvia',           continent: 'EU' },
  { code: 'LI', pt: 'Liechtenstein',     en: 'Liechtenstein',    continent: 'EU' },
  { code: 'LT', pt: 'Lituânia',          en: 'Lithuania',        continent: 'EU' },
  { code: 'LU', pt: 'Luxemburgo',        en: 'Luxembourg',       continent: 'EU' },
  { code: 'MT', pt: 'Malta',             en: 'Malta',            continent: 'EU' },
  { code: 'MD', pt: 'Moldávia',          en: 'Moldova',          continent: 'EU' },
  { code: 'MC', pt: 'Mônaco',            en: 'Monaco',           continent: 'EU', aliases: ['Monaco'] },
  { code: 'ME', pt: 'Montenegro',        en: 'Montenegro',       continent: 'EU' },
  { code: 'NL', pt: 'Holanda',           en: 'Netherlands',      continent: 'EU', aliases: ['Netherlands', 'Países Baixos', 'Paises Baixos'] },
  { code: 'MK', pt: 'Macedônia do Norte', en: 'North Macedonia', continent: 'EU' },
  { code: 'NO', pt: 'Noruega',           en: 'Norway',           continent: 'EU', aliases: ['Norway'] },
  { code: 'PL', pt: 'Polônia',           en: 'Poland',           continent: 'EU', aliases: ['Poland'] },
  { code: 'PT', pt: 'Portugal',          en: 'Portugal',         continent: 'EU' },
  { code: 'RO', pt: 'Romênia',           en: 'Romania',          continent: 'EU', aliases: ['Romania'] },
  { code: 'RU', pt: 'Rússia',            en: 'Russia',           continent: 'EU', aliases: ['Russia'] },
  { code: 'SM', pt: 'San Marino',        en: 'San Marino',       continent: 'EU' },
  { code: 'RS', pt: 'Sérvia',            en: 'Serbia',           continent: 'EU', aliases: ['Serbia'] },
  { code: 'SK', pt: 'Eslováquia',        en: 'Slovakia',         continent: 'EU' },
  { code: 'SI', pt: 'Eslovênia',         en: 'Slovenia',         continent: 'EU' },
  { code: 'ES', pt: 'Espanha',           en: 'Spain',            continent: 'EU', aliases: ['Spain'] },
  { code: 'SE', pt: 'Suécia',            en: 'Sweden',           continent: 'EU', aliases: ['Sweden'] },
  { code: 'CH', pt: 'Suíça',             en: 'Switzerland',      continent: 'EU', aliases: ['Switzerland', 'Suiça', 'Suica'] },
  { code: 'UA', pt: 'Ucrânia',           en: 'Ukraine',          continent: 'EU' },
  { code: 'VA', pt: 'Vaticano',          en: 'Vatican City',     continent: 'EU' },
  { code: 'BY', pt: 'Belarus',           en: 'Belarus',          continent: 'EU' },
  { code: 'GB', pt: 'Reino Unido',       en: 'United Kingdom',   continent: 'EU', aliases: ['UK', 'United Kingdom', 'Grã-Bretanha'] },
  // Constituintes do Reino Unido (Envision usa em campo, mantemos como entries separadas pra filtros):
  { code: 'GB-ENG', pt: 'Inglaterra',     en: 'England',          continent: 'EU', aliases: ['England'], parent: 'GB' },
  { code: 'GB-SCT', pt: 'Escócia',        en: 'Scotland',         continent: 'EU', aliases: ['Scotland', 'Escocia'], parent: 'GB' },
  { code: 'GB-WLS', pt: 'País de Gales',  en: 'Wales',            continent: 'EU', aliases: ['Wales'], parent: 'GB' },
  { code: 'GB-NIR', pt: 'Irlanda do Norte', en: 'Northern Ireland', continent: 'EU', aliases: ['Northern Ireland'], parent: 'GB' },

  // ───────── Ásia (AS) ─────────
  { code: 'AF', pt: 'Afeganistão',       en: 'Afghanistan',      continent: 'AS' },
  { code: 'AM', pt: 'Armênia',           en: 'Armenia',          continent: 'AS' },
  { code: 'AZ', pt: 'Azerbaijão',        en: 'Azerbaijan',       continent: 'AS' },
  { code: 'BH', pt: 'Bahrein',           en: 'Bahrain',          continent: 'AS' },
  { code: 'BD', pt: 'Bangladesh',        en: 'Bangladesh',       continent: 'AS' },
  { code: 'BT', pt: 'Butão',             en: 'Bhutan',           continent: 'AS', aliases: ['Bhutan', 'Butao'] },
  { code: 'BN', pt: 'Brunei',            en: 'Brunei',           continent: 'AS' },
  { code: 'KH', pt: 'Camboja',           en: 'Cambodia',         continent: 'AS', aliases: ['Cambodia'] },
  { code: 'CN', pt: 'China',             en: 'China',            continent: 'AS' },
  { code: 'GE', pt: 'Geórgia',           en: 'Georgia',          continent: 'AS' },
  { code: 'HK', pt: 'Hong Kong',         en: 'Hong Kong',        continent: 'AS', parent: 'CN' },
  { code: 'IN', pt: 'Índia',             en: 'India',            continent: 'AS', aliases: ['India'] },
  { code: 'ID', pt: 'Indonésia',         en: 'Indonesia',        continent: 'AS', aliases: ['Indonesia'] },
  { code: 'IR', pt: 'Irã',               en: 'Iran',             continent: 'AS', aliases: ['Iran'] },
  { code: 'IQ', pt: 'Iraque',            en: 'Iraq',             continent: 'AS' },
  { code: 'IL', pt: 'Israel',            en: 'Israel',           continent: 'AS' },
  { code: 'JP', pt: 'Japão',             en: 'Japan',            continent: 'AS', aliases: ['Japan', 'Japao'] },
  { code: 'JO', pt: 'Jordânia',          en: 'Jordan',           continent: 'AS', aliases: ['Jordan'] },
  { code: 'KZ', pt: 'Cazaquistão',       en: 'Kazakhstan',       continent: 'AS' },
  { code: 'KW', pt: 'Kuwait',            en: 'Kuwait',           continent: 'AS' },
  { code: 'KG', pt: 'Quirguistão',       en: 'Kyrgyzstan',       continent: 'AS' },
  { code: 'LA', pt: 'Laos',              en: 'Laos',             continent: 'AS' },
  { code: 'LB', pt: 'Líbano',            en: 'Lebanon',          continent: 'AS' },
  { code: 'MO', pt: 'Macau',             en: 'Macao',            continent: 'AS', parent: 'CN' },
  { code: 'MY', pt: 'Malásia',           en: 'Malaysia',         continent: 'AS', aliases: ['Malaysia', 'Malasia', 'Península Malaia', 'Peninsula Malaia'] },
  { code: 'MV', pt: 'Maldivas',          en: 'Maldives',         continent: 'AS', aliases: ['Maldives'] },
  { code: 'MN', pt: 'Mongólia',          en: 'Mongolia',         continent: 'AS' },
  { code: 'MM', pt: 'Mianmar',           en: 'Myanmar',          continent: 'AS', aliases: ['Myanmar', 'Burma'] },
  { code: 'NP', pt: 'Nepal',             en: 'Nepal',            continent: 'AS' },
  { code: 'KP', pt: 'Coreia do Norte',   en: 'North Korea',      continent: 'AS' },
  { code: 'OM', pt: 'Omã',               en: 'Oman',             continent: 'AS', aliases: ['Oman'] },
  { code: 'PK', pt: 'Paquistão',         en: 'Pakistan',         continent: 'AS' },
  { code: 'PS', pt: 'Palestina',         en: 'Palestine',        continent: 'AS' },
  { code: 'PH', pt: 'Filipinas',         en: 'Philippines',      continent: 'AS', aliases: ['Philippines'] },
  { code: 'QA', pt: 'Catar',             en: 'Qatar',            continent: 'AS', aliases: ['Qatar'] },
  { code: 'SA', pt: 'Arábia Saudita',    en: 'Saudi Arabia',     continent: 'AS', aliases: ['Saudi Arabia', 'Arabia Saudita'] },
  { code: 'SG', pt: 'Singapura',         en: 'Singapore',        continent: 'AS', aliases: ['Singapore'] },
  { code: 'KR', pt: 'Coreia do Sul',     en: 'South Korea',      continent: 'AS', aliases: ['South Korea', 'Coréia do Sul', 'Coreia do sul'] },
  { code: 'LK', pt: 'Sri Lanka',         en: 'Sri Lanka',        continent: 'AS' },
  { code: 'SY', pt: 'Síria',             en: 'Syria',            continent: 'AS' },
  { code: 'TW', pt: 'Taiwan',            en: 'Taiwan',           continent: 'AS' },
  { code: 'TJ', pt: 'Tajiquistão',       en: 'Tajikistan',       continent: 'AS' },
  { code: 'TH', pt: 'Tailândia',         en: 'Thailand',         continent: 'AS', aliases: ['Thailand', 'Tailandia'] },
  { code: 'TL', pt: 'Timor-Leste',       en: 'Timor-Leste',      continent: 'AS' },
  { code: 'TR', pt: 'Turquia',           en: 'Turkey',           continent: 'AS', aliases: ['Turkey', 'Türkiye'] },
  { code: 'TM', pt: 'Turcomenistão',     en: 'Turkmenistan',     continent: 'AS' },
  { code: 'AE', pt: 'Emirados Árabes Unidos', en: 'United Arab Emirates', continent: 'AS', aliases: ['UAE', 'United Arab Emirates', 'Emirados Arabes Unidos'] },
  { code: 'UZ', pt: 'Uzbequistão',       en: 'Uzbekistan',       continent: 'AS' },
  { code: 'VN', pt: 'Vietnã',            en: 'Vietnam',          continent: 'AS', aliases: ['Vietnam', 'Vietna'] },
  { code: 'YE', pt: 'Iêmen',             en: 'Yemen',            continent: 'AS' },

  // ───────── África (AF) ─────────
  { code: 'DZ', pt: 'Argélia',           en: 'Algeria',          continent: 'AF' },
  { code: 'AO', pt: 'Angola',            en: 'Angola',           continent: 'AF' },
  { code: 'BJ', pt: 'Benin',             en: 'Benin',            continent: 'AF' },
  { code: 'BW', pt: 'Botswana',          en: 'Botswana',         continent: 'AF' },
  { code: 'BF', pt: 'Burkina Faso',      en: 'Burkina Faso',     continent: 'AF' },
  { code: 'BI', pt: 'Burundi',           en: 'Burundi',          continent: 'AF' },
  { code: 'CV', pt: 'Cabo Verde',        en: 'Cape Verde',       continent: 'AF', aliases: ['Cape Verde'] },
  { code: 'CM', pt: 'Camarões',          en: 'Cameroon',         continent: 'AF' },
  { code: 'CF', pt: 'República Centro-Africana', en: 'Central African Republic', continent: 'AF' },
  { code: 'TD', pt: 'Chade',             en: 'Chad',             continent: 'AF' },
  { code: 'KM', pt: 'Comores',           en: 'Comoros',          continent: 'AF' },
  { code: 'CD', pt: 'República Democrática do Congo', en: 'Democratic Republic of the Congo', continent: 'AF' },
  { code: 'CG', pt: 'República do Congo', en: 'Republic of the Congo', continent: 'AF' },
  { code: 'DJ', pt: 'Djibuti',           en: 'Djibouti',         continent: 'AF' },
  { code: 'EG', pt: 'Egito',             en: 'Egypt',            continent: 'AF', aliases: ['Egypt'] },
  { code: 'GQ', pt: 'Guiné Equatorial',  en: 'Equatorial Guinea', continent: 'AF' },
  { code: 'ER', pt: 'Eritreia',          en: 'Eritrea',          continent: 'AF' },
  { code: 'SZ', pt: 'Essuatíni',         en: 'Eswatini',         continent: 'AF', aliases: ['Suazilândia', 'Swaziland'] },
  { code: 'ET', pt: 'Etiópia',           en: 'Ethiopia',         continent: 'AF' },
  { code: 'GA', pt: 'Gabão',             en: 'Gabon',            continent: 'AF' },
  { code: 'GM', pt: 'Gâmbia',            en: 'Gambia',           continent: 'AF' },
  { code: 'GH', pt: 'Gana',              en: 'Ghana',            continent: 'AF' },
  { code: 'GN', pt: 'Guiné',             en: 'Guinea',           continent: 'AF' },
  { code: 'GW', pt: 'Guiné-Bissau',      en: 'Guinea-Bissau',    continent: 'AF' },
  { code: 'CI', pt: 'Costa do Marfim',   en: 'Ivory Coast',      continent: 'AF', aliases: ["Côte d'Ivoire", 'Ivory Coast'] },
  { code: 'KE', pt: 'Quênia',            en: 'Kenya',            continent: 'AF', aliases: ['Kenya', 'Quenia'] },
  { code: 'LS', pt: 'Lesoto',            en: 'Lesotho',          continent: 'AF' },
  { code: 'LR', pt: 'Libéria',           en: 'Liberia',          continent: 'AF' },
  { code: 'LY', pt: 'Líbia',             en: 'Libya',            continent: 'AF' },
  { code: 'MG', pt: 'Madagascar',        en: 'Madagascar',       continent: 'AF' },
  { code: 'MW', pt: 'Malawi',            en: 'Malawi',           continent: 'AF' },
  { code: 'ML', pt: 'Mali',              en: 'Mali',             continent: 'AF' },
  { code: 'MR', pt: 'Mauritânia',        en: 'Mauritania',       continent: 'AF' },
  { code: 'MU', pt: 'Maurício',          en: 'Mauritius',        continent: 'AF', aliases: ['Mauritius'] },
  { code: 'MA', pt: 'Marrocos',          en: 'Morocco',          continent: 'AF', aliases: ['Morocco'] },
  { code: 'MZ', pt: 'Moçambique',        en: 'Mozambique',       continent: 'AF', aliases: ['Mozambique', 'Mocambique'] },
  { code: 'NA', pt: 'Namíbia',           en: 'Namibia',          continent: 'AF', aliases: ['Namibia'] },
  { code: 'NE', pt: 'Níger',             en: 'Niger',            continent: 'AF' },
  { code: 'NG', pt: 'Nigéria',           en: 'Nigeria',          continent: 'AF' },
  { code: 'RW', pt: 'Ruanda',            en: 'Rwanda',           continent: 'AF', aliases: ['Rwanda'] },
  { code: 'ST', pt: 'São Tomé e Príncipe', en: 'São Tomé and Príncipe', continent: 'AF' },
  { code: 'SN', pt: 'Senegal',           en: 'Senegal',          continent: 'AF' },
  { code: 'SC', pt: 'Seychelles',        en: 'Seychelles',       continent: 'AF' },
  { code: 'SL', pt: 'Serra Leoa',        en: 'Sierra Leone',     continent: 'AF' },
  { code: 'SO', pt: 'Somália',           en: 'Somalia',          continent: 'AF' },
  { code: 'ZA', pt: 'África do Sul',     en: 'South Africa',     continent: 'AF', aliases: ['South Africa', 'Africa do Sul', 'África', 'Africa'] },
  { code: 'SS', pt: 'Sudão do Sul',      en: 'South Sudan',      continent: 'AF' },
  { code: 'SD', pt: 'Sudão',             en: 'Sudan',            continent: 'AF' },
  { code: 'TZ', pt: 'Tanzânia',          en: 'Tanzania',         continent: 'AF', aliases: ['Tanzania'] },
  { code: 'TG', pt: 'Togo',              en: 'Togo',             continent: 'AF' },
  { code: 'TN', pt: 'Tunísia',           en: 'Tunisia',          continent: 'AF', aliases: ['Tunisia'] },
  { code: 'UG', pt: 'Uganda',            en: 'Uganda',           continent: 'AF' },
  { code: 'ZM', pt: 'Zâmbia',            en: 'Zambia',           continent: 'AF' },
  { code: 'ZW', pt: 'Zimbábue',          en: 'Zimbabwe',         continent: 'AF', aliases: ['Zimbabwe', 'Zimbabue'] },

  // ───────── Oceania (OC) ─────────
  { code: 'AU', pt: 'Austrália',         en: 'Australia',        continent: 'OC', aliases: ['Australia'] },
  { code: 'FJ', pt: 'Fiji',              en: 'Fiji',             continent: 'OC' },
  { code: 'KI', pt: 'Kiribati',          en: 'Kiribati',         continent: 'OC' },
  { code: 'MH', pt: 'Ilhas Marshall',    en: 'Marshall Islands', continent: 'OC' },
  { code: 'FM', pt: 'Micronésia',        en: 'Micronesia',       continent: 'OC' },
  { code: 'NR', pt: 'Nauru',             en: 'Nauru',            continent: 'OC' },
  { code: 'NZ', pt: 'Nova Zelândia',     en: 'New Zealand',      continent: 'OC', aliases: ['New Zealand', 'Nova Zelandia'] },
  { code: 'PW', pt: 'Palau',             en: 'Palau',            continent: 'OC' },
  { code: 'PG', pt: 'Papua-Nova Guiné',  en: 'Papua New Guinea', continent: 'OC' },
  { code: 'WS', pt: 'Samoa',             en: 'Samoa',            continent: 'OC' },
  { code: 'SB', pt: 'Ilhas Salomão',     en: 'Solomon Islands',  continent: 'OC' },
  { code: 'TO', pt: 'Tonga',             en: 'Tonga',            continent: 'OC' },
  { code: 'TV', pt: 'Tuvalu',            en: 'Tuvalu',           continent: 'OC' },
  { code: 'VU', pt: 'Vanuatu',           en: 'Vanuatu',          continent: 'OC' },
  { code: 'PF', pt: 'Polinésia Francesa', en: 'French Polynesia', continent: 'OC', aliases: ['French Polynesia', 'Polinesia Francesa', 'Tahiti'] },
  { code: 'NC', pt: 'Nova Caledônia',    en: 'New Caledonia',    continent: 'OC' },
  { code: 'CK', pt: 'Ilhas Cook',        en: 'Cook Islands',     continent: 'OC' },

  // ───────── Antártida (AN) ─────────
  { code: 'AQ', pt: 'Antártida',         en: 'Antarctica',       continent: 'AN', aliases: ['Antartida', 'Antarctica'] },
]);

/** Mapa code → entry pra lookup O(1). */
export const COUNTRIES_BY_CODE = Object.freeze(
  Object.fromEntries(COUNTRIES.map(c => [c.code, c]))
);

/**
 * Mapa lowercase (sem normalizar acento) → code.
 * Inclui `pt`, `en` e todos os `aliases`.
 *
 * NOTA: chaves preservam acentos (Renê descobriu em v4.58.9 que
 * lowercase de "África" mantém acento; precisamos das duas formas).
 */
const _nameToCode = (() => {
  const m = {};
  COUNTRIES.forEach(c => {
    const add = (label) => {
      if (!label) return;
      const key = String(label).toLowerCase().trim();
      if (key && !m[key]) m[key] = c.code;
      // Versão sem acento também (defesa contra typos):
      const noAccent = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (noAccent !== key && !m[noAccent]) m[noAccent] = c.code;
    };
    add(c.pt);
    add(c.en);
    if (Array.isArray(c.aliases)) c.aliases.forEach(add);
  });
  return Object.freeze(m);
})();

/**
 * Resolve um label arbitrário ("Brasil", "Brazil", "MX", "México") → ISO code.
 * Retorna null se não bater nada.
 */
export function countryCodeFromLabel(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  // Já é code? (alpha-2 ou GB-XXX)
  const up = raw.toUpperCase();
  if (COUNTRIES_BY_CODE[up]) return up;
  // Por nome (acento ou sem):
  const key = raw.toLowerCase().trim();
  if (_nameToCode[key]) return _nameToCode[key];
  const noAccent = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return _nameToCode[noAccent] || null;
}

/** Helper inverso: code → label pt-BR canônico. */
export function countryLabel(code) {
  return COUNTRIES_BY_CODE[code]?.pt || '';
}

/** Helper inverso: code → label en (pra match Unsplash, Envision). */
export function countryLabelEn(code) {
  return COUNTRIES_BY_CODE[code]?.en || '';
}

/** Helper: code → continent code. */
export function countryContinent(code) {
  return COUNTRIES_BY_CODE[code]?.continent || null;
}

/**
 * Filtra países por continente (code).
 * Útil pra dropdown cascata (continente → países).
 */
export function countriesByContinent(continentCode) {
  if (!continentCode) return [];
  return COUNTRIES.filter(c => c.continent === continentCode);
}
