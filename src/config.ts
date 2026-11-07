export interface Config {
  model: "deepseek";
  reasoning: "disable" | "low";
  apiKey: string;
}
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const model = env.ZPI_QUICK_CHAT_MODEL ?? "deepseek";
  const reasoning = env.ZPI_QUICK_CHAT_REASONING ?? "disable";
  if (model !== "deepseek") throw new Error("ZPI_QUICK_CHAT_MODEL currently supports only deepseek");
  if (reasoning !== "disable" && reasoning !== "low")
    throw new Error("ZPI_QUICK_CHAT_REASONING must be disable or low");
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required");
  return { model, reasoning, apiKey };
}
