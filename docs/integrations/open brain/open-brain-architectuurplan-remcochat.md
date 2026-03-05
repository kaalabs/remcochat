# Architectuurplan Open Brain voor RemcoChat

Versie: 1.0  
Datum: 2026-03-05  
Status: Werkdocument / richtinggevend ontwerp

## Doel

Dit document legt het architectuurplan vast voor een **private Open Brain** die uitsluitend draait op het lokale netwerk en via het gereguleerde Tailnet. Het ontwerp is afgeleid van de kernconcepten uit de Open Brain-gids van Nate B. Jones — één canonieke geheugenlaag, vector search, open read/write en workflow-ondersteuning — maar aangepast aan de randvoorwaarden van jouw omgeving:

- **geen Slack** als capture-interface;
- **geen OpenRouter-afhankelijkheid**;
- **geen publieke endpoints**;
- **RemcoChat** als primaire gebruikersinterface en agent;
- **eigen home-infrastructuur** als enige runtime-omgeving.

De architectuur is daarom **REST-first**, **private-by-default** en **gateway-agnostisch**.

---

## 1. Executive summary

De kernbeslissing is dat **Open Brain een aparte service wordt naast RemcoChat**, en **niet** een uitbreiding van RemcoChat’s interne SQLite-opslag.

RemcoChat blijft verantwoordelijk voor:

- de chat-UX;
- modelselectie en toolgebruik;
- expliciete capture-acties;
- zoek- en reviewacties richting Open Brain.

Open Brain wordt verantwoordelijk voor:

- canonieke opslag van kennisitems;
- vector-indexering;
- semantische retrieval;
- metadata-verrijking;
- imports en migraties;
- periodieke reviews.

De canonieke backbone bestaat uit:

- **Open Brain API** als domeinservice;
- **Postgres + pgvector** als datastore;
- **worker/jobs** voor embeddings, metadata en reviews;
- **REST/OpenAPI** als contract tussen clients en service.

Een **interne MCP-adapter** kan later worden toegevoegd, maar is **niet** de kern van de architectuur.

---

## 2. Ontwerpgrondslagen

### 2.1 Private by default

Alle componenten draaien uitsluitend op **LAN/Tailnet**. Er zijn geen publieke write- of read-endpoints. Jouw publieke website maakt **geen deel uit van het kritieke datapad**.

### 2.2 Open Brain is een gedeeld geheugen, geen chatdatabase

De Open Brain-gids positioneert de oplossing als een database met vector search en een open protocol, niet als een notes-app.[^guide] In deze variant betekent dat:

- RemcoChat **gebruikt** het geheugen;
- Open Brain **is** het geheugen;
- RemcoChat’s SQLite blijft app-specifieke opslag;
- Open Brain krijgt een eigen datastore en eigen lifecycle.

### 2.3 REST-first als canoniek contract

De interne protocol-laag wordt een gewone HTTP-API met een formeel contract. OpenAPI is juist bedoeld als machineleesbare beschrijving van HTTP-API’s en is daarom geschikt als stabiele, taalagnostische servicegrens.[^openapi]

### 2.4 Embeddings zijn de primaire retrievallaag

De oorspronkelijke Open Brain-gids maakt duidelijk dat **embeddings de retrievalkracht leveren** en dat metadata een convenience-laag is voor filtering en samenvatting.[^guide] Dat blijft in dit ontwerp leidend:

- **semantic search** is canoniek;
- metadata is ondersteunend;
- slechte classificatie mag zoekbaarheid niet breken.

### 2.5 LLM’s horen aan de rand, niet in het midden

De deterministische kern bestaat uit API, database, vector search en jobs. LLM’s worden alleen ingezet voor:

- embeddings;
- metadata-extractie;
- samenvatting en review;
- chat in RemcoChat.

### 2.6 Explicit capture boven volledige transcript-mirroring

De MVP slaat **niet automatisch alle chats** op. Capture is bewust en expliciet:

- “Save to Brain” op een user message;
- “Save answer to Brain” op een assistentantwoord;
- capture-templates zoals besluit, persoon, project, inzicht, follow-up.

