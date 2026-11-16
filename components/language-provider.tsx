"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "zh-CN" | "zh-TW" | "en";

const labels: Record<Locale, Record<string, string>> = {
  "zh-TW": {},
  "zh-CN": {
    "AI 商城": "AI 商城",
    商品: "商品",
    购物车: "购物车",
    我的: "我的",
    登录: "登录",
    返回首页: "返回首页",
    "先逛商城，再让 AI 帮你做选择。": "先逛商城，再让 AI 帮你做选择。",
    "这是 AI 商城的 Next.js 页面骨架。商品、购物车、账户和 AI 助手入口已经准备好，业务功能将在后续模块逐步接入。":
      "这是 AI 商城的 Next.js 页面骨架。商品、购物车、账户和 AI 助手入口已经准备好，业务功能将在后续模块逐步接入。",
    开始逛商品: "开始逛商品",
    首期实现链路: "首期实现链路",
    "首页 → 商品列表 → 商品详情 → 加入购物车 → 查看购物车":
      "首页 → 商品列表 → 商品详情 → 加入购物车 → 查看购物车",
    "优惠弹窗、登录授权和订单功能当前仅保留页面入口。":
      "优惠弹窗、登录授权和订单功能当前仅保留页面入口。",
    推荐商品: "推荐商品",
    "查看全部 →": "查看全部 →",
    "商品卡片占位，后续接入商品服务和真实库存。": "商品卡片占位，后续接入商品服务和真实库存。",
    查看详情: "查看详情",
    查看入口: "查看入口",
    商品列表: "商品列表",
    "搜索、筛选和分页区域已预留，当前展示占位商品。":
      "搜索、筛选和分页区域已预留，当前展示占位商品。",
    "搜索商品（暂未启用）": "搜索商品（暂未启用）",
    筛选: "筛选",
    "规格、库存和价格将在商品服务接入后展示。": "规格、库存和价格将在商品服务接入后展示。",
    "购物车编辑、库存校验和报价区域已预留。": "购物车编辑、库存校验和报价区域已预留。",
    购物车为空: "购物车为空",
    "加入商品后，这里将展示商品、规格、数量和小计。库存锁定与最优报价属于后续模块。":
      "加入商品后，这里将展示商品、规格、数量和小计。库存锁定与最优报价属于后续模块。",
    去逛商品: "去逛商品",
    确认订单: "确认订单",
    "收货信息、拆单提醒、报价摘要和收货后扣款说明将在后续实现。":
      "商品、报价和订单创建信息会在此确认；提交只创建订单记录，不会付款或扣款。",
    结账页面骨架: "结账页面骨架",
    "当前只提供页面入口，不创建订单、不锁库存、不发起扣款。":
      "点击“付款”只会创建订单记录，不会发起支付或扣款。",
    返回购物车: "返回购物车",
    "登录 AI 商城": "登录 AI 商城",
    "登录表单和长期 AI 授权将在后续实现。": "登录表单和长期 AI 授权将在后续实现。",
    登录页面骨架: "登录页面骨架",
    "这里将承载登录、授权同意/拒绝和回跳状态。": "这里将承载登录、授权同意/拒绝和回跳状态。",
    查看我的页面: "查看我的页面",
    "从这里查看订单、物流、退款和授权管理。": "从这里查看本人订单记录和授权管理。",
    待处理订单: "待处理订单",
    运输中包裹: "运输中包裹",
    "退款/售后": "退款/售后",
    订单: "订单",
    物流: "物流",
    退款与售后: "退款与售后",
    "AI 授权": "AI 授权",
    "履约、物流、结算和退款状态将分别展示。": "这里展示本人创建的订单记录。",
    暂无订单数据: "暂无订单数据",
    "订单列表和状态筛选将在订单模块实现后接入。": "创建订单后，订单记录会显示在这里。",
    "AI 授权管理": "AI 授权管理",
    "长期授权的查看、撤销和审计信息将在授权模块实现。":
      "长期授权的查看、撤销和审计信息将在授权模块实现。",
    暂无授权数据: "暂无授权数据",
    "授权状态和撤销操作已预留，当前不会产生任何授权。":
      "授权状态和撤销操作已预留，当前不会产生任何授权。",
    返回登录: "返回登录",
    "包裹和脱敏运单信息将在物流服务接入后展示。": "包裹和脱敏运单信息将在物流服务接入后展示。",
    暂无物流记录: "暂无物流记录",
    "物流轨迹、包裹状态和订单关联页面已预留。": "物流轨迹、包裹状态和订单关联页面已预留。",
    查看订单: "查看订单",
    "退货申请、退款状态和额外应收将在后续实现。": "退货申请、退款状态和额外应收将在后续实现。",
    暂无退款记录: "暂无退款记录",
    "退款列表和退货申请入口已预留。": "退款列表和退货申请入口已预留。",
    "确认 AI 授权": "确认 AI 授权",
    "AI 下单触发的补充授权页面入口。": "AI 下单触发的补充授权页面入口。",
    授权页面骨架: "授权页面骨架",
    "当前只展示入口，不读取或写入授权状态。": "当前只展示入口，不读取或写入授权状态。",
    去登录: "去登录",
    "M2 网站商城选品与加购": "M2 网站商城选品与加购",
    "M5 通用结账与订单": "M5 通用结账与订单",
    "M1 身份与授权": "M1 身份与授权",
    "M6 我的": "M6 我的",
    "M6 我的订单": "M6 我的订单",
    "M1 身份与 AI 授权": "M1 身份与 AI 授权",
    "M6 我的物流": "M6 我的物流",
    "M6 退款与售后": "M6 退款与售后",
    "M1 授权确认": "M1 授权确认",
    安全交接: "安全交接",
    交接页面骨架: "交接页面骨架",
    "当前不交换 token、不建立受限会话。": "当前不交换 token、不建立受限会话。",
    长期交接入口: "长期交接入口",
    订单详情: "订单详情",
    订单状态: "订单状态",
    履约状态: "履约状态",
    等待订单数据: "等待订单数据",
    占位: "占位",
    结算状态: "结算状态",
    收货后扣款流程未接入: "收货后扣款流程未接入",
    查看订单回执: "查看订单回执",
    查看物流: "查看物流",
    退货与退款: "退货与退款",
    订单物流: "订单物流",
    物流轨迹占位: "物流轨迹占位",
    "包裹、子订单和脱敏运单轨迹将在后续接入。": "包裹、子订单和脱敏运单轨迹将在后续接入。",
    返回订单详情: "返回订单详情",
    订单回执: "订单回执",
    订单回执占位: "订单回执占位",
    "当前不会创建真实订单，后续展示父订单、子订单和缺货项。":
      "当前不会创建真实订单，后续展示父订单、子订单和缺货项。",
    查看订单详情: "查看订单详情",
    退货申请占位: "退货申请占位",
    "退货选择、运费影响、退款和额外应收将在后续实现。":
      "退货选择、运费影响、退款和额外应收将在后续实现。",
    "M5 订单履约": "M5 订单履约",
    "M6 订单物流": "M6 订单物流",
    "M5 订单回执": "M5 订单回执",
    "M6 退货与退款": "M6 退货与退款",
    商品详情: "商品详情",
    商品图片占位: "商品图片占位",
    规格与描述: "规格与描述",
    "这里将展示商品图片、规格选择、脱敏评论和可售状态。":
      "这里将展示商品图片、规格选择、脱敏评论和可售状态。",
    商品价格: "商品价格",
    规格: "规格",
    规格选择暂未启用: "规格选择暂未启用",
    数量: "数量",
    加入购物车: "加入购物车",
    返回商品列表: "返回商品列表",
    "AI 购物助手": "AI 购物助手",
    "功能占位，暂未接入搜索和下单": "功能占位，暂未接入搜索和下单",
    "TOP3 商品对比": "TOP3 商品对比",
    "后续展示价格、核心规格、配送、售后和适用场景优劣。":
      "后续展示价格、核心规格、配送、售后和适用场景优劣。",
    搜索结果占位列表: "搜索结果占位列表",
    等待搜索: "等待搜索",
    搜索结果将在此处滚动展示: "搜索结果将在此处滚动展示",
    商品比较: "商品比较",
    固定比较区保持在顶部: "固定比较区保持在顶部",
    明确确认后下单: "明确确认后下单",
    "AI 下单功能将在后续模块实现": "AI 下单功能将在后续模块实现",
    描述你想找的商品: "描述你想找的商品",
    "AI 助手搜索": "AI 助手搜索",
    "当前为页面骨架，输入和按钮暂未启用。": "当前为页面骨架，输入和按钮暂未启用。",
    主导航: "主导航",
    "AI 助手占位面板": "AI 助手占位面板",
    智能办公套装: "智能办公套装",
    家庭影音设备: "家庭影音设备",
    轻量旅行装备: "轻量旅行装备",
    健康生活用品: "健康生活用品",
    厨房小电器: "厨房小电器",
    户外运动装备: "户外运动装备",
  },
  en: {
    "AI 商城": "AI Shop",
    商品: "Products",
    购物车: "Cart",
    我的: "Account",
    登录: "Sign in",
    返回首页: "Back to home",
    查看入口: "View entry",
    "先逛商城，再让 AI 帮你做选择。": "Browse the store, then let AI help you choose.",
    "这是 AI 商城的 Next.js 页面骨架。商品、购物车、账户和 AI 助手入口已经准备好，业务功能将在后续模块逐步接入。":
      "This is the AI Shop Next.js app skeleton. Product, cart, account, and AI assistant entry points are ready for future modules.",
    开始逛商品: "Browse products",
    首期实现链路: "Initial shopping flow",
    "首页 → 商品列表 → 商品详情 → 加入购物车 → 查看购物车":
      "Home → Product list → Product details → Add to cart → View cart",
    "优惠弹窗、登录授权和订单功能当前仅保留页面入口。":
      "Promotions, sign-in authorization, and orders are currently placeholders.",
    推荐商品: "Featured products",
    "查看全部 →": "View all →",
    "商品卡片占位，后续接入商品服务和真实库存。":
      "Product card placeholder. Product data and inventory will be connected later.",
    查看详情: "View details",
    商品列表: "Products",
    "搜索、筛选和分页区域已预留，当前展示占位商品。":
      "Search, filters, and pagination are reserved; placeholder products are shown.",
    "搜索商品（暂未启用）": "Search products (unavailable)",
    筛选: "Filter",
    "规格、库存和价格将在商品服务接入后展示。":
      "Options, inventory, and prices will appear when product services are connected.",
    "购物车编辑、库存校验和报价区域已预留。":
      "Cart editing, inventory checks, and quotes are reserved.",
    购物车为空: "Your cart is empty",
    "加入商品后，这里将展示商品、规格、数量和小计。库存锁定与最优报价属于后续模块。":
      "Products, options, quantities, and subtotals will appear here. Inventory holds and quotes are planned for a later module.",
    去逛商品: "Browse products",
    确认订单: "Review order",
    "收货信息、拆单提醒、报价摘要和收货后扣款说明将在后续实现。":
      "Review items and quote before creating an order record. No payment or charge is made.",
    结账页面骨架: "Checkout placeholder",
    "当前只提供页面入口，不创建订单、不锁库存、不发起扣款。":
      "Selecting “Pay” creates an order record only. No payment or charge is made.",
    返回购物车: "Back to cart",
    "登录 AI 商城": "Sign in to AI Shop",
    "登录表单和长期 AI 授权将在后续实现。":
      "Sign-in form and persistent AI authorization are planned.",
    登录页面骨架: "Sign-in placeholder",
    "这里将承载登录、授权同意/拒绝和回跳状态。":
      "Sign-in, authorization consent, and return navigation will appear here.",
    查看我的页面: "View account",
    "从这里查看订单、物流、退款和授权管理。":
      "View your order records and authorization here.",
    待处理订单: "Pending orders",
    运输中包裹: "In-transit packages",
    "退款/售后": "Refunds / support",
    订单: "Orders",
    物流: "Shipping",
    退款与售后: "Refunds & support",
    "AI 授权": "AI authorization",
    "履约、物流、结算和退款状态将分别展示。":
      "Your created order records appear here.",
    暂无订单数据: "No order data",
    "订单列表和状态筛选将在订单模块实现后接入。":
      "Created order records appear here.",
    "AI 授权管理": "AI authorization management",
    "长期授权的查看、撤销和审计信息将在授权模块实现。":
      "Persistent authorization, revocation, and audit details are planned.",
    暂无授权数据: "No authorization data",
    "授权状态和撤销操作已预留，当前不会产生任何授权。":
      "Authorization status and revocation are reserved; no authorization is created now.",
    返回登录: "Back to sign in",
    "包裹和脱敏运单信息将在物流服务接入后展示。":
      "Packages and redacted tracking details will appear when shipping services are connected.",
    暂无物流记录: "No shipping records",
    "物流轨迹、包裹状态和订单关联页面已预留。":
      "Tracking events, package status, and order links are reserved.",
    查看订单: "View orders",
    "退货申请、退款状态和额外应收将在后续实现。":
      "Return requests, refund status, and additional charges are planned.",
    暂无退款记录: "No refund records",
    "退款列表和退货申请入口已预留。": "Refund lists and return request entry points are reserved.",
    "确认 AI 授权": "Confirm AI authorization",
    "AI 下单触发的补充授权页面入口。": "Additional authorization entry point for AI orders.",
    授权页面骨架: "Authorization placeholder",
    "当前只展示入口，不读取或写入授权状态。":
      "This is an entry point only; authorization status is not read or changed.",
    去登录: "Sign in",
    "M2 网站商城选品与加购": "M2 Store browsing and cart",
    "M5 通用结账与订单": "M5 Checkout and orders",
    "M1 身份与授权": "M1 Identity and authorization",
    "M6 我的": "M6 Account",
    "M6 我的订单": "M6 My orders",
    "M1 身份与 AI 授权": "M1 Identity and AI authorization",
    "M6 我的物流": "M6 My shipping",
    "M6 退款与售后": "M6 Refunds and support",
    "M1 授权确认": "M1 Authorization",
    安全交接: "Secure handoff",
    交接页面骨架: "Handoff placeholder",
    "当前不交换 token、不建立受限会话。": "No token exchange or restricted session is created yet.",
    长期交接入口: "Persistent handoff",
    订单详情: "Order details",
    订单状态: "Order status",
    履约状态: "Fulfillment",
    等待订单数据: "Waiting for order data",
    占位: "Placeholder",
    结算状态: "Settlement",
    收货后扣款流程未接入: "Post-delivery charging is not connected",
    查看订单回执: "View order receipt",
    查看物流: "View shipping",
    退货与退款: "Returns & refunds",
    订单物流: "Order shipping",
    物流轨迹占位: "Tracking placeholder",
    "包裹、子订单和脱敏运单轨迹将在后续接入。":
      "Package, suborder, and redacted tracking details are planned.",
    返回订单详情: "Back to order",
    订单回执: "Order receipt",
    订单回执占位: "Order receipt placeholder",
    "当前不会创建真实订单，后续展示父订单、子订单和缺货项。":
      "An order record is created and saved. Payment and fulfillment are not connected.",
    查看订单详情: "View order details",
    退货申请占位: "Return request placeholder",
    "退货选择、运费影响、退款和额外应收将在后续实现。":
      "Return selection, shipping impact, refunds, and additional charges are planned.",
    "M5 订单履约": "M5 Order fulfillment",
    "M6 订单物流": "M6 Order shipping",
    "M5 订单回执": "M5 Order receipt",
    "M6 退货与退款": "M6 Returns and refunds",
    商品详情: "Product details",
    商品图片占位: "Product image placeholder",
    规格与描述: "Options and description",
    "这里将展示商品图片、规格选择、脱敏评论和可售状态。":
      "Product images, option selection, redacted reviews, and availability will appear here.",
    商品价格: "Product price",
    规格: "Option",
    规格选择暂未启用: "Option selection unavailable",
    数量: "Quantity",
    加入购物车: "Add to cart",
    返回商品列表: "Back to products",
    "AI 购物助手": "AI shopping assistant",
    "功能占位，暂未接入搜索和下单": "Placeholder; search and ordering are not connected",
    "TOP3 商品对比": "Top 3 product comparison",
    "后续展示价格、核心规格、配送、售后和适用场景优劣。":
      "Price, key options, shipping, support, and trade-offs will appear here.",
    搜索结果占位列表: "Search results placeholder",
    等待搜索: "Waiting for search",
    搜索结果将在此处滚动展示: "Search results will scroll here",
    商品比较: "Product comparison",
    固定比较区保持在顶部: "Comparison stays fixed at the top",
    明确确认后下单: "Order after explicit confirmation",
    "AI 下单功能将在后续模块实现": "AI ordering is planned for a later module",
    描述你想找的商品: "Describe what you are looking for",
    "AI 助手搜索": "AI assistant search",
    "当前为页面骨架，输入和按钮暂未启用。":
      "This is an app skeleton; input and buttons are unavailable.",
    主导航: "Main navigation",
    "AI 助手占位面板": "AI assistant placeholder panel",
    智能办公套装: "Smart office kit",
    家庭影音设备: "Home audio and video",
    轻量旅行装备: "Lightweight travel gear",
    健康生活用品: "Healthy living",
    厨房小电器: "Small kitchen appliances",
    户外运动装备: "Outdoor sports gear",
  },
};

