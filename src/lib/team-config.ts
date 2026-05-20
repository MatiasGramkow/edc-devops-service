import { promises as fs } from "fs";
import path from "path";
import type { TeamConfig, TeamMember } from "@/types/devops";

const CONFIG_DIR = path.join(process.cwd(), "data");
const CONFIG_PATH = path.join(CONFIG_DIR, "team-config.json");

function defaultConfig(): TeamConfig {
  return { version: 1, lastModified: new Date().toISOString(), members: [] };
}

export async function getTeamConfig(): Promise<TeamConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as TeamConfig;
  } catch {
    return defaultConfig();
  }
}

export async function saveTeamConfig(config: TeamConfig): Promise<TeamConfig> {
  config.lastModified = new Date().toISOString();
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

export async function getActiveMembers(): Promise<TeamMember[]> {
  const config = await getTeamConfig();
  return config.members
    .filter((m) => m.active)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
