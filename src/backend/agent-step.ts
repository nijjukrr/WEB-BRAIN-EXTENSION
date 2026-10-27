import type { AgentPlanner } from "./planner";
import { deterministicPlanner } from "./planner";
import { validateAgentAction, validateAgentStepRequest, type AgentStepResponse } from "./schemas";

export type AgentStepResult =
  | { status: 200; body: AgentStepResponse }
  | { status: 400; body: { errors: string[] } }
  | { status: 422; body: { errors: string[] } };

export async function handleAgentStep(body: unknown, planner: AgentPlanner = deterministicPlanner): Promise<AgentStepResult> {
  const request = validateAgentStepRequest(body);

  if (!request.ok) {
    return { status: 400, body: { errors: request.errors } };
  }

  const modelContext = {
    trusted: {
      userInstruction: request.value.userTask
    },
    untrusted: {
      webpageContent: request.value.sanitizedElementMap,
      sanitizedScreenshot: request.value.sanitizedScreenshot
    },
    allowedInteractions: request.value.allowedInteractions
  };

  const rawAction = await planner.plan({
    userTask: modelContext.trusted.userInstruction,
    contextRepresentation: request.value.contextRepresentation,
    sanitizedScreenshot: modelContext.untrusted.sanitizedScreenshot,
    sanitizedElementMap: modelContext.untrusted.webpageContent,
    allowedInteractions: modelContext.allowedInteractions
  });
  const action = validateAgentAction(rawAction, request.value);

  if (!action.ok) {
    return { status: 422, body: { errors: action.errors } };
  }

  return { status: 200, body: action.value };
}