const traditionalCharacters: Record<string, string> = {
  简: "簡",
  体: "體",
  门: "門",
  阅: "閱",
  语: "語",
  言: "言",
  网: "網",
  购: "購",
  车: "車",
  录: "錄",
  开: "開",
  始: "始",
  选: "選",
  择: "擇",
  页: "頁",
  览: "覽",
  现: "現",
  货: "貨",
  后: "後",
  续: "續",
  实: "實",
  际: "際",
  备: "備",
  注: "註",
  态: "態",
  订: "訂",
  单: "單",
  结: "結",
  账: "帳",
  确: "確",
  收: "收",
  发: "發",
  显: "顯",
  别: "別",
  将: "將",
  为: "為",
  这: "這",
  个: "個",
  与: "與",
  长: "長",
  时: "時",
  间: "間",
  处: "處",
  理: "理",
  运: "運",
  输: "輸",
  库: "庫",
  存: "存",
  价: "價",
  格: "格",
  寻: "尋",
  筛: "篩",
  滤: "濾",
  区: "區",
  预: "預",
  留: "留",
  条: "條",
  件: "件",
  果: "果",
  退: "退",
  款: "款",
  审: "審",
  计: "計",
  暂: "暫",
  无: "無",
  须: "須",
  已: "已",
  会: "會",
  从: "從",
  来: "來",
  里: "裡",
  数: "數",
  据: "據",
  项: "項",
  目: "目",
  说: "說",
  明: "明",
  请: "請",
  返: "返",
  回: "回",
  复: "復",
  当: "當",
  前: "前",
  面: "面",
  站: "站",
  仓: "倉",
  储: "儲",
  台: "臺",
  线: "線",
  程: "程",
  启: "啟",
  用: "用",
  关: "關",
  闭: "閉",
  层: "層",
  组: "組",
  标: "標",
  识: "識",
  图: "圖",
  片: "片",
  规: "規",
  描: "描",
  述: "述",
  帮: "幫",
  助: "助",
  对: "對",
  比: "比",
  顶: "頂",
  部: "部",
  滚: "滾",
  动: "動",
  状: "狀",
  权: "權",
  场: "場",
  优: "優",
  级: "級",
  务: "務",
  导: "導",
  让: "讓",
  应: "應",
  该: "該",
  进: "進",
  还: "還",
  过: "過",
  够: "夠",
  头: "頭",
  责: "責",
  视: "視",
  证: "證",
  设: "設",
  变: "變",
};

