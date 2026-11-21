$Base = "https://ai-shop-assistant-production-c8ca90ba.up.railway.app/api/v1"
$suffix = Get-Date -Format "HHmmss"
$username = "agent_$suffix"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# 1) 注册
Invoke-RestMethod -Method Post -Uri "$Base/auth/register" `
  -ContentType "application/json" -WebSession $session `
  -Body (@{ username=$username; password="password123"; confirmPassword="password123" } | ConvertTo-Json) | Out-Null

# 2) 授权
Invoke-RestMethod -Method Post -Uri "$Base/me/authorization" `
  -ContentType "application/json" -WebSession $session `
  -Body (@{ consent=$true } | ConvertTo-Json) | Out-Null

# 3) 搜索（UTF-8 修复）
$search = Invoke-RestMethod -Method Post -Uri "$Base/assistant/search" `
  -ContentType "application/json; charset=utf-8" -WebSession $session `
  -Body ([System.Text.Encoding]::UTF8.GetBytes((@{ query="蓝牙耳机"; pageSize=5 } | ConvertTo-Json -Compress)))
"商品数量 = $($search.products.Count)"
$productId = $search.products[0].id

# 4) 加购
$reconcile = Invoke-RestMethod -Method Post -Uri "$Base/assistant/cart/reconcile" `
  -ContentType "application/json" -WebSession $session `
  -Body (@{ items=@(@{ id=$productId; quantity=1 }); idempotencyKey="run-$suffix" } | ConvertTo-Json)
$cartVersion = $reconcile.cartVersion

# 5) 报价
$quote = Invoke-RestMethod -Method Post -Uri "$Base/assistant/cart/quote" `
  -ContentType "application/json" -WebSession $session `
  -Body (@{ cartVersion=$cartVersion } | ConvertTo-Json)
$quoteId = $quote.quote.quoteId

# 6) 下单
$order = Invoke-RestMethod -Method Post -Uri "$Base/assistant/order" `
  -ContentType "application/json" -WebSession $session `
  -Body (@{ cartVersion=$cartVersion; quoteId=$quoteId; idempotencyKey="order-$suffix" } | ConvertTo-Json)

"下单成功 orderGroupId=$($order.orderGroupId) source=$($order.source)"