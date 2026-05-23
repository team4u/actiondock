# Input

```yaml
repoPath: .
operation: refresh
changedFiles:
  - src/routes/v2/orders.ts
  - src/routes/v1/orders.ts
  - openapi.yaml
  - src/orders/order.dto.ts
```

仓库变化：订单 API v2 改名 `status` 为 `state`，v1 暂时保留。
