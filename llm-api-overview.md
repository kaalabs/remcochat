# The LLM-API-AI_SDK-matrix

Referentiebestand, voor gestructureerde data verwerking: `./llm-api-overview.toml`

Wanneer je met LLM-providers werkt, zijn er grofweg een beperkt aantal **API-typen / interactiemodellen** die steeds terugkomen, ongeacht de specifieke aanbieder (zoals OpenAI, Anthropic, Google, Mistral, Azure OpenAI). Het onderscheid zit primair in *hoe* je het model aanroept en *hoe de output wordt geleverd*, niet zozeer in het model zelf.

Hieronder een systematisch overzicht, van laag naar hoog abstractieniveau.

---

**1. Completion-gebaseerde API’s (prompt → tekst)**
Dit is het klassieke en meest fundamentele model.

Je stuurt één tekstprompt en ontvangt één tekstcompletion. De API is stateless; alle context moet iedere keer expliciet worden meegestuurd.

Kenmerken:

* Eén input → één output
* Geen expliciet gespreksmodel
* Volledige context zelf beheren
* Vaak goedkoper en eenvoudiger

Gebruikscases:

* Tekstgeneratie
* Samenvatten
* Classificatie
* Vertalingen
* Batchverwerking

Beperkingen:

* Geen ingebouwd gesprek
* Lastiger om complexe interacties te modelleren

---

**2. Chat / Message-gebaseerde API’s**
Dit is tegenwoordig de dominante vorm.

In plaats van één prompt stuur je een **gestructureerde lijst van berichten** met rollen (bijv. system, user, assistant). Het gesprek wordt als geheel door het model geïnterpreteerd.

Kenmerken:

* Conversatiestaat in de request
* Rollen en volgorde zijn semantisch relevant
* Betere instructietrouw
* Natuurlijke fit voor dialogen

Gebruikscases:

* Chatbots
* Coaching- of assistent-apps
* Complexe instructies
* Multi-turn interacties

Beperkingen:

* Meer tokens per request
* Contextmanagement blijft jouw verantwoordelijkheid

---

**3. Streaming API’s (token-of chunk-based)**
Dit is geen apart *conceptueel* model, maar een leveringsvorm bovenop completion of chat.

De output komt incrementeel binnen (token voor token of in chunks).

Kenmerken:

* Lage perceived latency
* Real-time UI-updates mogelijk
* Vaak via SSE (Server-Sent Events) of WebSockets

Gebruikscases:

* Chat UI’s
* Live transcriptie / feedback
* Progressieve rendering

Beperkingen:

* Complexere client-logica
* Lastiger om output achteraf te corrigeren

---

**4. Function Calling / Tool Calling API’s**
Hier geeft de LLM **gestructureerde output** terug die bedoeld is om door jouw applicatie te worden uitgevoerd.

Het model “kiest” zelf wanneer een functie/tool moet worden aangeroepen en levert JSON-achtige argumenten.

Kenmerken:

* Gestructureerde, machine-leesbare output
* Model beslist *wat* er moet gebeuren
* Strikte schema’s mogelijk

Gebruikscases:

* Orchestrators
* Agent-achtige systemen
* API-integraties
* Workflow-automatisering

Beperkingen:

* Vereist robuuste validatie
* Kans op schema-drift bij slecht ontwerp

---

**5. Responses / Unified APIs (multi-modal & multi-step)**
Nieuwere API-ontwerpen combineren meerdere capabilities in één endpoint.

Eén request kan bevatten:

* Tekst
* Afbeeldingen
* Audio
* Tools
* Streaming
* State

Kenmerken:

* Eén uniform contract
* Ondersteunt multi-modal input/output
* Geschikt voor agentic flows

Gebruikscases:

* Geavanceerde assistenten
* Multi-modal apps
* Complexe AI-workflows

Beperkingen:

* Hogere complexiteit
* Minder transparant dan “klassieke” calls

