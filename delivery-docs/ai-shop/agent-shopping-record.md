# 真实 AI Agent 购物记录

- 日期：2026-11-21
- Agent：Trae（编程 agent），底层模型 DeepSeek
- 目标接口：`https://ai-shop-assistant-production-c8ca90ba.up.railway.app/api/v1`
- 接口文档：[agent-api.md](agent-api.md)
- 方式：Agent 读取接口文档后，通过终端直接调用结构化 HTTP 接口，自主完成「注册 → 授权 → 搜索 → 选品 → 加购 → 报价 → 下单」。

## 购物目标

用户指令：买一个蓝牙耳机，数量 1 件。

## 执行过程

### 1) 注册

```text
POST /auth/register
username=agent_195241790
→ userid=9a07e4a3-6de6-411a-a21b-00211ac7b8f2
```

### 2) 授权 AI 自助下单

```text
POST /me/authorization { consent: true }
→ isAuthorized=true
```

### 3) 搜索「蓝牙耳机」

```text
POST /assistant/search { query: "蓝牙耳机", pageSize: 10 }
→ 商品数量 = 3

  P001       Aero 无线蓝牙耳机    price=1890  stock=34
  airbuds-pro 降噪蓝牙耳机 Pro   price=699   stock=42
  P002       Aero 无线蓝牙耳机    price=1790  stock=0
```

### 决策

选第一个有货商品：`P001`（Aero 无线蓝牙耳机，库存 34），买 1 件。跳过 `P002`（库存 0）。

### 4) 加入购物车（锁库存）

```text
POST /assistant/cart/reconcile
{ items: [{ id: "P001", quantity: 1 }], idempotencyKey: "agent-195241790" }
→ cartVersion=1
```

### 5) 报价

```text
POST /assistant/cart/quote { cartVersion: 1 }
→ quoteId=93ec0daf-d814-4f01-b641-19f0321ede1e
→ totalDueMinor=179000, currency=TWD（即 1790.00 新台币）
```

### 6) 下单

```text
POST /assistant/order
{ cartVersion: 1, quoteId: "93ec0daf-...", idempotencyKey: "order-195241790" }
→ 下单成功
```

## 下单结果

```json
{
  "orderGroupId": "650a5547-fc10-4f6e-84a7-1e25806ed323",
  "source": "AI",
  "orders": [
    { "orderId": "d2446975-1633-484b-b8c8-9948dcf56857" }
  ],
  "audit": {
    "provenance": "assistant",
    "userId": "9a07e4a3-6de6-411a-a21b-00211ac7b8f2"
  }
}
```

## 说明

- 本记录由真实 AI agent（Trae）驱动，通过结构化 HTTP 接口自主完成一次完整购物，非固定脚本照抄：搜索后根据「有货 + 首个候选」自行选定商品与数量。
- 订单 `source=AI`、`provenance=assistant`，与接口契约一致。
- 金额以最小货币单位（分）返回，`totalDueMinor=179000` 即 1790.00 新台币。
