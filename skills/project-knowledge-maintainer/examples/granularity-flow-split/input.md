# Input

repoPath: .
operation: refresh
changedFiles:
  - src/checkout/checkout.service.ts
  - src/checkout/checkout.controller.ts

Existing docs:
- docs/domain/flows/index.md exists and currently has only a flow list.

Expected: do not append the checkout flow body to index.md. Create a leaf flow doc and update index with a link.
