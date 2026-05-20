import OpenAI from "openai";
import type { TopdeskTicket } from "@/lib/topdesk-client";

export interface TopdeskParseResult {
  title: string;
  type: "Product Backlog Item" | "Bug";
  description: string;
  acceptanceCriteria: string;
  priority: number;
  tags: string[];
  topdeskTicketNumber: string | null;
  confidence: number;
}

// --- TOPdesk priority (1-5) → Azure DevOps priority (1-4) ---
function mapPriority(topdeskPriority: number): number {
  if (topdeskPriority <= 2) return 1; // Critical
  if (topdeskPriority === 3) return 2; // High
  if (topdeskPriority === 4) return 3; // Medium
  return 4; // Low
}

// --- Bug detection heuristics (Danish + English) ---
const BUG_INDICATORS = [
  "fejl", "virker ikke", "broken", "crash", "error", "bug",
  "500", "404", "503", "exception", "null", "undefined",
  "forkert", "mangler", "ikke muligt", "kan ikke", "defekt",
  "fungerer ikke", "problem", "issue", "regression", "fail",
];

function looksLikeBug(text: string): boolean {
  const lower = text.toLowerCase();
  return BUG_INDICATORS.some((indicator) => lower.includes(indicator));
}

// --- Extract TOPdesk fields via regex ---
function preParseTopdesk(rawText: string): {
  ticketNumber: string | null;
  priority: number | null;
  category: string | null;
  isBug: boolean;
  callerName: string | null;
} {
  // Ticket number: "2603-2176" pattern
  const ticketMatch = rawText.match(/\b(\d{4}-\d{4})\b/);

  // Priority: "Priority 3" or "5. Meget lav" or "4. Lav - 32 timer"
  let priority: number | null = null;
  const prioMatch = rawText.match(/Priority[:\s]*(\d)/i)
    || rawText.match(/(\d)\.\s*(Kritisk|Høj|Medium|Lav|Meget lav)/i);
  if (prioMatch) priority = Number(prioMatch[1]);

  // Category: look for known patterns
  let category: string | null = null;
  if (/EDC\.DK/i.test(rawText)) {
    const catMatch = rawText.match(/EDC\.DK\s*[-:·]\s*([^\n,]+)/i);
    category = catMatch ? `EDC.DK - ${catMatch[1].trim()}` : "EDC.DK";
  } else if (/MIT EDC/i.test(rawText)) {
    category = "MIT EDC App";
  } else if (/Sagsvisning/i.test(rawText)) {
    category = "Sagsvisning";
  }

  // Caller name
  const callerMatch = rawText.match(/^([A-ZÆØÅ][a-zæøå]+\s[A-ZÆØÅ][a-zæøå]+)/m);

  return {
    ticketNumber: ticketMatch?.[1] ?? null,
    priority,
    category,
    isBug: looksLikeBug(rawText),
    callerName: callerMatch?.[1] ?? null,
  };
}

// --- Rule-based fallback (no AI) ---
function buildFallbackResult(rawText: string): TopdeskParseResult {
  const parsed = preParseTopdesk(rawText);

  // Extract a title from the first meaningful line
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  let title = lines[0] ?? "New work item";
  // If first line looks like a ticket number or name, try to find a better title
  if (/^\d{4}-\d{4}/.test(title) && lines.length > 1) title = lines[1];
  if (title.length > 100) title = title.slice(0, 97) + "...";

  const type = parsed.isBug ? "Bug" : "Product Backlog Item";
  const priority = parsed.priority != null ? mapPriority(parsed.priority) : 3;

  const tags: string[] = [];
  if (parsed.category) tags.push(parsed.category);
  if (parsed.ticketNumber) tags.push(`TOPdesk:${parsed.ticketNumber}`);

  // Build description HTML
  const descParts: string[] = [];
  if (parsed.ticketNumber) descParts.push(`<p><strong>TOPdesk Ticket:</strong> ${parsed.ticketNumber}</p>`);
  if (parsed.category) descParts.push(`<p><strong>Category:</strong> ${parsed.category}</p>`);
  if (parsed.callerName) descParts.push(`<p><strong>Reporter:</strong> ${parsed.callerName}</p>`);
  descParts.push(`<hr/><p>${rawText.replace(/\n/g, "<br/>")}</p>`);

  return {
    title,
    type,
    description: descParts.join("\n"),
    acceptanceCriteria: "",
    priority,
    tags,
    topdeskTicketNumber: parsed.ticketNumber,
    confidence: 0.3,
  };
}

