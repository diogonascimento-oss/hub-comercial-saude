# Guia de implantação

Hub Comercial — Núcleo de Saúde

Este guia descreve a publicação do painel com contas gratuitas. Todas as contas devem ser criadas com o e-mail corporativo. O repositório permanece na conta empresarial do GitHub.

---

## 1. Visão geral

| Componente | Serviço | Função |
|---|---|---|
| Interface e Worker de repasse | Cloudflare Workers | Entrega a página e encaminha as chamadas `/api` ao servidor |
| Controle de acesso | Cloudflare Access | Exige login por e-mail antes de entregar a página |
| API | Render | Consulta o Kommo e calcula os indicadores |
| Persistência | Upstash Redis | Guarda exclusões e correções de eventos |

Fluxo de uma consulta: navegador, Cloudflare Access, Worker, Render, Kommo.

O servidor no Render recusa qualquer chamada sem o token secreto. Esse token fica guardado no Worker e no Render, nunca no navegador nem no repositório.

---

## 2. Ordem recomendada

1. Upstash: criar o banco.
2. Render: publicar a API.
3. Cloudflare: publicar o Worker e a interface.
4. Cloudflare Access: restringir o acesso.
5. Cloudflare: cadastrar os segredos do Worker.
6. Conferir o mapeamento do Kommo.

---

## 3. Token da API

Gerar um valor aleatório, uma única vez, e guardá-lo em local seguro. Ele será informado no Render (item 5) e no Cloudflare (item 8).

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Alternativa sem Node: `openssl rand -hex 32`.

---

## 4. Upstash

1. Criar uma conta em upstash.com com o e-mail corporativo.
2. Criar um banco Redis no plano gratuito, na região mais próxima da escolhida no Render.
3. Na página do banco, seção "REST API", copiar `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.

---

## 5. Render

1. Criar uma conta em render.com com o e-mail corporativo e conectá-la à conta empresarial do GitHub.
2. Escolher "New", "Blueprint" e selecionar este repositório. O arquivo `render.yaml` define o serviço.
3. Preencher as variáveis solicitadas:

| Variável | Valor |
|---|---|
| `KOMMO_SUBDOMAIN` | Subdomínio da conta do Kommo (em `https://SUBDOMINIO.kommo.com`, apenas a parte `SUBDOMINIO`) |
| `KOMMO_TOKEN` | Token de longa duração de uma integração privada do Kommo |
| `API_TOKEN` | Valor gerado no item 3 |
| `UPSTASH_REDIS_REST_URL` | Copiado do Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Copiado do Upstash |

4. Aguardar a publicação e anotar o endereço do serviço, no formato `https://nome-do-servico.onrender.com`.
5. Conferir: abrir o endereço no navegador deve exibir "servidor ativo". Abrir `/api/situacao` deve exibir "Acesso não autorizado", o que confirma que a API está protegida.

Observação: no plano gratuito o servidor hiberna após cerca de 15 minutos sem uso. A primeira consulta seguinte leva perto de um minuto, e o painel exibe um aviso durante a espera.

---

## 6. Cloudflare Workers

1. Criar uma conta em cloudflare.com com o e-mail corporativo.
2. Em "Workers & Pages", escolher "Create", "Import a repository" e conectar a conta empresarial do GitHub.
3. Selecionar este repositório e manter:

| Campo | Valor |
|---|---|
| Nome do projeto | `saude` |
| Build command | `npm run build:css` |
| Deploy command | `npx wrangler deploy` |
| Diretório raiz | `/` |

4. Concluir. A partir daí, cada alteração na branch `main` é publicada automaticamente.

Neste momento a página abre, mas as chamadas à API ainda são recusadas, porque faltam o Access e os segredos.

---

## 7. Cloudflare Access

1. No painel do Worker, em "Settings", "Domains & Routes", ativar "Cloudflare Access" para o endereço `workers.dev`. Na primeira vez, o Cloudflare pede a criação de uma equipe Zero Trust (plano gratuito) e define o domínio da equipe, no formato `nome-da-equipe.cloudflareaccess.com`.
2. Em "Zero Trust", "Access", "Applications", abrir a aplicação criada e ajustar a política para permitir somente os e-mails autorizados.
3. Na mesma aplicação, copiar o valor "Application Audience (AUD) Tag".
4. Manter os endereços de pré-visualização ("Preview URLs") desativados. Eles ficam fora da política de acesso.

---

## 8. Segredos do Worker