### 2.7 Promptkit als workflowlaag bovenop de infrastructuur

De companion promptkit bevat vijf workflows: memory migration, second-brain migration, spark, quick capture templates en weekly review.[^promptkit] In deze architectuur worden die vertaald naar **RemcoChat skills en Open Brain workflows**, niet naar losse SaaS-prompts.

---

## 3. Doelarchitectuur

```text
[LAN / Tailnet only]

Gebruiker
   ↓
RemcoChat
   ├─ Chat-LLM
   ├─ Save to Brain
   ├─ Search Brain
   ├─ Weekly Review
   ├─ Brain skills / templates
   └─ openBrainGateway
            ↓
Open Brain API (REST/OpenAPI)
   ├─ captures
   ├─ items
   ├─ search
   ├─ recent
   ├─ stats
   ├─ reviews
   └─ imports
            ↓
Postgres + pgvector
            ↑
Open Brain Worker
   ├─ embedding jobs
   ├─ metadata extraction jobs
   ├─ review jobs
   ├─ import jobs
   └─ re-index jobs

Optioneel later:
- interne MCP adapter
- private dashboard/admin UI
```

---

## 4. Componenten en verantwoordelijkheden

### 4.1 RemcoChat

RemcoChat is een minimale chat-UI voor local/home network gebruik, met een lokale SQLite-database, extensies via skills en server-side tools, en providerconfiguratie via `base_url`, `api_key_env` en toegestane modellen.[^remcochat-readme] [^remcochat-config]

In deze architectuur krijgt RemcoChat vier rollen:

1. **primaire gebruikersinterface**;
2. **capture-client** voor Open Brain;
3. **zoekclient** voor Open Brain;
4. **workflow-host** voor review-, migratie- en capture-skills.

RemcoChat schrijft **niet** rechtstreeks in de Open Brain-database. Alle interactie loopt via de Open Brain API.

#### Gewenste uitbreidingen in RemcoChat

- UI action: **Save to Brain**
- UI action: **Save answer to Brain**
- UI action: **Search Brain**
- UI action: **Run Weekly Review**
- server tool: **openBrainGateway**
- skills:
  - `open-brain-memory-migration`
  - `open-brain-second-brain-migration`
  - `open-brain-spark`
  - `open-brain-capture-templates`
  - `open-brain-weekly-review`

### 4.2 Open Brain API

Dit is de canonieke domeinservice. De API biedt één stabiele interne interface voor:

- captures;
- retrieval;
- itembeheer;
- reviews;
- imports;
- beheeroperaties.

Belangrijke eigenschap: de API accepteert requests ook wanneer de AI-verrijkingslaag tijdelijk niet beschikbaar is. De kernfunctie “opslaan” mag dus niet volledig afhangen van een generatieve LLM.

### 4.3 Open Brain Worker

De worker verwerkt asynchrone taken:

- embeddinggeneratie;
- metadata-extractie;
- batch imports;
- weekly reviews;
- re-embedding / herindexering.

De worker werkt job-gedreven, zodat de API snel kan bevestigen en zware verwerking buiten de request-latency blijft.

### 4.4 Postgres + pgvector

De datastore combineert relationele opslag en vector search in één systeem. pgvector voegt vectoropslag en nearest-neighbor querymogelijkheden toe aan Postgres.[^pgvector]

Voordelen voor deze context:

- één canonieke datastore;
- eenvoudige back-ups;
- duidelijke transactionele grenzen;
- metadata en vectors blijven bij elkaar;
- geen extra zoekengine nodig voor de MVP.

### 4.5 Optionele interne dashboardlaag

Later kan een beperkte private UI worden toegevoegd voor:

- recente captures;
- reviewresultaten;
- import-runs;
- foutmeldingen;
- re-index beheer.

Die UI hoort achter Tailnet / interne reverse proxy en is **geen publiek productoppervlak**.

### 4.6 Optionele interne MCP-adapter

MCP blijft een mogelijke **interne compatibiliteitslaag** voor andere interne agents, maar niet de canonieke backbone. Een eventuele adapter vertaalt MCP-tools naar bestaande REST-calls.

