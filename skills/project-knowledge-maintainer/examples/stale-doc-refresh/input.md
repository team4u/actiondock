# Input

```yaml
repoPath: .
operation: refresh
changedFiles:
  - src/payments/payment.service.ts
  - src/payments/refund.service.ts
  - docs/domain/flows/payment.md
```

现有 `docs/domain/flows/payment.md` 仍描述旧同步支付流程；代码已经改为异步支付 + refund worker。
