# Hub Comercial — Núcleo de Saúde

**Robson Menezes Advogados**

Painel de indicadores comerciais e auditoria de leads do Núcleo de Saúde, integrado ao Kommo CRM.

Situação: em implantação. O código da primeira versão está concluído e testado com dados simulados. Falta a ligação com a conta do Kommo do Núcleo de Saúde e a publicação.

---

## 1. Finalidade

O painel consome os dados do Kommo e reconstrói o histórico cronológico de movimentações de cada lead, convertendo o registro estático do CRM em indicadores de eficiência comercial.

O objetivo é identificar em que ponto do funil cada campanha perde oportunidades. Por essa razão, todos os indicadores são apresentados separadamente por campanha, além da visão consolidada.

O sistema deriva do Hub Comercial utilizado pelo núcleo empresarial do escritório e foi adaptado ao protocolo de automações do Núcleo de Saúde.

---

## 2. Escopo

### 2.1 Campanhas acompanhadas

Cada campanha corresponde a um funil próprio no Kommo.

| Código | Campanha | Entrada |
|---|---|---|
| IR-Q | Tema 324/TNU | Questionário do Instagram |
| IR-W | Tema 324/TNU | Conversa iniciada pelo WhatsApp |
| REA-Q | Reajuste abusivo de plano de saúde | Questionário do Instagram |

### 2.2 Etapas do funil

As três campanhas percorrem as mesmas colunas.

| Ordem | Etapa | Função no painel |
|---|---|---|
| 1 | Contato Inicial | Entrada do lead; coluna técnica e transitória |
| 2 | Contato Iniciado | Primeira mensagem enviada; aguardando resposta |
| 3 | Em Qualificação | Lead respondeu; triagem em andamento |
| 4 | Lead Qualificado | Marco de conversão; coluna de passagem |
| 5 | Em Agendamento | Qualificado, ainda sem horário definido |
| 6 | Agendado | Reunião marcada |
| 7 | Remarcação | Ausência ou pedido de remarcação |
| 8 | Protocolo Farmer | Reunião realizada; proposta e formalização |
| 9 | Reaquecimento | Qualificado que deixou de responder após a reunião |
| 10 | Fechado | Contrato e procuração assinados; pagamento inicial confirmado |
| 11 | Desqualificado / Não Fechado | Perda, com motivo obrigatório |

---

## 3. Indicadores

Todos os indicadores são exibidos por campanha (IR-Q, IR-W e REA-Q) e no consolidado.

### 3.1 Volume

- Leads recebidos, contatados e com primeira resposta.
- Qualificados e qualificados sem agendamento.
- Reuniões marcadas, realizadas e não realizadas.
- Remarcações e remarcações recuperadas.
- Entradas no Protocolo Farmer e leads em reaquecimento.
- Contratos fechados.
- Desqualificados, por motivo.

### 3.2 Conversão

| Indicador | Cálculo |
|---|---|
| Taxa de qualificação | Qualificados ÷ Leads recebidos |
| Qualificado para agendado | Qualificados que agendaram ÷ Qualificados |
| Comparecimento | Reuniões realizadas ÷ Reuniões marcadas |
| Remarcação recuperada | Remarcações recuperadas ÷ Entradas em Remarcação |
| Reunião para fechamento | Fechados ÷ Reuniões realizadas |
| Conversão final | Fechados ÷ Leads recebidos |

### 3.3 Tempo

- Da entrada até a primeira mensagem.
- Da primeira mensagem até a primeira resposta do lead.
- Da qualificação até o agendamento.
- Permanência média por etapa.

### 3.4 Registros do protocolo

Indicadores que dependem das etiquetas aplicadas pela automação: reuniões confirmadas, ausências, propostas enviadas e eventos enviados ao TinTin/Meta.

### 3.5 Metas, comparação e responsáveis

- Metas do mês corrente no cabeçalho: contratos fechados, reuniões realizadas e reuniões marcadas. Definidas em `METAS_MENSAIS`, no arquivo `server/config.js`.
- Variação de cada indicador em relação ao período anterior de mesma duração.
- Desempenho por SDR, Closer e Farmer, a partir dos campos de responsável do lead.
- Protocolo Farmer por substatus e situação das reuniões, a partir dos campos de seleção do lead.
- Comparativo por campanha em tabela, em funil lado a lado ou em gráfico por indicador.

### 3.6 Painéis de apoio

- Distribuição dos leads por etapa, no período e na situação atual.
- Conversão entre etapas e destino dos leads a partir de cada etapa.
- Leads ativos sem movimentação.
- Reuniões em aberto, sem desfecho registrado.
- Relação de leads do período, com busca e exportação em CSV.
- Exportação do histórico completo de movimentações, em CSV ou HTML, com ou sem os dados de campanha.

