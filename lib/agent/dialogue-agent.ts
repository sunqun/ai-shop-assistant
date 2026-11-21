/**
 * 对话执行入口：复用统一意图识别，根据决策分发任务动作和只读能力。
 *
 * 这里消费路由决策；交易动作（确认/取消/下单）仍调用任务状态机
 * （shopping-task-service）执行，不能由模型直接触发，保证交易安全。
 * 此外还承载「分析当前商品评论」这一只读辅助能力，用于帮用户做购买决策。
 */
import {
  isEmptyIntent,
  makeIntentSummary,
  isSearchResolution,
  resolveAssistantIntent,
} from "@/lib/intent";
import type { DialogueContext, IntentRouting, SearchResolution } from "@/lib/intent/type";
import { createShoppingTask, actOnShoppingTask } from "@/lib/shop-task/shopping-task-service";
import { getActiveTask, getTask, taskView } from "@/lib/shop-task/shopping-task-store";
import {
  SHOPPING_PHASE_LABELS,
  CANCELLABLE_PHASES,
  type ShoppingTask,
} from "@/lib/shop-task/shopping-task-types";
import { analyzeCurrentProductReviews } from "@/lib/reviews/analysis-service";
import type { ReviewAnalysisReport } from "@/lib/reviews/types";
import { updateTask } from "@/lib/shop-task/shopping-task-store";

// 对话层一次处理的结果：回传最新任务视图、回复文案与本次采用的路由信息。
export type AssistantMessageResult = {
  task?: ShoppingTask | null;
  reply?: string;
  routing: IntentRouting;
  resumeTask?: boolean; // 恢复任务自动推进
  pauseTask?: boolean; // 暂停任务自动推进（如评论分析进行中、自动任务暂缓提交）
  reviewAnalysis?: ReviewAnalysisReport; // 评论分析报告，供前端展示口碑结论
};
// 对话层输入：用户身份、消息原文与幂等键；taskId/quote 用于续接任务或确认下单。
export type AssistantMessageInput = {
  userid: string;
  query: string;
  idempotencyKey: string;
  taskId?: string;
  quote?: { quoteId: string; cartVersion: number };
};