---

## 5. Waar zit de LLM?

De LLM zit in deze architectuur **niet in het midden**, maar op specifieke randen.

```text
RemcoChat
  ├─ Chat-LLM                    ← gesprek, redenering, toolselectie
  └─ Open Brain client
           ↓
Open Brain API
           ↓
Worker / model-adapters
  ├─ Embedding model            ← vectoren voor captures en queries
  ├─ Metadata LLM               ← classificatie en extractie
  └─ Review LLM                 ← synthese en weekly review
           ↓
Postgres + pgvector
```

### 5.1 Chat-LLM in RemcoChat

Dit model voert het gesprek met de gebruiker, kiest tools en formuleert antwoorden. Het **is niet** de opslaglaag en **is niet** de bron van waarheid.

### 5.2 Embeddingmodel in Open Brain

Dit model genereert vectoren voor:

- nieuwe captures;
- zoekvragen;
- eventueel later ook imports en herindexering.

De database voert daarna de eigenlijke similarity search uit.

### 5.3 Metadata-LLM in Open Brain

Dit model extraheert optioneel:

- type item;
- betrokken personen;
- projecten;
- actiepunten;
- compacte labels;
- korte samenvattingen.

Deze laag mag degraderen zonder dat de basisopslag of zoekbaarheid verdwijnt.

### 5.4 Review-LLM in Open Brain

Dit model maakt syntheses over verzamelingen items, bijvoorbeeld voor:

- weekly review;
- thematische overzichten;
- migratie-opschoning;
- samenvatting van zoekresultaten.

---

## 6. Datamodel

De opslaglaag wordt tweelaags opgebouwd: **items** en **chunks**. Daarmee kunnen korte captures en langere imports via dezelfde retrievalketen lopen.

### 6.1 `brain_items`

Canonieke business-entiteit.

Aanbevolen velden:

- `id` UUID
- `kind` enum (`thought`, `decision`, `person_note`, `project_note`, `review`, `imported_note`, ...)
- `source_system` (`remcochat`, `import`, `manual`, ...)
- `source_ref` JSONB
- `title` nullable
- `content_raw` TEXT
- `content_normalized` TEXT
- `metadata` JSONB
- `capture_status` (`pending`, `ready`, `partial`, `failed`)
- `dedupe_hash`
- `captured_at`
- `created_at`
- `updated_at`
- `deleted_at`

### 6.2 `brain_chunks`

Voor chunking van langere items.

Aanbevolen velden:

- `id` UUID
- `item_id` FK
- `chunk_index`
- `text`
- `token_count`
- `chunk_hash`

### 6.3 `brain_embeddings`

Vectorindex per chunk.

Aanbevolen velden:

- `chunk_id` FK
- `embedding_model`
- `embedding_dim`
- `embedding_version`
- `vector` (`vector(n)`)
- `created_at`

### 6.4 `brain_reviews`

Opslag van periodieke reviews.

Aanbevolen velden:

- `id`
- `period_start`
- `period_end`
- `status`
- `summary_markdown`
- `themes` JSONB
- `action_items` JSONB

### 6.5 `brain_jobs`

Asynchrone verwerking en retries.

Aanbevolen velden:

- `id`
- `job_type`
- `payload` JSONB
- `status`
- `retry_count`
- `last_error`
- `created_at`
- `started_at`
- `finished_at`

### 6.6 `brain_events`

Audit-log van belangrijke mutaties.

Aanbevolen velden:

- `id`
- `event_type`
- `item_id`
- `actor_type`
- `actor_ref`
- `payload`
- `created_at`

### 6.7 Belangrijke ontwerpregels

- Metadata is **niet** de bron van waarheid.
- Eén item kan uit meerdere chunks bestaan.
- Embeddings zijn **versioneerbaar**.
- De API werkt met **idempotency** om duplicaten te voorkomen.
- Deletes zijn bij voorkeur **soft deletes** in v1.

---

## 7. REST-first API-ontwerp

### 7.1 Principes