const traditionalWords: Array<[string, string]> = [
  ["这里", "這裡"],
  ["那里", "那裡"],
  ["里程", "里程"],
  ["授权", "授權"],
  ["权限", "權限"],
  ["帐号", "帳號"],
  ["账户", "帳戶"],
  ["数量", "數量"],
  ["数据", "數據"],
  ["网页", "網頁"],
  ["网站", "網站"],
];

function toTraditional(value: string): string {
  let result = value;
  for (const [source, target] of traditionalWords) result = result.replaceAll(source, target);
  return result.replace(
    /[简体门阅语网购车录开始选择页览现货后续实备注态订单结账确收发显别将为这个与长时间处理运输库存价格寻筛滤区预留条件结果退款审计暂无须已会从来里数据项目说明请返回复当前面站仓储台线程启用关闭层组标识图片规格描述帮助对比顶部滚动状态权场优级务导让应该进还过够头责视证设变]/g,
    (char) => traditionalCharacters[char] ?? char
  );
}

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({
  locale: "zh-TW",
  setLocale: () => {},
});
const storageKey = "ai-shop-locale";

function translateText(value: string, locale: Locale): string {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.slice(leading.length, value.length - trailing.length || undefined);
  if (!core) return value;
  if (locale === "zh-TW") return `${leading}${toTraditional(core)}${trailing}`;
  const dictionary = labels[locale];
  if (dictionary[core]) return `${leading}${dictionary[core]}${trailing}`;
  if (core.startsWith("商品标识："))
    return `${leading}${locale === "en" ? `Product ID: ${core.slice(5)}` : `商品标识：${core.slice(5)}`}${trailing}`;
  if (core.startsWith("订单组："))
    return `${leading}${locale === "en" ? `Order group: ${core.slice(4)}` : `订单组：${core.slice(4)}`}${trailing}`;
  if (core.startsWith("交接标识："))
    return `${leading}${locale === "en" ? `Handoff ID: ${core.slice(5)}` : `交接标识：${core.slice(5)}`}${trailing}`;
  return value;
}

