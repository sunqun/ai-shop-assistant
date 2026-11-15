import { PageShell, PlaceholderCard } from "@/components/page-shell";
export default function CartPage() { return <PageShell eyebrow="M2 网站商城选品与加购" title="购物车" description="购物车编辑、库存校验和报价区域已预留。"><PlaceholderCard title="购物车为空" description="加入商品后，这里将展示商品、规格、数量和小计。库存锁定与最优报价属于后续模块。" actionHref="/products" actionLabel="去逛商品" /></PageShell>; }