- OpenAPI-contract is leidend.
- HTTP/JSON is de primaire transportlaag.
- Interne clients gebruiken dezelfde API.
- Idempotency is verplicht voor capture-calls.
- Admin-operaties worden logisch gescheiden van gewone read/write-calls.

### 7.2 Kernendpoints

#### `POST /v1/captures`

Slaat een nieuw item op en start verrijking.

Voorbeeldrequest:

```json
{
  "content": "Besloten om Open Brain als aparte service naast RemcoChat te bouwen.",
  "kind": "decision",
  "source": {
    "system": "remcochat",
    "conversation_id": "c_123",
    "message_id": "m_456",
    "role": "user"
  },
  "labels": ["architecture", "open-brain"],
  "idempotency_key": "sha256:...",
  "options": {
    "extract_metadata": true,
    "generate_embedding": true,
    "mode": "interactive"
  }
}
```

Mogelijke responsen:

- `201 Created` — item klaar voor gebruik;
- `202 Accepted` — item opgeslagen, verrijking loopt nog;
- `409 Conflict` — idempotency key bestaat al;
- `422 Unprocessable Entity` — input valide maar onbruikbaar.

#### `POST /v1/search`

Semantische zoekactie over de knowledge store.

Voorbeeldrequest:

```json
{
  "query": "Wat heb ik al vastgelegd over architectuur van Open Brain?",
  "limit": 10,
  "threshold": 0.28,
  "filters": {
    "kinds": ["decision", "thought", "project_note"],
    "source_systems": ["remcochat", "import"],
    "captured_after": "2026-01-01T00:00:00Z"
  }
}
```

#### `GET /v1/recent`

Haalt recent opgeslagen items op, eventueel gefilterd.

#### `GET /v1/stats`

Geeft compacte statistieken terug, bijvoorbeeld:

- aantal items;
- aantallen per type;
- aantallen per bron;
- laatste capture;
- reviewdekking.

#### `GET /v1/items/{id}`

Leest één item inclusief metadata, chunk-info en status.

#### `PATCH /v1/items/{id}`

Beperkte handmatige correcties, zoals labels of titel.

#### `DELETE /v1/items/{id}`

Soft delete voor foutieve of ongewenste captures.

#### `POST /v1/reviews/weekly`

Start of forceert een weekly review over een periode.

#### `GET /v1/reviews/{id}`

Leest een eerder gegenereerde review.

#### `POST /v1/imports/batch`

Start batchimport van notities, exports of transcripts.

#### `POST /v1/admin/reindex`

Admin-endpoint voor re-embedding/herindexering.

#### `GET /v1/health`

Technische healthcheck.

### 7.3 Waarom deze API-vorm?

Deze API ondersteunt zowel interactieve RemcoChat-flows als batchverwerking. Dat sluit aan op de tweedeling uit de gids:

- **capture**;
- **retrieval**.[^guide]

Het verschil is dat jouw variant dit als **interne servicegrens** implementeert in plaats van als verzameling edge functions.

---

## 8. Hoofdflows

### 8.1 Flow A — Capture vanuit RemcoChat

1. Gebruiker kiest **Save to Brain**.
2. RemcoChat bouwt een capture-request met content, broninformatie en idempotency key.
3. Open Brain API schrijft `brain_item` + `brain_chunks`.
4. API plant jobs voor embedding en metadata.
5. Worker verrijkt het item.
6. Itemstatus gaat naar `ready` of `partial`.
7. RemcoChat toont compacte bevestiging.

### 8.2 Flow B — Semantische zoekvraag

1. Gebruiker vraagt in RemcoChat naar eerdere kennis.
2. RemcoChat roept `POST /v1/search` aan.
3. Open Brain genereert query-embedding.
4. Postgres/pgvector zoekt nearest neighbors.
5. Resultaten worden gegroepeerd op itemniveau.
6. RemcoChat toont of verwerkt de resultaten in het antwoord.

### 8.3 Flow C — Weekly review

1. Gebruiker of scheduler start een weekly review.
2. API selecteert items binnen het tijdvenster.
3. Worker maakt een synthese via review-LLM.
4. Review wordt opgeslagen in `brain_reviews`.
5. RemcoChat kan de review lezen en bespreken.

