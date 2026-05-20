import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { getCached, setCache } from "./cache";
import type { AISummaryResult, AISummaryRelevantFile } from "@/types/devops";

const execFileAsync = promisify(execFile);

const CODEBASE_PATH = process.env.RELATED_CODEBASE_PATH || "";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must", "ought",
  "not", "no", "nor", "and", "or", "but", "if", "then", "else", "when",
  "at", "by", "for", "with", "about", "against", "between", "through",
  "during", "before", "after", "above", "below", "to", "from", "up",
  "down", "in", "out", "on", "off", "over", "under", "again", "further",
  "once", "here", "there", "all", "each", "every", "both", "few", "more",
  "most", "other", "some", "such", "only", "own", "same", "so", "than",
  "too", "very", "just", "because", "as", "until", "while", "of", "it",
  "this", "that", "these", "those", "what", "which", "who", "whom",
  "how", "where", "why", "we", "they", "them", "its", "my", "your",
  // DevOps/task words
  "fix", "bug", "task", "implement", "update", "add", "remove", "change",
  "make", "ensure", "check", "test", "create", "delete", "move", "set",
  "get", "new", "old", "also", "like", "use", "using", "used", "etc",
  "see", "via", "done", "pbi", "item", "work", "sprint", "story",
]);

export function isCodebaseAvailable(): boolean {
  return !!CODEBASE_PATH && existsSync(CODEBASE_PATH);
}