type Translation = { source: string; rendered: string; locale: Locale };
const textTranslations = new WeakMap<Text, Translation>();
const attributeTranslations = new WeakMap<Element, Map<string, Translation>>();
const translatableAttributes = ["aria-label", "title", "placeholder"];
const excludedTags = new Set(["SCRIPT", "STYLE", "OPTION"]);

function translateTextNode(node: Text, locale: Locale) {
  const current = node.data;
  let translation = textTranslations.get(node);
  if (!translation) {
    translation = { source: current, rendered: current, locale };
    textTranslations.set(node, translation);
  } else if (
    current !== translation.rendered &&
    current !== translateText(translation.source, translation.locale)
  ) {
    translation.source = current;
  }
  const rendered = translateText(translation.source, locale);
  translation.rendered = rendered;
  translation.locale = locale;
  if (current !== rendered) node.data = rendered;
}

function translateElementAttributes(element: Element, locale: Locale) {
  let translations = attributeTranslations.get(element);
  if (!translations) {
    translations = new Map();
    attributeTranslations.set(element, translations);
  }
  for (const name of translatableAttributes) {
    if (!element.hasAttribute(name)) continue;
    const current = element.getAttribute(name) ?? "";
    let translation = translations.get(name);
    if (!translation) {
      translation = { source: current, rendered: current, locale };
      translations.set(name, translation);
    } else if (
      current !== translation.rendered &&
      current !== translateText(translation.source, translation.locale)
    ) {
      translation.source = current;
    }
    const rendered = translateText(translation.source, locale);
    translation.rendered = rendered;
    translation.locale = locale;
    if (current !== rendered) element.setAttribute(name, rendered);
  }
}

