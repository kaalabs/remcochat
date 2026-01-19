# Automation Boundaries

- This repository is operated by a single maintainer with multiple agent instances, with a deliberate preference for the lightest possible Git workflow and minimal automation.
- No required CI gates unless explicitly requested later.
- No additional deployment scripts or release automation without explicit instruction.
- Allowed (minimal, optional): `.gitignore` rules, optional local-only hooks (pre-commit).
- Not allowed unless explicitly requested: mandatory CI pipelines as merge gates, automated semantic releases or versioning bots.
- If a recommendation would increase automation or process overhead, present it as optional and do not implement it unless explicitly instructed.
