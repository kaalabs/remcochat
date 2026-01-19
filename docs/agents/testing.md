# Testing Expectations

- Always write scripted unit tests and end-to-end smoke tests with full coverage where possible.
- Include an `agent-browser` end-user smoke test when UI changes are made (run via `npm run test:agent-browser`).
- Mocks are not allowed; they are considered useless and do not add quality.
- Test scripts are run manually and at the agent's command to validate changes without exception.
