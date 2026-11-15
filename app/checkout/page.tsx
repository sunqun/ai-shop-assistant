import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default function CheckoutPage() { return <PageShell eyebrow="M5 通用结账与订单" title="确认订单" description="收货信息、拆单提醒、报价摘要和收货后扣款说明将在后续实现。"><PlaceholderCard title="结账页面骨架" description="当前只提供页面入口，不创建订单、不锁库存、不发起扣款。" actionHref="/cart" actionLabel="返回购物车" /></PageShell>; }
