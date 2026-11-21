// 基础文本规范化不解释用户意图，也不删除“支持、希望、不要”等语义词。
export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

export function normalizeCommandText(value: string): string {
  // 保留问号，避免把“取消？”变成取消执行指令。
  return normalizeWhitespace(value).replace(/[\s，。！,.!]+$/gu, "");
}

export function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}
