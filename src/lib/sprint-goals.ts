import { promises as fs } from "fs";
import path from "path";
import type { SprintGoalsConfig, SprintGoal } from "@/types/devops";

const CONFIG_DIR = path.join(process.cwd(), "data");
const GOALS_PATH = path.join(CONFIG_DIR, "sprint-goals.json");

function defaultConfig(): SprintGoalsConfig {
  return { version: 1, goals: [] };
}

export async function getSprintGoals(): Promise<SprintGoalsConfig> {
  try {
    const raw = await fs.readFile(GOALS_PATH, "utf-8");
    return JSON.parse(raw) as SprintGoalsConfig;
  } catch {
    return defaultConfig();
  }
}

export async function saveSprintGoals(config: SprintGoalsConfig): Promise<SprintGoalsConfig> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(GOALS_PATH, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

export async function getGoalForSprint(iterationId: string): Promise<SprintGoal | null> {
  const config = await getSprintGoals();
  return config.goals.find((g) => g.iterationId === iterationId) ?? null;
}

export async function setGoalForSprint(iterationId: string, text: string): Promise<SprintGoal> {
  const config = await getSprintGoals();
  const goal: SprintGoal = {
    iterationId,
    text,
    lastModified: new Date().toISOString(),
  };
  const idx = config.goals.findIndex((g) => g.iterationId === iterationId);
  if (idx >= 0) {
    config.goals[idx] = goal;
  } else {
    config.goals.push(goal);
  }
  await saveSprintGoals(config);
  return goal;
}
