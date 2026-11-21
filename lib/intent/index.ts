/** 意图模块的统一公开入口；内部实现直接依赖具体模块，避免循环依赖。 */
export { resolveAssistantIntent, isSearchResolution } from "./router";
export { emptyIntent, isEmptyIntent, makeIntentSummary } from "./intent-utils";
export type { IntentResolution } from "./type";