function translateSubtree(root: Node, locale: Locale) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE && excludedTags.has((node as Element).tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null = walker.currentNode;
  if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text, locale);
  else if (node.nodeType === Node.ELEMENT_NODE && !excludedTags.has((node as Element).tagName))
    translateElementAttributes(node as Element, locale);
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text, locale);
    else if (node.nodeType === Node.ELEMENT_NODE && !excludedTags.has((node as Element).tagName))
      translateElementAttributes(node as Element, locale);
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>("zh-TW");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "zh-CN" || saved === "zh-TW" || saved === "en") setLocale(saved);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(storageKey, locale);
    document.documentElement.lang = locale;
    if (document.body) translateSubtree(document.body, locale);
  }, [hydrated, locale]);
  useEffect(() => {
    if (!hydrated || !document.body) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData" && record.target instanceof Text) {
          translateTextNode(record.target, locale);
        } else if (
          record.type === "attributes" &&
          record.target instanceof Element &&
          record.attributeName
        ) {
          translateElementAttributes(record.target, locale);
        } else {
          for (const node of record.addedNodes) translateSubtree(node, locale);
        }
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatableAttributes,
    });
    return () => observer.disconnect();
  }, [hydrated, locale]);
  const value = useMemo(() => ({ locale, setLocale }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function LanguageSelector() {
  const { locale, setLocale } = useContext(LocaleContext);
  const label = locale === "en" ? "Language" : locale === "zh-CN" ? "语言" : "語言";
  return (
    <label className="language-picker">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="zh-CN">简体中文</option>
        <option value="zh-TW">繁體中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
