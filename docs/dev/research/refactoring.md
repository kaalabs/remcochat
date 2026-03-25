We are refactoring remcochat codebase to align with strong architectural and engineering principles.

Your task is to first analyze the repository and then propose a refactor plan before making broad changes from a new git refactoring branch.

Objectives:
- improve separation of concerns and module boundaries
- reduce coupling and circular dependencies
- make business logic easier to test in isolation
- clarify ownership of types, interfaces, services, adapters, and utilities
- remove dead code, duplicated logic, and misleading abstractions
- improve naming consistency and folder structure
- preserve current behavior unless a change is explicitly justified
- keep the result idiomatic for modern TypeScript

Process requirements:
1. Inspect the current architecture, dependency flow, and hotspots.
2. Identify the biggest architectural issues first.
3. Produce a concise refactor plan with phases, risks, and expected impact.
4. Do not start with a full rewrite.
5. Prefer incremental, reversible changes.
6. For each planned change, explain:
   - why it is needed
   - what principle it improves
   - what files/modules are affected
   - how behavior will be verified
7. Before editing, surface any uncertainties or assumptions.
8. After the plan is approved or after planning is complete, execute in small batches.
9. After each batch:
   - run relevant tests/typechecks/lint
   - summarize what changed
   - note follow-up work

Architectural standards to apply:
- clear distinction between domain logic, application orchestration, infrastructure, and UI/API layers where relevant
- dependency direction should point inward toward stable core logic
- shared utilities should not become a dumping ground
- prefer explicit interfaces at boundaries
- avoid god modules and deeply entangled state
- favor composability over inheritance unless inheritance is clearly justified
- keep public APIs small and intention-re
