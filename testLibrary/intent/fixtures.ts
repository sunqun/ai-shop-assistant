import type { CatalogProduct, ProductSearchIntent } from "@/lib/catalog/types";
import type { DialogueContext, DialogueSnapshot, IntentRouting, NumericDialogueSlot } from "@/lib/intent/type";

export const product: CatalogProduct = {
  id: "fixture-product", name: "测试充电宝", brand: "Fixture", category: "配件",
  categoryId: "accessories", tone: "neutral", price: 500, currency: "TWD", stock: 4,
  rating: 4, reviewCount: 0, description: "支持快充", specs: { 容量: "10000mAh" },
};
export const intent = (patch: Partial<ProductSearchIntent> = {}): ProductSearchIntent => ({
  keywords: ["充电宝"], inStockOnly: false, ...patch,
});
export const dialogue = (patch: Partial<DialogueSnapshot> = {}): DialogueSnapshot => ({
  intent: intent(), unresolvedRequired: [], unresolvedPreferences: [], ...patch,
});
export const context = (patch: Partial<DialogueContext> = {}): DialogueContext => ({
  dialogue: dialogue(), product, phase: "needs_clarification", ...patch,
});
export const slot: NumericDialogueSlot = {
  kind: "number", condition: "大容量", attribute: "容量", operator: "gte", unit: "mAh",
  question: "最低容量是多少？",
};
export const routing = (patch: Partial<IntentRouting> = {}): IntentRouting => ({
  layer: "fallback", engine: "llm", action: "new_search", confidence: 0.99,
  reason: "structured_intent_parser", ...patch,
});
