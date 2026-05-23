# ingest-runbook-note

```yaml
repoPath: .
operation: ingest
inboxPaths:
  - .kb_inbox/payment-timeout-runbook.md
```

Inbox 内容是人工写的支付超时排障步骤。仓库中存在：

```text
src/payments/payment-worker.ts
src/payments/provider-client.ts
docs/ops/maintenance/payments.md
```
