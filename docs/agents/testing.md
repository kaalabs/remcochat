# Testing Expectations

- Always write scripted unit tests.
- Add end-to-end smoke coverage when it materially increases confidence (especially for critical UI flows), but **do not run E2E by default**.
- E2E runs (Playwright: `npm run test:e2e`, agent-browser: `npm run test:agent-browser`) happen **only when the user explicitly asks for E2E**.
- Mocks are not allowed; they are considered useless and do not add quality.
- By default, validate changes by running unit tests (`npm run test:unit`) when feasible; if not run, say so explicitly.

Related:
- Phase 0 security dev test strategy: `docs/agents/security-phase0-testing.md`
