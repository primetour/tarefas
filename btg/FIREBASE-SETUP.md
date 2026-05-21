# Firebase Setup — Lab BTG

> Passo-a-passo pra ativar o Firestore neste lab. Leva ~10 minutos.

---

## 1. Criar projeto Firebase de staging

1. Acesse https://console.firebase.google.com
2. **Criar projeto** → nome: `primetour-btg-lab` (ou similar)
3. **Desative** Google Analytics (não precisa pro POC)
4. Aguarde o projeto provisionar (~30s)

## 2. Habilitar Firestore

1. No projeto criado: **Build → Firestore Database**
2. **Create database** → começar em **modo produção**
3. Localização: `southamerica-east1 (São Paulo)`
4. **Enable**

## 3. Habilitar Auth (pro SSO)

1. **Build → Authentication → Get started**
2. Sign-in providers → **Microsoft**:
   - Application ID: do seu Azure AD (se já usa SSO no gestor, já tem)
   - Pode usar o mesmo tenant do gestor
3. Alternativa pro POC: habilita **Email/Password** temporariamente

## 4. Pegar a config

1. ⚙ **Configurações do projeto** → **Seus apps**
2. **Adicionar app → Web**:
   - Nickname: `btg-lab-web`
   - Não precisa Hosting
3. Copie o objeto `firebaseConfig`:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "primetour-btg-lab.firebaseapp.com",
  projectId: "primetour-btg-lab",
  storageBucket: "primetour-btg-lab.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

## 5. Colar no `js/config.js`

Abra `gestor-btg-lp-builder-lab-main/js/config.js` e substitua o objeto `firebaseConfig` exportado pelos valores reais (mantenha o `export const firebaseConfig = {...}`).

## 6. Aplicar Firestore Rules

1. Firebase Console → **Firestore → Rules**
2. Substitua o conteúdo pelo arquivo `firestore.rules` do lab (já atualizado com a coleção `ofertas_btg_lab` no final)
3. **Publicar**

## 7. (Opcional) Criar índices compostos

Pras queries com múltiplos filtros (`tipo_cartao` + `tipo_oferta` + `status` + `createdAt`), o Firestore vai pedir índices quando rodar a primeira consulta. Tem 2 caminhos:

**a) Deixar criar automático na hora**: na primeira consulta o console mostra erro com um link "Create index" — clica e tá pronto. Demora ~1 min cada.

**b) Pré-criar via `firestore.indexes.json`** (a config já tá no `btg/FIRESTORE-SCHEMA.md`).

## 8. Verificar

1. Recarregue http://localhost:8000/btg/ — badge no card "Status" deve virar **verde** ✓ Firestore conectado
2. Acesse `/btg/dashboard/nova-oferta/` — badge canto superior direito também verde
3. Preencha uma oferta de teste e clique **Publicar**
4. Console do Firebase → Firestore → coleção `ofertas_btg_lab` → vai aparecer o doc
5. Volte na home da marca correspondente — a oferta tá lá

## Troubleshooting

**"Missing or insufficient permissions"**: as rules não foram publicadas, ou o usuário não está autenticado. Pro POC inicial pode afrouxar pra `allow read: if true; allow write: if true;` temporariamente.

**Index missing**: o erro aparece no console com link "Create the missing index here". Clica e espera 1-2 min.

**Badge continua amarelo**: refresh forçado (Cmd+Shift+R). Se persistir, abra DevTools → Console e veja se há `[btg-lab] Firebase config sanitizada` — significa que o `js/config.js` ainda tem os placeholders.

## Limpeza ao final do POC

Quando finalizar o teste e quiser zerar tudo:
- Console Firebase → Firestore → coleção `ofertas_btg_lab` → deletar
- Ou criar um botão "Limpar tudo" no admin (não implementado ainda)
