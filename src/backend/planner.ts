import type { AgentAction, AgentStepRequest } from "./schemas";

export type AgentPlanner = {
  plan(request: AgentStepRequest): Promise<unknown>;
};

function lower(value: string): string {
  return value.toLowerCase();
}

function visibleEnabledTargets(request: AgentStepRequest) {
  const elementsById = new Map(request.sanitizedElementMap.map((element) => [element.id, element]));

  return request.allowedInteractions.flatMap((interaction) => {
    const element = elementsById.get(interaction.elementId);
    if (!element?.visible || !element.enabled) {
      return [];
    }

    return [{ interaction, element }];
  });
}

function elementText(element: AgentStepRequest["sanitizedElementMap"][number]): string {
  return lower([element.label, element.text, element.role, element.tag].filter(Boolean).join(" "));
}

export const deterministicPlanner: AgentPlanner = {
  async plan(request: AgentStepRequest): Promise<AgentAction> {
    const task = lower(request.userTask);
    const candidates = visibleEnabledTargets(request);

    if (task.includes("scroll")) {
      const target = candidates.find(({ interaction }) => interaction.actions.includes("scroll"));
      if (target) return { action: "scroll", target: target.interaction.elementId };
    }

    if (task.includes("focus")) {
      const target = candidates.find(({ interaction }) => interaction.actions.includes("focus"));
      if (target) return { action: "focus", target: target.interaction.elementId };
    }

    if (task.includes("type")) {
      const target = candidates.find(({ interaction }) => interaction.actions.includes("type_safe_text") && interaction.safeText);
      if (target?.interaction.safeText) {
        return { action: "type_safe_text", target: target.interaction.elementId, text: target.interaction.safeText };
      }
    }

    const submitLike = candidates.find(
      ({ interaction, element }) =>
        interaction.actions.includes("click") &&
        ["submit", "continue", "next", "save", "confirm"].some((token) => elementText(element).includes(token))
    );

    if (submitLike) return { action: "click", target: submitLike.interaction.elementId };

    const clickable = candidates.find(({ interaction }) => interaction.actions.includes("click"));
    if (clickable) return { action: "click", target: clickable.interaction.elementId };

    const focusable = candidates.find(({ interaction }) => interaction.actions.includes("focus"));
    if (focusable) return { action: "focus", target: focusable.interaction.elementId };

    const scrollable = candidates.find(({ interaction }) => interaction.actions.includes("scroll"));
    if (scrollable) return { action: "scroll", target: scrollable.interaction.elementId };

    return { action: "scroll", target: request.allowedInteractions[0]?.elementId ?? "page" };
  }
};