No painel do Worker, em "Settings", "Variables and Secrets", adicionar quatro itens do tipo "Secret":

| Nome | Valor |
|---|---|
| `API_ORIGEM` | Endereço do serviço no Render, sem barra no final |
| `API_TOKEN` | Mesmo valor informado no Render |
| `ACCESS_TEAM_DOMAIN` | Domínio da equipe, por exemplo `nome-da-equipe.cloudflareaccess.com` |
| `ACCESS_AUD` | "Application Audience (AUD) Tag" copiada no item 7 |

O tipo deve ser "Secret", e não "Text". Os valores não devem ser copiados para o arquivo `wrangler.jsonc`, mesmo que o painel do Cloudflare sugira: o token da API ficaria exposto no repositório.

O Worker valida, a cada chamada, a assinatura do token emitido pelo Access. Sem os quatro segredos ele recusa as chamadas e informa quais faltam.

---

## 9. Mapeamento do Kommo

1. Abrir o painel. Se a configuração estiver incompleta, um aviso no topo lista as pendências.
2. Abrir `/api/diagnostico/funis` no mesmo endereço do painel. A resposta lista os funis e colunas da conta, com os IDs e a etapa a que cada coluna foi associada.
3. Copiar os IDs para `server/config.js` (`pipelineId` de cada campanha e o ID de cada etapa). O servidor localiza funis e colunas pelo nome enquanto os IDs estiverem vazios, mas os IDs são a forma estável: não mudam se alguém renomear uma coluna.
4. Para o motivo de desqualificação e os campos de origem (campanha, conjunto e anúncio), consultar `/api/diagnostico/campos` e preencher `CAMPOS` em `server/config.js`.

---

## 10. Verificação final

| Verificação | Resultado esperado |
|---|---|
| Abrir o painel em janela anônima | Tela de login do Cloudflare Access |
| Entrar com e-mail autorizado | Painel carregado, sem aviso de configuração incompleta |
| Abrir o endereço do Render seguido de `/api/metrics` | "Acesso não autorizado" |
| Alterar um arquivo na branch `main` | Nova versão publicada em poucos minutos nos dois serviços |

---

## 11. Integração com o Meta (opcional)

Permite importar, por semana salva, o valor efetivamente investido em cada anúncio. Sem ela, o custo continua sendo calculado pelo orçamento diário informado manualmente.

1. Em `developers.facebook.com`, criar um aplicativo do tipo "Empresa", vinculado ao Gerenciador de Negócios do escritório, e adicionar o produto "API de Marketing".
2. Em `business.facebook.com`, em "Configurações do negócio", "Usuários", "Usuários do sistema", criar um usuário do sistema.
3. Em "Atribuir ativos", conceder a esse usuário acesso de leitura à conta de anúncios.
4. Em "Gerar token", selecionar o aplicativo, marcar a permissão `ads_read` e escolher a opção sem expiração.
5. No Render, em "Environment", cadastrar:

| Variável | Valor |
|---|---|
| `META_TOKEN` | Token gerado no passo 4 |
| `META_CONTA_ANUNCIOS` | Identificador da conta de anúncios, no formato `act_1234567890` |

6. Aguardar o serviço reiniciar. Em `/api/situacao`, o campo `metaConfigurado` deve constar como `true`.
7. No painel, na aba "Tráfego e campanhas", abrir uma semana salva em "Gerenciar" e usar "Importar valor investido do Meta".

O token não deve ser registrado no repositório nem enviado por mensagem. A associação entre o investimento e os leads é feita pelo nome do anúncio e do conjunto; por isso os campos correspondentes do lead, no Kommo, precisam ser preenchidos com os mesmos nomes usados no Meta.

---

## 12. Desenvolvimento local

```bash
cd server
npm install
node dev/kommo-simulado.js
```

Em outro terminal:

```bash
cd server
KOMMO_BASE_URL=http://localhost:4010/api/v4 KOMMO_TOKEN=teste MODO_LOCAL=true node server.js
```

O painel fica disponível em `http://localhost:3001`, com dados fictícios. `MODO_LOCAL` dispensa o token e faz o servidor entregar a interface; não deve ser usado em produção.

Para usar a conta real do Kommo localmente, copiar `server/.env.exemplo` para `server/.env`, preencher os valores e manter `MODO_LOCAL=true`.

Após alterar classes de estilo em `client/`, executar `npm run build:css` na raiz. Testes: `npm test` na raiz.
