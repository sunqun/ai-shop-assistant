export function AssistantDock() {
  return (
    <aside className="assistant-dock" aria-label="AI 助手占位面板">
      <div className="assistant-dock__header">
        <div><strong>AI 购物助手</strong><span>功能占位，暂未接入搜索和下单</span></div>
        <span aria-hidden="true">●</span>
      </div>
      <div className="assistant-dock__body">
        <div className="assistant-dock__comparison">
          <h3>TOP3 商品对比</h3>
          <p>后续展示价格、核心规格、配送、售后和适用场景优劣。</p>
        </div>
        <div className="assistant-dock__results" aria-label="搜索结果占位列表">
          <div className="assistant-result"><strong>等待搜索</strong><span>搜索结果将在此处滚动展示</span></div>
          <div className="assistant-result"><strong>商品比较</strong><span>固定比较区保持在顶部</span></div>
          <div className="assistant-result"><strong>明确确认后下单</strong><span>AI 下单功能将在后续模块实现</span></div>
        </div>
        <input className="assistant-dock__input" placeholder="描述你想找的商品" aria-label="AI 助手搜索" disabled />
        <div className="assistant-dock__footer">当前为页面骨架，输入和按钮暂未启用。</div>
      </div>
    </aside>
  );
}
