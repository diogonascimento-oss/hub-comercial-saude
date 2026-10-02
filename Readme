# Hub Comercial — Núcleo de Saúde

**Robson Menezes Advogados**

Painel de indicadores comerciais e auditoria de leads do Núcleo de Saúde, integrado ao Kommo CRM.

Situação: em implantação. Este documento descreve o escopo da primeira versão. Os itens indicados como "a preencher" serão completados à medida que a configuração da conta do Kommo for concluída.

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
- Reuniões marcadas, confirmadas e realizadas.
- Ausências, remarcações e remarcações recuperadas.
- Propostas enviadas e leads em reaquecimento.
- Contratos fechados.
- Desqualificados, por motivo.

### 3.2 Conversão

| Indicador | Cálculo |
|---|---|
| Taxa de qualificação | Qualificados ÷ Leads recebidos |
| Qualificado para agendado | Reuniões marcadas ÷ Qualificados |
| Comparecimento | Reuniões realizadas ÷ Reuniões marcadas |
| Remarcação recuperada | Remarcações realizadas ÷ Leads em remarcação |
| Reunião para fechamento | Fechados ÷ Reuniões realizadas |
| Conversão final | Fechados ÷ Leads recebidos |

### 3.3 Tempo

- Da entrada até a primeira mensagem.
- Da primeira mensagem até a primeira resposta do lead.
- Da qualificação até o agendamento.
- Permanência média por etapa.

### 3.4 Painéis de apoio

- Distribuição dos leads por etapa, com tempo médio de permanência.
- Conversão entre etapas e destino dos leads a partir de cada etapa.
- Leads ativos sem movimentação.
- Reuniões em aberto, sem desfecho registrado.
- Alerta de qualidade de dados: leads sem nome, telefone ou campanha.
- Relação de leads do período, com busca e exportação em CSV.

A metodologia de cálculo de cada indicador é documentada no próprio painel, no endereço `/documentacao`.

---

## 4. Arquitetura

```
├── client/                Interface: HTML, JavaScript e Tailwind, sem etapa de build
│   ├── index.html
│   ├── app.js
│   └── documentacao.html  Metodologia de cálculo dos indicadores
└── server/                API em Node.js e Express: motor analítico
    ├── server.js
    └── package.json
```

| Camada | Serviço | Observação |
|---|---|---|
| Interface | Cloudflare Workers (Static Assets) | Publicação automática a cada alteração na branch `main` |
| API | Render | Consulta e processa a API v4 do Kommo |
| Persistência | Upstash Redis | Armazena somente exclusões e correções de eventos |
| Controle de acesso | Cloudflare Access | Autenticação por e-mail, validada antes da entrega da página |

---

## 5. Mapeamento do Kommo

Os identificadores de funis, etapas e campos personalizados são definidos no início do arquivo `server.js`.

| Funil | Identificador |
|---|---|
| IR-Q | a preencher |
| IR-W | a preencher |
| REA-Q | a preencher |

A rota `GET /api/campos-lead` lista os campos personalizados da conta com os respectivos identificadores.

---

## 6. Correção de movimentações indevidas

O Kommo não permite excluir nem editar eventos de mudança de etapa. Quando um lead é movido por engano, o evento permanece no histórico e distorce os indicadores.

O painel permite excluir um evento do cálculo ou corrigir a etapa e o horário registrados, sem qualquer alteração no Kommo. As marcações são armazenadas no Upstash Redis e podem ser revertidas.

Esse recurso destina-se exclusivamente a movimentações indevidas. Não deve ser utilizado para omitir desfechos reais.

---

## 7. Configuração

### 7.1 Requisitos

- Node.js 18 ou superior.
- Token de API do Kommo.
- Contas no Cloudflare, no Render e no Upstash.

### 7.2 Instalação

```bash
cd server
npm install
```

### 7.3 Variáveis de ambiente

Criar o arquivo `server/.env`:

```env
KOMMO_TOKEN=
KOMMO_SUBDOMAIN=
PORT=3001
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

O arquivo `.env` não deve ser enviado ao repositório.

### 7.4 Execução

```bash
cd server
npm start
```

---

## 8. Segurança e privacidade

- O token do Kommo não é exposto ao navegador. Todas as consultas ao CRM são intermediadas pelo servidor.
- O painel é entregue somente a e-mails autorizados na política do Cloudflare Access.
- Os dados exibidos referem-se a potenciais clientes do escritório e devem ser tratados em conformidade com a LGPD.

---

## 9. Licença

Uso interno. Robson Menezes Advogados. Todos os direitos reservados.

---

## 10. Responsável técnico

Diogo Nascimento
