import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { differenceHint } from "@/app/assistant/difference-hint";
import { AssistantMessages } from "@/app/assistant/assistant-messages";
import type { AssistantResult } from "@/app/assistant/types";
import type { ProductDifference } from "@/lib/catalog/types";

afterEach(cleanup);

const fallback = "这项要求暂时还无法全部满足，你可以查看商品详情，接受当前商品的话就确认下单";
const unknown: ProductDifference = {
  requirement: "佩戴舒适",
  actual: "现有商品信息无法核实该要求",
  status: "unverified",
};

function show(difference: ProductDifference, status: AssistantResult["status"] = "ready_for_confirmation") {
  render(<AssistantMessages
    messages={[{ role: "assistant", text: "请查看商品", result: { status, differences: [difference] } }]}
    busy={false} error="" copyShortLink={vi.fn()} send={vi.fn()} canSend task={null}
  />);
}

describe("assistant difference hints", () => {
  it("uses the agreed price suggestion without inventing a budget", () => {
    show({ ...unknown, requirement: "价格合适" });
    expect(screen.getByText("可以看看上方报价，觉得合适就直接确认下单。")).toBeInTheDocument();
    expect(screen.queryByText(/(?:现有商品信息|商品目录资料)无法核实/)).not.toBeInTheDocument();
  });

  it("explains an unknown feature without claiming it is absent", () => {
    show({ ...unknown, requirement: "支持降噪" });
    expect(screen.getByText("暂时还不能确认这款商品是否支持降噪。你可以查看商品详情，再决定是否下单。")).toBeInTheDocument();
  });

  it("explains ambiguous battery specifications while retaining the facts", () => {
    show({ ...unknown, requirement: "续航至少10小时", actual: "续航：单次6小时，含充电盒30小时" });
    expect(screen.getByText(/实际：续航：单次6小时，含充电盒30小时/)).toBeInTheDocument();
    expect(screen.getByText("商品标注了单次续航和含充电盒续航，暂时不能确定是否符合你的续航要求，请查看上方具体规格。")).toBeInTheDocument();
  });

  it("retains known mismatches and invites acceptance", () => {
    show({ requirement: "续航至少10小时", actual: "单次续航：6小时", status: "not_met" });
    expect(screen.getByText(/要求：续航至少10小时；实际：单次续航：6小时/)).toBeInTheDocument();
    expect(screen.getByText("这款商品与你的要求有以上差异。接受这个差异的话，可以确认下单。")).toBeInTheDocument();
  });

  it.each([
    "现有商品信息无法核实该要求",
    "商品信息中缺少可核实的对应规格",
    "商品目录资料无法核实该要求",
    "目录中缺少可核实的对应规格",
    "",
  ])(
    "uses the exact fallback and hides the technical placeholder %s", (actual) => {
      show({ ...unknown, actual });
      expect(screen.getByText(fallback)).toBeInTheDocument();
      expect(screen.queryByText(/实际：/)).not.toBeInTheDocument();
    },
  );

  it("does not mistake negated or numeric conditions for simple preferences", () => {
    for (const requirement of ["不要降噪", "价格合适且不超过500元", "续航至少10小时"]) {
      expect(differenceHint({ ...unknown, requirement })).toBe(fallback);
    }
  });

  it("does not request another confirmation for an ordered message", () => {
    show(unknown, "ordered");
    expect(screen.getByText("已确认接受的商品差异")).toBeInTheDocument();
    expect(screen.getByText(/确认时尚无法核实是否符合该要求/)).toBeInTheDocument();
    expect(screen.queryByText(fallback)).not.toBeInTheDocument();
    expect(screen.queryByText(/(?:现有商品信息|商品目录资料)无法核实/)).not.toBeInTheDocument();
  });

  it("does not invite confirmation again after a task has failed", () => {
    show(unknown, "failed");
    expect(screen.getByText("本次商品差异")).toBeInTheDocument();
    expect(screen.queryByText("请确认以下商品差异")).not.toBeInTheDocument();
    expect(screen.queryByText(fallback)).not.toBeInTheDocument();
  });
});
