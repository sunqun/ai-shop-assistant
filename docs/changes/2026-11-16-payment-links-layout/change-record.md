# 支付短链区域布局改动记录

## 改动概要

将支付短链列表从 AI 助手面板内部移到助手面板上方的独立区域。没有有效短链时不显示该区域；短链较多时，列表在限定高度内滚动，助手面板使用剩余空间。

## 需求来源

用户要求支付短链不要放在 AI 助手里面，而是放在 AI 助手上面。

## 修改文件

- `components/assistant-dock.tsx`
- `app/globals.css`
- `docs/v0.1.0/requirements-analysis.md`
- `docs/v0.1.0/cases/2026-11-16-payment-links-layout/payment-links-layout-test-cases.md`

## 时间

2026-11-17 Asia/Shanghai

## 验证

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `git diff --check`：通过。
- `http://localhost:3010/` 返回 HTTP 200；端口 3003 被未知进程占用，未对该进程进行操作。
- 未登录请求短链列表 API 返回 HTTP 401，符合接口登录要求。
- 短链数量变化时的浏览器视觉状态尚未手工验证，对应布局用例保留待验。

## Code review

已检查短链区域条件渲染、父子容器高度约束、列表内部滚动及空列表布局，未发现本次布局变更导致的明显问题。浏览器视觉验证仍待完成。

## 遗留风险

- 本次只调整首页桌面右侧栏的布局；窄窗口沿用现有断点布局规则。