### 3.7 Tráfego e campanhas

Aba própria, com a origem de marketing dos leads:

- Leads, qualificados, reuniões e contratos por conjunto de anúncios, por anúncio e por região.
- Distribuição por estado, em barras ou em mapa, a partir do DDD do telefone.
- Pré-qualificados pelo questionário, por anúncio, conjunto ou campanha: leads cujas respostas, gravadas no Kommo, já atendem ao critério da campanha, separados de quem a equipe qualificou na mão (ver "Pré-qualificação" abaixo).
- Engajamento por etapa de cada conjunto de anúncios e de cada estado.
- Histórico semanal salvo, com orçamento, decisões e observações de cada semana.
- Comparação com a semana anterior e soma de várias semanas.
- Custo por lead, por qualificado e por contrato, calculado a partir do orçamento informado.
- Relatório semanal em HTML, para leitura e impressão.

As regras de contagem e as limitações de cada indicador estão documentadas no próprio painel, no endereço `/documentacao`.

**Pré-qualificação.** "Qualificado" continua sendo só o lead que a equipe moveu para Lead Qualificado. "Pré-qualificado" lê as respostas do questionário nos campos do lead no Kommo, antes de qualquer contato:

| Campanha | Critério |
|---|---|
| Reajuste (REA-Q) | Plano Empresarial/CNPJ ou Familiar, e mensalidade acima de R$ 2.000. "Recebeu aumento recentemente" é mostrado à parte e não decide nada. |
| IR (IR-Q e IR-W) | Responde "sim" sobre filho com deficiência e sobre escola particular, e mensalidade acima de R$ 950. A faixa de R$ 900 a R$ 1.500 fica **pendente**, pois falta confirmar se passa de R$ 950. |

Cada lead cai em uma de quatro situações: pré-qualificado, pendente, não qualificado ou sem respostas (nenhum critério respondido, caso comum nos leads de WhatsApp). A seção mostra os números por anúncio, conjunto, campanha do Meta ou campanha do núcleo, ao lado dos qualificados pela equipe e da fila de **pré-qualificados em triagem** (ainda em Contato Inicial, Contato Iniciado ou Em Qualificação). Clicar em um número abre os leads com as respostas e o parecer de cada um.

As regras ficam em `PRE_QUALIFICACAO`, em `server/config.js`. Cada critério localiza o campo do Kommo pelo ID (`campo.id`) ou, sem ele, pelo nome (`campo.nome`). A seção mostra, em cada campanha, qual campo foi lido; se um campo não for encontrado, aparece um aviso, e a rota `GET /api/diagnostico/campos` lista os campos e IDs da conta para preencher a configuração.

### 3.8 Fora do escopo desta versão

- Importação automática do investimento a partir do Meta. O orçamento é informado manualmente por semana.
- Medição dos SLAs em horas úteis.

---

## 4. Arquitetura

```
├── client/                 Interface: HTML e JavaScript, sem framework
│   ├── index.html
│   ├── app.js              Aba do funil, exportações e correção de eventos
│   ├── trafego.js          Aba de tráfego e campanhas
│   ├── pre-qualificados.js  Seção de pré-qualificados da aba de tráfego
│   ├── relatorio-semanal.js  Relatórios em HTML para download
│   ├── mapa-brasil.js      Mapa por estado
│   ├── documentacao.html   Metodologia de cálculo dos indicadores
│   └── estilos.css         Gerado por "npm run build:css"; não editar
├── worker/
│   └── index.js            Worker do Cloudflare: valida o acesso e repassa /api ao servidor
├── server/                 API em Node.js e Express
│   ├── server.js           Rotas e controle de acesso
│   ├── config.js           Funis, etapas, campos e etiquetas do Kommo
│   ├── kommo.js            Cliente da API do Kommo (leitura; grava etapa, responsáveis, descrição, anexos e notas do lead)
│   ├── mapeamento.js       Associação entre colunas do Kommo e etapas do painel
│   ├── leads.js            Normalização de leads e eventos
│   ├── metricas.js         Cálculo dos indicadores do funil
│   ├── trafego.js          Análise de tráfego, custo e soma de semanas
│   ├── prequalificacao.js  Pré-qualificação pelas respostas do questionário
│   ├── localizacao.js      Estado e região a partir do DDD
│   ├── armazenamento.js    Exclusões, correções e semanas salvas (Upstash)
│   ├── dev/                Kommo simulado, com dados fictícios
│   └── test/
├── estilos/entrada.css     Fonte dos estilos
├── docs/implantacao.md     Guia de implantação
├── wrangler.jsonc          Configuração do Cloudflare Workers
└── render.yaml             Configuração do serviço no Render
```

