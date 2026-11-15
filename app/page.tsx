import Link from "next/link";

const products = ["智能办公套装", "家庭影音设备", "轻量旅行装备"];

export default function HomePage() {
  return <>
    <section className="hero">
      <div className="hero__main">
        <p className="eyebrow">AI powered shopping</p>
        <h1>先逛商城，再让 AI 帮你做选择。</h1>
        <p>这是 AI 商城的 Next.js 页面骨架。商品、购物车、账户和 AI 助手入口已经准备好，业务功能将在后续模块逐步接入。</p>
        <Link className="button button--primary" href="/products">开始逛商品</Link>
      </div>
      <div className="hero__side">
        <div><h2>首期实现链路</h2><p>首页 → 商品列表 → 商品详情 → 加入购物车 → 查看购物车</p></div>
        <div className="notice">优惠弹窗、登录授权和订单功能当前仅保留页面入口。</div>
      </div>
    </section>
    <section className="section">
      <div className="section__heading"><h2>推荐商品</h2><Link className="muted" href="/products">查看全部 →</Link></div>
      <div className="grid">{products.map((product, index) => <article className="card product-card" key={product}><div className="product-card__image">0{index + 1}</div><div className="product-card__body"><h3>{product}</h3><p>商品卡片占位，后续接入商品服务和真实库存。</p><div className="product-card__footer"><span className="price">¥ --</span><Link className="button button--soft" href={`/products/demo-${index + 1}`}>查看详情</Link></div></div></article>)}</div>
    </section>
  </>;
}