### 8.4 Flow D — Second-brain of memory migration

1. Gebruiker activeert een migratieskill.
2. RemcoChat helpt met export of aanlevering.
3. Import endpoint ontvangt batches.
4. Worker splitst, normaliseert, embedt en labelt.
5. Items worden direct doorzoekbaar in hetzelfde geheugen.

---

## 9. Security, netwerk en runtime

### 9.1 Netwerkgrenzen

- Alleen bereikbaar via **LAN/Tailnet**.
- Geen publieke ingress.
- Geen publieke MCP endpoint.
- Geen publieke write-surface via website.

### 9.2 Authenticatie en autorisatie

Ook intern blijft auth nodig.

Minimale aanpak:

- machine token tussen RemcoChat en Open Brain;
- aparte admin-scope voor imports, delete en reindex;
- reverse proxy of service-layer auth op alle endpoints behalve health.

### 9.3 Audit en herstel

- audit events voor create/update/delete/import/review;
- databaseback-ups vanaf dag één;
- herstelprocedure testen;
- soft delete in MVP.

### 9.4 Geheime waarden en providers

Providerinstellingen blijven **gateway-agnostisch**. Net als in RemcoChat worden verbinding en toegestane modellen geconfigureerd via endpoint- en environment-gestuurde adapters.[^remcochat-config]

Aanbevolen capability-splitsing:

- `chat_provider`
- `embedding_provider`
- `metadata_provider`
- `review_provider`

Niet elk model hoeft alle vier de rollen te vervullen.

---

## 10. Deployment-aanpak

### 10.1 Doelopstelling

Aanbevolen componenten:

- `remcochat`
- `open-brain-api`
- `open-brain-worker`
- `postgres`
- optioneel `open-brain-dashboard`
- interne reverse proxy / service router

### 10.2 Voorkeursvorm

Docker Compose is voor de eerste versie voldoende:

- eenvoudig te beheren;
- goed passend bij home-infra;
- heldere netwerkgrenzen;
- reproduceerbare deployment.

### 10.3 Waarom geen extra infrastructuur in de MVP?

Niet nodig in v1:

- geen aparte message broker als Postgres-backed jobs volstaan;
- geen aparte vector database;
- geen publieke API gateway;
- geen orchestratorcomplexiteit zolang de schaal klein is.

---

## 11. MVP-afbakening

### 11.1 In scope

- expliciete capture vanuit RemcoChat;
- semantische search;
- recent-overzicht;
- stats-overzicht;
- weekly review;
- batch import endpoint;
- volledig private runtime op LAN/Tailnet.

### 11.2 Bewust buiten scope

- automatische opslag van alle chats;
- publieke connectoren;
- publieke website-integratie;
- knowledge graph / entity graph;
- uitgebreide multi-user IAM;
- MCP als kernprotocol;
- externe SaaS-runtime voor opslag of edge-verwerking.

---

## 12. Gefaseerd ontwikkelplan

### Fase 0 — Architectuurbesluiten vastleggen

Leg drie ADR’s vast:

1. **Open Brain is separate service**
2. **REST/OpenAPI is canoniek**
3. **MCP is adapter, niet core**

### Fase 1 — Datalaag en runtimefundering

- Postgres + pgvector opzetten
- schema migraties maken
- back-upstrategie inrichten
- interne netwerktopologie vastleggen

### Fase 2 — OpenAPI-contract en API-skelet

- OpenAPI-document opstellen
- endpoints voor capture/search/recent/stats/items/health
- auth en idempotency opnemen

### Fase 3 — Worker en verrijking

- jobmodel bouwen
- embeddingadapter integreren
- metadataadapter integreren
- retry en partial-failure gedrag definiëren

### Fase 4 — RemcoChat-integratie

- `openBrainGateway` toevoegen
- UI-actions voor save/search/review
- eerste capture-templates als skills toevoegen

### Fase 5 — Reviews en imports

- weekly review endpoint + workerflow
- batch import endpoint
- eerste migratieflows implementeren

### Fase 6 — Workflowlaag uit de promptkit