function extractKeywords(title: string, description: string, ac: string): string[] {
  const text = `${title} ${description} ${ac}`;

  // Extract PascalCase/CamelCase identifiers (component names, class names)
  const identifiers = text.match(/[A-Z][a-zA-Z]{3,}/g) || [];

  // Extract regular words
  const words = text
    .replace(/<[^>]*>/g, "")
    .replace(/[^a-zA-ZæøåÆØÅ0-9\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  // Count frequency
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  // Identifiers get a boost
  for (const id of identifiers) {
    freq.set(id, (freq.get(id) ?? 0) + 3);
  }

  // Sort by frequency, take top 8
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

async function searchCodebase(keywords: string[]): Promise<AISummaryRelevantFile[]> {
  if (!CODEBASE_PATH || keywords.length === 0) return [];

  const excludeDirs = ["node_modules", "bin", "obj", ".yarn", "dist", "static", "wwwroot", ".pnp", ".next", "generated"];
  const excludeArgs = excludeDirs.flatMap((d) => ["--exclude-dir", d]);
  const includeArgs = ["--include=*.tsx", "--include=*.ts", "--include=*.cs", "--include=*.cshtml"];

  const allMatches = new Map<string, { count: number; snippet: string }>();

  // Search each keyword in parallel
  await Promise.all(
    keywords.slice(0, 6).map(async (keyword) => {
      try {
        const { stdout } = await execFileAsync(
          "grep",
          ["-rl", "-i", ...excludeArgs, ...includeArgs, keyword, CODEBASE_PATH],
          { timeout: 3000, maxBuffer: 1024 * 256 }
        );
        const files = stdout.trim().split("\n").filter(Boolean);
        for (const file of files.slice(0, 30)) {
          const rel = file.replace(CODEBASE_PATH + "/", "");
          const existing = allMatches.get(rel);
          if (existing) {
            existing.count++;
          } else {
            allMatches.set(rel, { count: 1, snippet: "" });
          }
        }
      } catch {
        // grep returns exit 1 when no matches — ignore
      }
    })
  );

  // Get snippets for top files
  const ranked = [...allMatches.entries()]
    .map(([path, data]) => {
      // Score: keyword hits + path relevance bonus
      let score = data.count;
      if (path.includes("Frontend/src/modules/")) score += 2;
      if (path.includes("Frontend/src/components/")) score += 1;
      if (path.includes("Edc.Website.Core/")) score += 1;
      if (path.includes("Controllers/")) score += 1;
      // Penalize test/mock files
      if (path.includes(".mock.") || path.includes(".test.") || path.includes(".spec.") || path.includes("Tests/")) score -= 2;
      return { path, score, snippet: "" };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  // Fetch snippets for top files
  await Promise.all(
    ranked.map(async (file) => {
      try {
        const { stdout } = await execFileAsync(
          "grep",
          ["-n", "-i", "-m", "1", ...excludeArgs, keywords[0], `${CODEBASE_PATH}/${file.path}`],
          { timeout: 2000 }
        );
        file.snippet = stdout.trim().slice(0, 120);
      } catch {
        // ignore
      }
    })
  );

  return ranked.map((f) => ({ path: f.path, snippet: f.snippet }));
}

function inferModule(files: AISummaryRelevantFile[]): string | null {
  // Try to find the most common module from file paths
  const modules = new Map<string, number>();
  for (const f of files) {
    const moduleMatch = f.path.match(/Frontend\/src\/modules\/([^/]+)/);
    if (moduleMatch) {
      modules.set(moduleMatch[1], (modules.get(moduleMatch[1]) ?? 0) + 1);
    }
    const coreMatch = f.path.match(/Edc\.Website\.Core\/([^/]+)/);
    if (coreMatch) {
      modules.set(coreMatch[1], (modules.get(coreMatch[1]) ?? 0) + 1);
    }
  }
  if (modules.size === 0) return null;
  return [...modules.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function generateRuleBasedSummary(
  title: string,
  files: AISummaryRelevantFile[],
  keywords: string[]
): string[] {
  const summary: string[] = [];

  const module = inferModule(files);
  if (module) {
    summary.push(`Related to the **${module}** area of the codebase`);
  }

  const frontendFiles = files.filter((f) => f.path.startsWith("Frontend/"));
  const backendFiles = files.filter((f) => f.path.includes("Edc.Website."));

  if (frontendFiles.length > 0 && backendFiles.length > 0) {
    summary.push(`Touches both frontend (${frontendFiles.length} files) and backend (${backendFiles.length} files)`);
  } else if (frontendFiles.length > 0) {
    summary.push(`Primarily a frontend change (${frontendFiles.length} files found)`);
  } else if (backendFiles.length > 0) {
    summary.push(`Primarily a backend change (${backendFiles.length} files found)`);
  }

  // List top 3 most relevant files
  const topFiles = files.slice(0, 3);
  if (topFiles.length > 0) {
    summary.push(`Key files: ${topFiles.map((f) => `\`${f.path.split("/").slice(-2).join("/")}\``).join(", ")}`);
  }

  // Controllers
  const controllers = files.filter((f) => f.path.includes("Controller"));
  if (controllers.length > 0) {
    summary.push(`API endpoints in: ${controllers.map((f) => `\`${f.path.split("/").pop()}\``).join(", ")}`);
  }

  // React components
  const components = files.filter((f) => f.path.endsWith(".tsx") && f.path.includes("/modules/"));
  if (components.length > 0) {
    const names = components.slice(0, 3).map((f) => {
      const name = f.path.split("/").pop()?.replace(".tsx", "") ?? "";
      return `\`${name}\``;
    });
    summary.push(`React components: ${names.join(", ")}`);
  }

  if (summary.length === 0) {
    summary.push(`No matching files found for keywords: ${keywords.slice(0, 4).join(", ")}`);
  }

  return summary;
}

async function generateAIContent(
  title: string,
  description: string,
  ac: string,
  files: AISummaryRelevantFile[]
): Promise<string[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey });

    const fileContext = files
      .slice(0, 6)
      .map((f) => `- ${f.path}${f.snippet ? `: ${f.snippet}` : ""}`)
      .join("\n");

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `You are analyzing a work item for a sprint planning meeting. The codebase is an edc.dk real estate website (.NET 8 + Umbraco 13 + React 18 + TypeScript).

Work item: "${title}"
${description ? `Description: ${description.slice(0, 500)}` : ""}
${ac ? `Acceptance Criteria: ${ac.slice(0, 500)}` : ""}

Relevant files found in the codebase:
${fileContext || "No files found"}

Provide exactly 3-5 bullet points (one per line, starting with "- "):
1. What this work item is about (one sentence)
2. Where in the codebase this is relevant (specific files/modules)
3. Suggested approach or solution ideas
4. Any risks or things to watch out for (if applicable)

Be concise and specific. Reference actual file paths from the list above. Answer in English.`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";
    const bullets = text
      .split("\n")
      .filter((line) => line.trim().startsWith("- ") || line.trim().startsWith("• "))
      .map((line) => line.replace(/^[\s\-•]+/, "").trim())
      .filter((line) => line.length > 0)
      .slice(0, 5);

    return bullets.length > 0 ? bullets : null;
  } catch (err) {
    console.error("OpenAI summary error:", err);
    return null;
  }
}

export async function generateAISummary(input: {
  workItemId: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
}): Promise<AISummaryResult> {
  // Check cache
  const cacheKey = `ai-summary:${input.workItemId}`;
  const cached = getCached<AISummaryResult>(cacheKey);
  if (cached) return cached;

  const keywords = extractKeywords(input.title, input.description, input.acceptanceCriteria);
  const files = await searchCodebase(keywords);

  // Try AI-powered summary first, fall back to rule-based
  const aiSummary = await generateAIContent(input.title, input.description, input.acceptanceCriteria, files);
  const summary = aiSummary ?? generateRuleBasedSummary(input.title, files, keywords);

  const result: AISummaryResult = {
    workItemId: input.workItemId,
    summary,
    relevantFiles: files,
    generatedAt: new Date().toISOString(),
  };

  setCache(cacheKey, result, CACHE_TTL);
  return result;
}
