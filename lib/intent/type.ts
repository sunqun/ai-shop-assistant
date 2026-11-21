import type {
  CatalogProduct,
  NumericSpecConstraint,
  ProductSearchIntent,
} from "@/lib/catalog/types";

export type DialogueAction =
  | "new_search"
  | "refine_search"
  | "fill_slot"
  | "confirm_order"
  | "cancel_task"
  | "query_status"
  | "analyze_reviews"
  | "chat"
  | "clarify";
export type IntentRouting = {
  layer: "rule" | "context" | "fallback";
  engine: "rules" | "state" | "llm";
  action: DialogueAction;
  confidence: number;
  reason: string;
  reviewMode?: "reuse" | "continue" | "refresh";
};
export type NumericDialogueSlot = {
  kind: "number";
  condition: string;
  attribute: string;
  operator: NumericSpecConstraint["operator"];
  unit: string;
  question: string;
};
export type ClarificationContext = {
  unresolvedRequired: string[];
  unresolvedPreferences: string[];
  pendingSlot?: NumericDialogueSlot;
};
export type DialogueSnapshot = ClarificationContext & {
  intent: ProductSearchIntent;
  routing?: IntentRouting;
};
export type DialogueContext = {
  dialogue?: DialogueSnapshot;
  product?: CatalogProduct;
  phase?: string;
  reviewContext?: { productId: string; question: string; complete: boolean; topics: string[] };
};
export type SearchResolution = { intent: ProductSearchIntent; routing: IntentRouting };

export type IntentDecision = {
  action: DialogueAction;
  confidence: number;
  reply?: string;
  reviewMode?: IntentRouting["reviewMode"];
};

export const EDITABLE_INTENT_FIELDS = [
  "category", "brand", "minPrice", "maxPrice", "minRating", "inStockOnly", "quantity",
  "requiredConditions", "preferences", "numericConstraints", "excludeTerms", "excludeBrands",
  "excludeCategories", "unresolvedConditions",
] as const;
export type IntentEdit = {
  field: (typeof EDITABLE_INTENT_FIELDS)[number];
  operation: "clear" | "remove";
  values?: string[];
  evidence: string;
};
export type IntentToolOutput = { intent: ProductSearchIntent; decision: IntentDecision; edits?: IntentEdit[] };

// 意图解析层的全局上限：查询文本长度与单个意图字段的词数上限。
export const MAX_QUERY_LENGTH = 1000;

export const MAX_TERMS = 12;

// 参与意图解析的历史轮次：只携带查询文本与意图摘要，不携带完整结构化意图。
export type IntentHistoryTurn = { query: string; intentSummary: string };

export type IntentResolution = SearchResolution & { reply?: string };