Vertaal de vijf promptkit-onderdelen naar interne workflows:[^promptkit]

1. **Memory Migration**
2. **Second Brain Migration**
3. **Open Brain Spark**
4. **Quick Capture Templates**
5. **Weekly Review**

### Fase 7 — Optionele uitbreidingen

- interne dashboard/UI
- interne MCP-adapter
- re-index tooling
- entity/project-overzichten

---

## 13. Belangrijkste ontwerpbeslissingen in één oogopslag

| Beslissing | Keuze |
|---|---|
| Primaire client | RemcoChat |
| Canonieke geheugenservice | Open Brain API |
| Canonieke datastore | Postgres + pgvector |
| Interne protocolkern | REST/OpenAPI |
| Asynchrone verwerking | Worker/jobs |
| Publieke exposure | Geen |
| Capturebeleid | Expliciet, niet volledig automatisch |
| Zoekbasis | Embeddings + pgvector |
| Metadata | Secundair, ondersteunend |
| MCP | Optionele interne adapter |
| Promptkit | Workflowlaag bovenop infrastructuur |

---

## 14. Aanbevolen eerstvolgende concrete artefacten

De eerstvolgende uit te werken artefacten zijn:

1. `docs/adr/001-open-brain-separate-service.md`
2. `docs/adr/002-rest-openapi-canonical.md`
3. `docs/adr/003-mcp-adapter-not-core.md`
4. `openapi/open-brain.v1.yaml`
5. `db/migrations/0001_initial_open_brain.sql`
6. `remcochat/tools/openBrainGateway.*`
7. `remcochat/.skills/open-brain-*`
8. `deploy/docker-compose.open-brain.yml`

---

## 15. Eindconclusie

De juiste vorm voor jouw Open Brain is een **private, REST-first geheugenservice naast RemcoChat**.

Dat ontwerp behoudt de sterke concepten uit de oorspronkelijke Open Brain-aanpak — een gedeelde geheugenlaag, vector search, open read/write en workflow-gestuurde gebruikspatronen — maar vervangt de SaaS- en publieke infrastructuur door een vorm die past bij jouw home-infra, Tailnet en interne productgrenzen.[^guide] [^promptkit]

Kort samengevat:

- **RemcoChat is de primaire client**;
- **Open Brain is de canonieke memory service**;
- **REST/OpenAPI is de interne contractlaag**;
- **Postgres + pgvector is de opslag- en retrievalbasis**;
- **LLM’s verrijken het systeem, maar vormen niet de kern**.

---

## Bronnen

[^guide]: Nate B. Jones, *Build Your Open Brain — Complete Setup Guide*. Kernconcepten: database met vector search, scheiding tussen capture en retrieval, embeddings als primaire retrievallaag, MCP als open read/write-laag. <https://promptkit.natebjones.com/20260224_uq1_guide_main>

[^promptkit]: Nate B. Jones, *Open Brain: Companion Prompts*. Vijf workflowlagen: Memory Migration, Second Brain Migration, Open Brain Spark, Quick Capture Templates en Weekly Review. <https://promptkit.natebjones.com/20260224_uq1_promptkit_1>

[^remcochat-readme]: RemcoChat README. Beschrijft RemcoChat als minimale chat-UI voor local/home network gebruik, met lokale SQLite-opslag, skills, server tools en trusted-machine/LAN-model. <https://raw.githubusercontent.com/kaalabs/remcochat/main/README.md>

[^remcochat-config]: RemcoChat voorbeeldconfiguratie. Laat providerconfiguratie zien via `base_url`, `api_key_env`, `allowed_model_ids`, lokale access controls en tooling-/gatewaystructuur. <https://raw.githubusercontent.com/kaalabs/remcochat/main/config.toml.example>

[^openapi]: OpenAPI Initiative, *OpenAPI Specification 3.2.0*. Machineleesbare specificatie voor HTTP-API-contracten. <https://spec.openapis.org/oas/v3.2.0.html>

[^pgvector]: pgvector projectdocumentatie. Postgres-extensie voor vectoropslag en nearest-neighbor search. <https://github.com/pgvector/pgvector>
