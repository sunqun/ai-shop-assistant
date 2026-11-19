import { Coffee, Keyboard, LampDesk, ShoppingCart } from "lucide-react";

export function Header() {
  return (
    <div className="shop-intro">
      <div>
        <p className="shop-intro__eyebrow">AI curated · everyday essentials</p>
        <h1>把日常好物，挑得更轻松</h1>
        <p className="shop-intro__copy">从实用配件到生活灵感，找到适合自己的选择。</p>
      </div>
      <div className="shop-intro__visual" aria-hidden="true">
        <span className="shop-intro__visual-orbit shop-intro__visual-orbit--one" />
        <span className="shop-intro__visual-orbit shop-intro__visual-orbit--two" />
        <span className="shop-intro__visual-icon">
          <ShoppingCart size={30} strokeWidth={1.7} />
        </span>
        <span className="shop-intro__visual-chip shop-intro__visual-chip--top">
          <Keyboard size={15} /> 3C 配件
        </span>
        <span className="shop-intro__visual-chip shop-intro__visual-chip--left">
          <LampDesk size={15} /> 居家生活
        </span>
        <span className="shop-intro__visual-chip shop-intro__visual-chip--right">
          <Coffee size={15} /> 食品飲料
        </span>
      </div>
    </div>
  );
}