| Camada | Serviço | Observação |
|---|---|---|
| Interface | Cloudflare Workers (Static Assets) | Publicação automática a cada alteração na branch `main` |
| Repasse | Cloudflare Workers | Valida o token do Cloudflare Access e acrescenta o token da API |
| API | Render | Consulta e processa a API v4 do Kommo |
| Persistência | Upstash Redis | Armazena exclusões e correções de eventos e as semanas salvas de tráfego |
| Controle de acesso | Cloudflare Access | Autenticação por e-mail, validada antes da entrega da página |

Todos os serviços são utilizados no plano gratuito.

---

## 5. Mapeamento do Kommo

Funis, etapas, campos personalizados e etiquetas são definidos em `server/config.js`. É o único arquivo a editar quando a estrutura do Kommo mudar.

Enquanto os identificadores não forem preenchidos, o servidor localiza os funis e as colunas pelo nome. O preenchimento dos IDs é recomendado, pois eles não mudam quando uma coluna é renomeada. Havendo funil ou etapa não localizados, o painel exibe um aviso com as pendências.

Rotas de apoio à configuração:

| Rota | Conteúdo |
|---|---|
| `GET /api/diagnostico/funis` | Funis e colunas da conta, com IDs e a etapa associada a cada coluna |
| `GET /api/diagnostico/campos` | Campos personalizados de lead, com IDs |
| `GET /api/diagnostico/lead/:id` | Campos brutos de um lead |
| `GET /api/situacao` | Situação da configuração |

---

## 6. Correção de movimentações indevidas

O Kommo não permite excluir nem editar eventos de mudança de etapa. Quando um lead é movido por engano, o evento permanece no histórico e distorce os indicadores.

O painel permite excluir um evento do cálculo ou corrigir a etapa e o horário registrados, sem qualquer alteração no Kommo. As marcações são armazenadas no Upstash Redis, registram o usuário e a data e podem ser revertidas.

Esse recurso destina-se exclusivamente a movimentações indevidas. Não deve ser utilizado para omitir desfechos reais.

---

## 7. Implantação e execução

O passo a passo de publicação está em [`docs/implantacao.md`](./docs/implantacao.md).

### 7.1 Requisitos

- Node.js 18 ou superior.
- Token de API do Kommo.
- Contas no Cloudflare, no Render e no Upstash.

### 7.2 Variáveis de ambiente do servidor

O modelo está em `server/.env.exemplo`.

| Variável | Finalidade |
|---|---|
| `KOMMO_SUBDOMAIN` | Subdomínio da conta do Kommo |
| `KOMMO_TOKEN` | Token de acesso à API do Kommo |
| `API_TOKEN` | Token exigido em todas as rotas `/api` |
| `UPSTASH_REDIS_REST_URL` | Endereço do banco no Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Token do banco no Upstash |
| `GOOGLE_CONTA_DE_SERVICO` | Opcional. Chave JSON da conta de serviço do Google Cloud, com delegação em todo o domínio no Workspace (escopo `https://www.googleapis.com/auth/calendar.events`). Liga a criação do evento da reunião na agenda da closer |
| `AGENDAS_DAS_CLOSERS` | Opcional. E-mails das agendas das closers, em JSON (`{"Nome oficial": "email"}`), quando não estiverem em `RESPONSAVEIS` no `config.js` |

O arquivo `.env` não deve ser enviado ao repositório.

### 7.3 Execução local com dados fictícios

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

O painel fica disponível em `http://localhost:3001`.

### 7.4 Testes

```bash
npm install
npm test
```

---

## 8. Segurança e privacidade

- O token do Kommo não é exposto ao navegador. Todas as consultas ao CRM são feitas pelo servidor.
- A API recusa qualquer chamada sem o token definido em `API_TOKEN`. Esse token fica guardado no Worker e no servidor, e não consta do código nem do navegador.
- O Worker só repassa uma chamada à API depois de validar a assinatura do token emitido pelo Cloudflare Access.
- O painel é entregue somente a e-mails autorizados na política do Cloudflare Access.
- Os dados exibidos referem-se a potenciais clientes do escritório e devem ser tratados em conformidade com a LGPD.

---

## 9. Licença

Uso interno. Robson Menezes Advogados. Todos os direitos reservados.

---

## 10. Responsável técnico

Diogo Nascimento

Desenvolvido por [diogocoding](https://github.com/diogocoding).
