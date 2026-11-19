import type { CatalogProduct } from "./type";

const TONE_VISUALS: Record<string, { from: string; to: string; ink: string }> = {
  office: { from: "#e3e9ee", to: "#f7f9fb", ink: "#43566c" },
  media: { from: "#eae5ee", to: "#faf8fc", ink: "#6b5873" },
  travel: { from: "#e2ece4", to: "#f4faf5", ink: "#3e6a49" },
  kitchen: { from: "#f0e8dc", to: "#fbf7f0", ink: "#98603a" },
  home: { from: "#f1ebd6", to: "#fbf8ee", ink: "#88733a" },
  fitness: { from: "#e0ebe9", to: "#f2f9f8", ink: "#3d6d66" },
};

export function ProductGallery({ product }: { product: CatalogProduct }) {
  const specs = Object.entries(product.specs);
  const toneVisual = TONE_VISUALS[product.tone] ?? TONE_VISUALS.office;

  return (
    <section className="card product-detail__gallery">
      <div
        className="product-detail__visual"
        style={{
          background: `linear-gradient(135deg, ${toneVisual.from}, ${toneVisual.to})`,
          color: toneVisual.ink,
        }}
      >
        <span className="product-detail__visual-badge">{product.category}</span>
        <span className="product-detail__visual-letter" aria-hidden="true">
          {product.name.slice(0, 1)}
        </span>
        <span className="product-detail__visual-brand">{product.brand || "优选商品"}</span>
      </div>
      <div className="product-detail__specs">
        {specs.map(([key, value]) => (
          <span className="tag" key={key}>
            {key}: {value}
          </span>
        ))}
      </div>
    </section>
  );
}