const SYSTEM_PROMPT = `You are a technical product owner for the edc.dk real estate website (Danish).
You transform support ticket content into Azure DevOps work items.

Output ONLY valid JSON (no markdown fences, no explanation):
{
  "title": "Clean, concise English title (max 80 chars)",
  "type": "Product Backlog Item" or "Bug",
  "description": "HTML description with sections: <h3>Problem/Request</h3><p>...</p><h3>Context</h3><p>TOPdesk ref, category, reporter</p>",
  "acceptanceCriteria": "<ul><li>Testable acceptance criterion 1</li><li>Criterion 2</li></ul>",
  "priority": 1-4,
  "tags": ["tag1", "tag2"]
}

Rules:
- Title MUST be English, even if input is Danish
- Description in English, but preserve Danish quotes/names verbatim
- Type = "Bug" if something is broken/wrong. "Product Backlog Item" for requests/enhancements
- Include TOPdesk ticket number in description if found
- Tags: include area (e.g. "Sagsvisning", "MIT EDC", "EDC.DK") + "TOPdesk:{number}" if found
- Priority: 1=Critical, 2=High, 3=Medium, 4=Low
- Acceptance criteria should be specific, testable conditions`;

function parseAiResponse(content: string, fallback: TopdeskParseResult, ticketNumber: string | null): TopdeskParseResult {
  // Strip markdown code fences if present
  let jsonStr = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  // Try to extract JSON object if response contains surrounding text
  if (!jsonStr.startsWith("{")) {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) return { ...fallback, confidence: 0.2 };
    jsonStr = match[0];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ...fallback, confidence: 0.2 };
  }
  const result: TopdeskParseResult = {
    title: typeof parsed.title === "string" ? parsed.title.slice(0, 120) : fallback.title,
    type: parsed.type === "Bug" ? "Bug" : "Product Backlog Item",
    description: typeof parsed.description === "string" ? parsed.description : fallback.description,
    acceptanceCriteria: typeof parsed.acceptanceCriteria === "string" ? parsed.acceptanceCriteria : "",
    priority: typeof parsed.priority === "number" && parsed.priority >= 1 && parsed.priority <= 4 ? parsed.priority : fallback.priority,
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown) => typeof t === "string") : fallback.tags,
    topdeskTicketNumber: ticketNumber ?? (typeof parsed.topdeskTicketNumber === "string" ? parsed.topdeskTicketNumber : null),
    confidence: 0.85,
  };
  // Ensure TOPdesk tag
  if (result.topdeskTicketNumber && !result.tags.some((t) => t.includes(result.topdeskTicketNumber!))) {
    result.tags.push(`TOPdesk:${result.topdeskTicketNumber}`);
  }
  return result;
}