---

**6. Embeddings API’s (vectorisatie)**
Deze API’s genereren vectorrepresentaties van tekst (of andere modaliteiten).

Geen tekstoutput, maar numerieke vectoren.

Kenmerken:

* Deterministische output
* Geen “generatie”
* Geschikt voor similarity search

Gebruikscases:

* RAG-architecturen
* Semantische zoekmachines
* Clustering
* Deduplicatie

Beperkingen:

* Altijd in combinatie met andere API’s
* Vereist vector database of index

---

**7. Fine-tuning / Model-management API’s**
Niet bedoeld voor inference, maar voor **model lifecycle management**.

Kenmerken:

* Uploaden van trainingsdata
* Starten en monitoren van fine-tunes
* Versiebeheer

Gebruikscases:

* Domeinspecifieke modellen
* Consistente outputstijl
* Kostenreductie bij repetitieve taken

Beperkingen:

* Langzamere iteratie
* Extra governance nodig

---

**8. Batch / Async API’s**
Voor grote hoeveelheden niet-interactieve requests.

Kenmerken:

* Asynchrone verwerking
* Hogere throughput
* Lagere kosten per request

Gebruikscases:

* Nachtverwerking
* Massale documentanalyse
* Migraties

Beperkingen:

* Geen directe feedback
* Minder geschikt voor UI-gedreven flows

---

**Samenvattend kader**

Je kunt de API-typen grofweg langs drie assen positioneren:

* **Interactiemodel**: completion ↔ chat ↔ agentic
* **Outputvorm**: tekst ↔ stream ↔ gestructureerd ↔ vectors
* **Tijdskarakter**: realtime ↔ async/batch

In moderne architecturen (zoals bij agent-based of orchestrated systemen) zie je vrijwel altijd **combinaties**: chat + tool calling + streaming + embeddings.

Als je wilt, kan ik dit volgende stap:

* mappen op specifieke providers (OpenAI, Anthropic, Google, Azure)
* vertalen naar een referentie-architectuur
* of relateren aan jouw Vercel AI SDK / agent-orchestrator setup.


Ik heb een referentielaag toegevoegd door per API-type expliciet te mappen naar de “aansturingsprimitieven” in Vercel AI SDK v6: in de praktijk stuur je bijna alles aan via generateText() / streamText() (incl. tool calling), structured output via Output.object(), embeddings via embed() / embedMany(), en voor agentic loops kun je de Agent-abstractie gebruiken.
Belangrijk detail voor v6: generateObject() is (in de documentatie) deprecated en vervangen door generateText({ output: Output.object(...) }) / streamText({ output: ... }), en tool calling + structured output kan samen maar telt als extra stap in de execution flow.
Verder: AI SDK is provider-agnostisch (vaak via Vercel AI Gateway of via provider packages), en bevat naast LLM-text ook primitives voor o.a. image generation en (experimenteel) transcription/speech.

## Wat er nu extra in het bestand staat:

Een aparte sectie [[model_api_types]] waarin de provider-API-families als expliciete type-IDs zijn vastgelegd (o.a. openai_response, openai_chat_completions, openai_completions, anthropic_messages, plus openai_embeddings). Hierbij staat ook per type welke AI SDK factory je gebruikt (bijv. openai.responses(...), openai.chat(...), openai.completion(...), anthropic(...)).
Per [[api_types]]-rij (bijv. chat, completion, tool calling, structured output) is een nested tabel toegevoegd: [api_types.model_api_matrix]. Daarin zie je per provider welke model API types typisch van toepassing zijn (bijv. voor chat: OpenAI = openai_response/openai_chat_completions, Anthropic = anthropic_messages).
Dit sluit aan op hoe AI SDK v6 (en eerder v5+) de onderliggende OpenAI API-familie kan auto-selecteren of expliciet kan forceren via .responses(), .chat() en .completion(), terwijl Anthropic via de Messages API loopt.
