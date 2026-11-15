# 改动记录：全局语言切换

## 基本信息

- 改动主题：全局语言切换
- 需求来源：用户补充的语言切换需求
- 改动时间：2026-11-15 16:44（Asia/Shanghai）
- 关联版本：`v0.1.0`
- 记录类型：功能实现与文档补充

## 改动概要

- 增加繁體中文、简体中文和 English 三种语言切换。
- 默认语言设为繁體中文。
- 保存浏览器语言偏好，并同步更新 `html[lang]`。
- 覆盖共享导航、页面文案、动态内容和可访问性属性的翻译。
- 增加语言切换需求条目 `F-20` 和验收标准 `AC-19`。
- 将测试用例归档到版本目录下的独立 case 目录。

## 改动文件

- `app/layout.tsx`
- `app/globals.css`
- `components/language-provider.tsx`
- `docs/v0.1.0/requirements-analysis.md`
- `docs/v0.1.0/cases/2026-11-15-language-switch/language-switch-test-cases.md`
- `C:/Users/40769/.codex/skills/requirements-to-delivery/SKILL.md`

## 验证记录

- `npm run typecheck`：通过
- `npm run build`：通过（需避免与开发服务器并行操作 `.next`）
- `git diff --check`：通过
- 动态路由 `/products/demo-1`、`/orders/demo-1`、`/handoff/test-token`：均返回 200
- code review：已执行，修复语言来回切换时翻译缓存无法恢复源文本的问题，复审未发现可确认问题
- 浏览器真实点击验证：未执行，当前环境 URL 权限策略阻拦

## 遗留风险

- 浏览器交互用例仍需在允许访问本地开发服务器的浏览器环境中执行。