// --- AI transformation from image(s) via GPT-4o vision ---
export async function transformTopdeskImage(imageBase64List: string[], accompanyingText?: string): Promise<TopdeskParseResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const fallback: TopdeskParseResult = {
    title: "New work item (from image)",
    type: "Product Backlog Item",
    description: "<p>Created from uploaded screenshot(s)</p>",
    acceptanceCriteria: "",
    priority: 3,
    tags: [],
    topdeskTicketNumber: null,
    confidence: 0.1,
  };

  if (!apiKey || imageBase64List.length === 0) return fallback;

  // If we have accompanying text, use it as fallback and for pre-parsing
  if (accompanyingText) {
    const preParsed = preParseTopdesk(accompanyingText);
    const textFallback = buildFallbackResult(accompanyingText);
    Object.assign(fallback, textFallback);
    if (preParsed.ticketNumber) fallback.topdeskTicketNumber = preParsed.ticketNumber;
  }

  try {
    const client = new OpenAI({ apiKey });

    const imageContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = imageBase64List.map((b64) => ({
      type: "image_url" as const,
      image_url: { url: b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`, detail: "high" as const },
    }));

    const userTextParts: string[] = [];
    if (accompanyingText) {
      userTextParts.push(`The user provided the following text description along with the screenshot(s):\n\n---\n${accompanyingText.slice(0, 4000)}\n---\n\nUse BOTH the text above AND the screenshot(s) below to create the work item. The text provides context and the screenshots may show additional details like browser state, error messages, or UI issues.`);
    } else {
      userTextParts.push("Read the TOPdesk support ticket from the screenshot(s) below. Extract all relevant information (ticket number, title, description, caller info, priority, category) and transform into a structured Azure DevOps work item.");
    }

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.3,
      max_tokens: 1000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userTextParts[0] },
            ...imageContent,
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return fallback;

    return parseAiResponse(content, fallback, fallback.topdeskTicketNumber);
  } catch (error) {
    console.error("TOPdesk image AI transformation error:", error);
    return fallback;
  }
}

// --- AI transformation from a structured TOPdesk ticket (preferred path) ---
// Builds a focused prompt that includes both the conversation history (request stream)
// and the structured metadata (priority, category, caller). Yields higher-confidence
// results than parsing free-form pasted text.
export async function transformTopdeskTicket(ticket: TopdeskTicket): Promise<TopdeskParseResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  const fallbackPriority = ticket.priorityLevel != null ? mapPriority(ticket.priorityLevel) : 3;
  const fallbackType: "Bug" | "Product Backlog Item" = looksLikeBug(`${ticket.title}\n${ticket.request ?? ""}`) ? "Bug" : "Product Backlog Item";

  const tags: string[] = [`TOPdesk:${ticket.number}`];
  if (ticket.category) tags.push(ticket.category);

  const fallback: TopdeskParseResult = {
    title: ticket.title.slice(0, 120),
    type: fallbackType,
    description: `<p>${(ticket.request ?? "").replace(/\n/g, "<br/>")}</p>`,
    acceptanceCriteria: "",
    priority: fallbackPriority,
    tags,
    topdeskTicketNumber: ticket.number,
    confidence: 0.4,
  };

  if (!apiKey) return fallback;

  const structuredContext = [
    `TOPdesk Ticket Number: ${ticket.number}`,
    ticket.externalNumber ? `External Reference: ${ticket.externalNumber}` : null,
    `Ticket Title (briefDescription): ${ticket.title}`,
    ticket.callerName ? `Reported By: ${ticket.callerName}${ticket.callerEmail ? ` <${ticket.callerEmail}>` : ""}` : null,
    ticket.category ? `Category: ${ticket.category}${ticket.subcategory ? ` / ${ticket.subcategory}` : ""}` : null,
    ticket.priority ? `TOPdesk Priority: ${ticket.priority}` : null,
    ticket.callType ? `Call Type: ${ticket.callType}` : null,
    ticket.entryType ? `Entry Type: ${ticket.entryType}` : null,
    ticket.impact ? `Impact: ${ticket.impact}` : null,
    ticket.urgency ? `Urgency: ${ticket.urgency}` : null,
  ].filter(Boolean).join("\n");

  const userContent = `STRUCTURED FIELDS:\n${structuredContext}\n\n---\n\nCONVERSATION / REQUEST CONTENT:\n${(ticket.request ?? "").slice(0, 5000)}`;

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 1000,
      messages: [
        { role: "system", content: STRUCTURED_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return fallback;

    return parseAiResponse(content, fallback, ticket.number);
  } catch (error) {
    console.error("TOPdesk ticket AI transformation error:", error);
    return fallback;
  }
}

const STRUCTURED_SYSTEM_PROMPT = `You are a technical product owner for the edc.dk real estate website (Danish company).
You receive a TOPdesk support ticket with both structured fields AND a conversation/request stream, and transform it into an Azure DevOps work item.

Output ONLY valid JSON (no markdown fences, no explanation):
{
  "title": "Clean, concise English title (max 80 chars). Should describe the work to do, not 'Issue from John'.",
  "type": "Product Backlog Item" or "Bug",
  "description": "HTML description with sections: <h3>Problem / Request</h3><p>...</p><h3>Context from Reporter</h3><p>relevant quotes/details from the reporter (preserve Danish if helpful)</p><h3>Suggested Approach</h3><p>technical hints if you can infer any</p>",
  "acceptanceCriteria": "<ul><li>Testable criterion 1</li><li>Criterion 2</li><li>Criterion 3</li></ul>",
  "priority": 1-4,
  "tags": ["tag1", "tag2"]
}

Rules:
- Title MUST be English. Bug titles describe WHAT IS WRONG. PBI titles describe what to BUILD.
- Description in English (you may quote Danish text verbatim in blockquotes where it clarifies user intent)
- Type = "Bug" if the structured fields/content describe something broken, failing, or wrong. "Product Backlog Item" for new features/requests.
- Priority mapping: P1 = critical/blocker, P2 = high (affects many users), P3 = medium (default), P4 = low.
  Map TOPdesk priority: "1./2." → P1, "3." → P2, "4." → P3, "5." → P4.
- Tags: include the TOPdesk category (e.g., "EDC.DK", "MIT EDC", "Sagsvisning") and any clear feature area.
- DO NOT include a "TOPdesk: <number>" tag — that is added automatically by the system.
- Acceptance criteria: 2-5 specific, testable conditions. For bugs: "X no longer happens", "Y works as expected".
- DO NOT repeat the TOPdesk metadata banner in the description — it is prepended automatically. Start description directly with the technical content.`;

// --- AI transformation via GPT-4o-mini (text) ---
export async function transformTopdeskInput(rawText: string): Promise<TopdeskParseResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const preParsed = preParseTopdesk(rawText);
  const fallback = buildFallbackResult(rawText);

  if (!apiKey) return fallback;

  try {
    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 800,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: rawText.slice(0, 4000) },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return fallback;

    return parseAiResponse(content, fallback, preParsed.ticketNumber);
  } catch (error) {
    console.error("TOPdesk AI transformation error:", error);
    return fallback;
  }
}