// 对话层只决定路由；交易动作仍调用原任务状态机，不能由模型直接执行。
export async function handleAssistantMessage(
  input: AssistantMessageInput
): Promise<AssistantMessageResult> {
  // 先定位「活动任务」与「本次要操作的任务记录」：无 taskId 时默认取活动任务。
  const active = await getActiveTask(input.userid);
  const record = input.taskId
    ? active?.taskId === input.taskId
      ? active
      : await getTask(input.userid, input.taskId)
    : active;
  const task = record ? taskView(record) : null;
  // 组装对话上下文，供确定性规则和统一模型解析使用。
  const state: DialogueContext = {
    phase: task?.phase,
    dialogue: task?.dialogue,
    product: task?.product,
    // 把已完成的评论分析提炼成上下文（商品/问题/是否完整/已归纳主题），供统一模型判断追问动作。
    reviewContext: task?.reviewAnalysis
      ? {
          productId: task.reviewAnalysis.productId,
          question: task.reviewAnalysis.question,
          complete: task.reviewAnalysis.complete,
          topics: [
            ...task.reviewAnalysis.positives,
            ...task.reviewAnalysis.negatives,
            ...task.reviewAnalysis.mixed,
          ].map((point) => point.topic),
        }
      : undefined,
  };
  // message：只回文案、不回任务视图的短回复构造器。
  const message = (reply: string, routing: IntentRouting): AssistantMessageResult => ({
    task,
    reply,
    routing,
  });
  // status：重新读取任务最新状态并拼成一句话进度回复。
  const status = async (routing: IntentRouting): Promise<AssistantMessageResult> => {
    const latest = record ? taskView(await getTask(input.userid, record.taskId)) : null;
    return {
      task: latest,
      reply: latest
        ? `${SHOPPING_PHASE_LABELS[latest.phase]}${latest.order?.orderGroupId ? `，订单编号：${latest.order.orderGroupId}` : ""}。`
        : "目前没有可查询的购物任务。",
      routing,
    };
  };
  // 传入的 taskId 与当前活动任务不一致时，拒绝操作，避免串任务。
  if (active && input.taskId && active.taskId !== input.taskId) {
    return {
      task: taskView(active),
      reply: "已有另一项购物任务正在执行，请先查看该任务再操作。",
      routing: {
        layer: "rule",
        engine: "rules",
        action: "clarify",
        confidence: 1,
        reason: "active_task_changed",
      },
    };
  }
  // reviews：处理「分析评论」动作。无候选商品时先提示并暂缓提交；
  // 有候选商品时调用评论分析服务，按 busy/empty/complete 三种结果生成回复。
  const reviews = async (routing: IntentRouting): Promise<AssistantMessageResult> => {
    if (!task?.product) {
      let latest = task;
      // 任务处于可取消阶段时，置 reviewHold 暂停自动提交，等待用户先确定候选商品。
      if (task)
        latest = taskView(
          await updateTask(input.userid, task.taskId, (current) => {
            if (CANCELLABLE_PHASES.includes(current.phase)) current.data.reviewHold = true;
          })
        );
      return {
        task: latest,
        reply: "请先确定当前商品。已有自动任务会暂停自动提交，候选商品出现后可再查看评论。",
        routing,
        pauseTask: true,
      };
    }
    // 使用统一识别结果，不再因消息中出现“最近/刷新”等词就重做分析。
    const result = await analyzeCurrentProductReviews({
      userid: input.userid,
      taskId: task.taskId,
      question: input.query,
      refresh: routing.reviewMode === "refresh",
    });
    const reply = result.busy
      ? "当前商品的评论分析正在执行，请稍后查看进度。"
      : result.report.status === "empty"
        ? "当前商品在本次读取范围内没有公开评论，暂不能据此判断口碑。"
        : result.report.complete
          ? `已完成当前商品本次范围内 ${result.report.analyzedCount} 条公开评论的分析。`
          : `已读取 ${result.report.readCount}/${result.report.total} 条，已分析 ${result.report.analyzedCount}/${result.report.total} 条；结果尚不完整，可继续分析或刷新。`;
    return {
      task: result.task,
      reply,
      reviewAnalysis: result.report,
      routing,
      pauseTask: !!result.task.reviewHold,
    };
  };

  // 识别只运行一次；执行能力由本入口和任务状态机分别校验。
  // 取上一轮已识别的意图作为「上文」，传给意图解析用于指代消解与追问衔接。
  const previous = task?.dialogue?.intent;
  // 统一意图解析：本次对话只识别一次，后续动作分发都复用这份解析结果，避免重复调用模型。
  const resolution = await resolveAssistantIntent(
    input.query, // 本次用户原始消息
    // 存在历史意图时，把上一次查询 + 意图摘要拼成一条历史消息，帮助模型理解「它/那个」等指代。
    previous && task ? [{ query: task.query, intentSummary: makeIntentSummary(previous) }] : [],
    state // 当前对话上下文（阶段、商品、评论分析进度等）
  );
  const { routing } = resolution; // 本次路由决策
  const action = routing.action; // 决策出的动作类型
  // 只读能力（分析评论 / 查询状态）在置信度足够时直接分发，不涉及交易状态变更。
  if (action === "analyze_reviews" && routing.confidence >= 0.8) return reviews(routing);
  if (action === "query_status" && routing.confidence >= 0.8) {
    return status(routing);
  }
  // 交易动作「确认下单 / 取消任务」必须同时满足三个条件才执行：
  // 1) 动作属于交易类；2) 由规则引擎（而非模型）命中；3) 命中理由是「精确命令」。
  // 这样保证交易只能由用户的明确指令触发，模型无法擅自下单或取消。
  if (
    (action === "confirm_order" || action === "cancel_task") &&
    routing.engine === "rules" &&
    routing.reason === "exact_command"
  ) {
    // 前置校验：任务必须存在，且传入的 taskId 与当前任务一致，防止操作到别的任务。
    if (!task || input.taskId !== task.taskId)
      return message("请先查看当前购物任务，再确认或取消。", routing);
    if (action === "cancel_task") {
      // 取消前校验任务是否处于可取消阶段，不可取消则直接说明当前状态。
      if (!task.canCancel)
        return message(`当前状态为“${SHOPPING_PHASE_LABELS[task.phase]}”，不能取消。`, routing);
      // 交易动作必须通过任务状态机执行，对话层不能直接改状态。
      const canceled = await actOnShoppingTask(input.userid, task.taskId, "cancel");
      return {
        task: canceled, // 返回取消后的最新任务视图
        reply: `已接受取消。${SHOPPING_PHASE_LABELS[canceled.phase]}。`,
        routing,
        resumeTask: true, // 取消后恢复任务自动推进
      };
    }
    // 走到这里说明命中 confirm_order 分支。
    if (!task.canConfirm)
      return message(`当前状态为“${SHOPPING_PHASE_LABELS[task.phase]}”，还不能确认下单。`, routing);
    // 确认下单前必须核对报价一致性：quote 必须存在，且报价 ID 与购物车版本都要和任务当前报价一致，
    // 防止用户拿着过期报价（价格或库存已变化）下单。
    if (
      !input.quote ||
      input.quote.quoteId !== task.quote?.quote.quoteId ||
      input.quote.cartVersion !== task.quote?.quote.cartVersion
    )
      return message("报价已变化或尚未展示，请核对最新报价后再次确认下单。", routing);
    // 校验通过后，调用任务状态机执行确认下单，并携带用户当前看到的报价快照。
    const confirmed = await actOnShoppingTask(input.userid, task.taskId, "confirm", input.quote);
    return { task: confirmed, reply: `${SHOPPING_PHASE_LABELS[confirmed.phase]}。`, routing };
  }

  // start：把一次已解析的检索意图封装成新购物任务；有活动任务时拒绝，避免替换进行中的交易。
  const start = async (resolution: SearchResolution): Promise<AssistantMessageResult> => {
    // 分类可以读取活动任务，但任何检索变更都不能暗中替换正在执行的交易。
    if (active)
      return message(
        "当前购物任务仍在处理中或等待确认。你可以查询进度，或先明确取消，再修改购物需求。",
        {
          layer: "context",
          engine: "state",
          action: "clarify",
          confidence: 1,
          reason: "active_task_blocks_replacement",
        }
      );
    return {
      task: await createShoppingTask({
        ...input,
        dialogue: {
          intent: resolution.intent,
          routing: resolution.routing,
          unresolvedRequired: [],
          unresolvedPreferences: [],
        },
      }),
      routing: resolution.routing,
      resumeTask: true,
    };
  };
  if (["confirm_order", "cancel_task"].includes(action))
    return message(
      "请明确输入“确认下单”或“取消下单”，也可以使用对应任务按钮。当前消息没有执行交易操作。",
      routing
    );
  if (!isSearchResolution(resolution))
    return message(
      resolution.reply || "请再说明你想找的商品、要补充的条件，或当前想执行的操作。",
      routing
    );
  if (isEmptyIntent(resolution.intent))
    return message("请告诉我想找哪类商品；涉及“它”“那个”时，需要先有明确的候选商品。", routing);
  return start({ intent: resolution.intent, routing });
}
