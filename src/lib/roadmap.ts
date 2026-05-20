import { promises as fs } from "fs";
import path from "path";
import type { RoadmapConfig, RoadmapItem } from "@/types/devops";

const CONFIG_DIR = path.join(process.cwd(), "data");
const ROADMAP_PATH = path.join(CONFIG_DIR, "roadmap.json");

function defaultConfig(): RoadmapConfig {
  return { version: 1, items: [] };
}

export async function getRoadmap(): Promise<RoadmapConfig> {
  try {
    const raw = await fs.readFile(ROADMAP_PATH, "utf-8");
    return JSON.parse(raw) as RoadmapConfig;
  } catch {
    return defaultConfig();
  }
}

export async function saveRoadmap(config: RoadmapConfig): Promise<RoadmapConfig> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(ROADMAP_PATH, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

export async function upsertRoadmapItem(item: RoadmapItem): Promise<RoadmapConfig> {
  const config = await getRoadmap();
  const idx = config.items.findIndex((i) => i.id === item.id);
  if (idx >= 0) {
    config.items[idx] = item;
  } else {
    config.items.push(item);
  }
  return saveRoadmap(config);
}

export async function deleteRoadmapItem(id: string): Promise<RoadmapConfig> {
  const config = await getRoadmap();
  config.items = config.items.filter((i) => i.id !== id);
  return saveRoadmap(config);
}
