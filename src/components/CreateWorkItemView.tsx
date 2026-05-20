"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import clsx from "clsx";
import type { Iteration } from "@/types/devops";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";
import { RichHtmlContent } from "./RichHtmlContent";

interface CreateWorkItemViewProps {
  iterations: Iteration[];
  availableAssignees: string[];
}

type WorkItemType = "Product Backlog Item" | "Bug";
type Phase = "input" | "review" | "success";

interface ChildTaskDraft {
  id: string;
  activity: string;
  title: string;
  hours: number;
  assignee: string;
}

interface CreatedResult {
  id: number;
  url: string;
  type: string;
  title: string;
  childTaskIds: number[];
  topdeskNumber: string | null;
}

interface TopdeskTicketLite {
  id: string;
  number: string;
  externalNumber: string | null;
  webUrl: string;
  title: string;
  callerName: string | null;
  callerEmail: string | null;
  category: string | null;
  subcategory: string | null;
  priority: string | null;
  priorityLevel: number | null;
  operatorName: string | null;
  callDate: string | null;
  processingStatus: string | null;
  closed: boolean;
}

const TASK_PRESETS = [
  { key: "dev", label: "Development", activity: "Development", color: "bg-accent-blue text-white" },
  { key: "qa", label: "QA", activity: "QA", color: "bg-accent-gold text-white" },
  { key: "release", label: "Release", activity: "Release", color: "bg-stale-fresh text-white" },
] as const;

const PRIORITY_OPTIONS = [
  { value: 1, label: "1 — Critical", color: "text-stale-ancient" },
  { value: 2, label: "2 — High", color: "text-stale-stale" },
  { value: 3, label: "3 — Medium", color: "text-accent-blue" },
  { value: 4, label: "4 — Low", color: "text-text-muted" },
];

function getRelevantSprints(iterations: Iteration[]) {
  const now = new Date();
  return iterations
    .filter((i) => !i.finishDate || new Date(i.finishDate) >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
    .sort((a, b) => {
      if (!a.startDate) return -1;
      if (!b.startDate) return 1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });
}

function getCurrentSprintPath(iterations: Iteration[]): string {
  const now = new Date();
  const current = iterations.find((i) => {
    if (!i.startDate || !i.finishDate) return false;
    return new Date(i.startDate) <= now && new Date(i.finishDate) >= now;
  });
  return current?.path ?? "";
}

export function CreateWorkItemView({ iterations, availableAssignees }: CreateWorkItemViewProps) {
  // Phase
  const [phase, setPhase] = useState<Phase>("input");

  // Input phase
  const [rawInput, setRawInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);

  // TOPdesk lookup
  const [topdeskNumber, setTopdeskNumber] = useState("");
  const [topdeskLoading, setTopdeskLoading] = useState(false);
  const [topdeskTicket, setTopdeskTicket] = useState<TopdeskTicketLite | null>(null);

  // Images
  const [images, setImages] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form fields
  const [workItemType, setWorkItemType] = useState<WorkItemType>("Product Backlog Item");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [priority, setPriority] = useState(3);
  const [tags, setTags] = useState("");
  const [iterationPath, setIterationPath] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [refinement, setRefinement] = useState(true);
  const [sprintPlanning, setSprintPlanning] = useState(false);
  const [parentId, setParentId] = useState("");
  const [parentTitle, setParentTitle] = useState<string | null>(null);
  const [parentLoading, setParentLoading] = useState(false);

  // Child tasks
  const [childTasks, setChildTasks] = useState<ChildTaskDraft[]>([]);
  const [taskHours, setTaskHours] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [tasksOpen, setTasksOpen] = useState(false);

  // Preview toggle
  const [previewDesc, setPreviewDesc] = useState(false);
  const [previewAC, setPreviewAC] = useState(false);

  // Creation
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedResult | null>(null);

  // Original input collapsed in review
  const [inputCollapsed, setInputCollapsed] = useState(true);

  // Set default sprint (only on first mount)
  const sprintInitialized = useRef(false);
  useEffect(() => {
    if (iterations.length > 0 && !sprintInitialized.current) {
      sprintInitialized.current = true;
      setIterationPath(getCurrentSprintPath(iterations));
    }
  }, [iterations]);

  // Resolve parent title when ID changes
  const parentDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const id = Number(parentId);
    if (!id || !Number.isInteger(id) || id <= 0) {
      setParentTitle(null);
      return;
    }
    setParentLoading(true);
    clearTimeout(parentDebounce.current);
    parentDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/work-items?action=details&id=${id}`);
        const data = await res.json();
        if (data.title) {
          setParentTitle(`${data.type}: ${data.title}`);
        } else {
          setParentTitle(null);
        }
      } catch {
        setParentTitle(null);
      } finally {
        setParentLoading(false);
      }
    }, 500);
  }, [parentId]);

  // Image helpers
  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addImageFiles(files: FileList | File[]) {
    const validFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (validFiles.length === 0) return;
    const newImages: string[] = [];
    for (const file of validFiles.slice(0, 5 - images.length)) {
      const dataUrl = await readFileAsDataUrl(file);
      newImages.push(dataUrl);
    }
    setImages((prev) => [...prev, ...newImages].slice(0, 5));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) addImageFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }

  // Clipboard paste for images
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0 && phase === "input") {
        e.preventDefault();
        addImageFiles(imageFiles);
      }
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  });

  // AI analyze
  const handleAnalyze = useCallback(async () => {
    const hasText = rawInput.trim().length >= 10;
    const hasImages = images.length > 0;
    if (!hasText && !hasImages) return;
    setAiLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (hasText) body.rawText = rawInput;
      if (hasImages) body.images = images;
      const res = await fetch("/api/create-work-item/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Analysis failed");
        return;
      }

      setTitle(data.title || "");
      setWorkItemType(data.type === "Bug" ? "Bug" : "Product Backlog Item");
      setDescription(data.description || "");
      setAcceptanceCriteria(data.acceptanceCriteria || "");
      setPriority(data.priority || 3);
      setTags(Array.isArray(data.tags) ? data.tags.join("; ") : "");
      setAiUsed(data.aiAvailable !== false);
      setPhase("review");
    } catch {
      setError("Connection error");
    } finally {
      setAiLoading(false);
    }
  }, [rawInput, images]);

  // Fill manually (skip AI)
  const handleManual = useCallback(() => {
    setAiUsed(false);
    setPhase("review");
  }, []);

  // Fetch TOPdesk ticket and auto-fill via AI
  const fetchTopdeskByNumber = useCallback(async (num: string) => {
    const trimmed = num.trim();
    if (!trimmed) return;
    setTopdeskLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/create-work-item/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topdeskNumber: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not fetch ticket from TOPdesk");
        return;
      }

      setTitle(data.title || "");
      setWorkItemType(data.type === "Bug" ? "Bug" : "Product Backlog Item");
      setDescription(data.description || "");
      setAcceptanceCriteria(data.acceptanceCriteria || "");
      setPriority(data.priority || 3);
      setTags(Array.isArray(data.tags) ? data.tags.join("; ") : "");
      setAiUsed(data.aiAvailable !== false);
      if (data.topdeskTicket) setTopdeskTicket(data.topdeskTicket as TopdeskTicketLite);
      setPhase("review");
    } catch {
      setError("Connection error — could not reach TOPdesk");
    } finally {
      setTopdeskLoading(false);
    }
  }, []);

  const handleFetchTopdesk = useCallback(() => {
    return fetchTopdeskByNumber(topdeskNumber);
  }, [fetchTopdeskByNumber, topdeskNumber]);

  // Auto-fetch when arriving from TOPdesk Inbox via ?topdeskFetch=<number>
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const autoFetchRef = useRef<string | null>(null);
  useEffect(() => {
    const num = searchParams.get("topdeskFetch");
    if (!num || autoFetchRef.current === num) return;
    autoFetchRef.current = num;
    setTopdeskNumber(num);
    fetchTopdeskByNumber(num);
    // Strip the param so refresh / back-button doesn't refire
    const next = new URLSearchParams(searchParams.toString());
    next.delete("topdeskFetch");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [searchParams, fetchTopdeskByNumber, router, pathname]);

  // Add child task
  const addChildTask = useCallback((preset: typeof TASK_PRESETS[number]) => {
    const hours = Number(taskHours);
    if (!hours || hours <= 0) return;
    setChildTasks((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${preset.key}`,
        activity: preset.activity,
        title: `${preset.label}: ${title || "New item"}`,
        hours,
        assignee: taskAssignee,
      },
    ]);
    setTaskHours("");
  }, [taskHours, taskAssignee, title]);

  const removeChildTask = useCallback((id: string) => {
    setChildTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Create work item
  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        type: workItemType,
        title: title.trim(),
        description: description || undefined,
        acceptanceCriteria: acceptanceCriteria || undefined,
        priority,
        tags: tags || undefined,
        iterationPath: iterationPath || undefined,
        assignedTo: assignedTo || undefined,
        refinement,
        sprintPlanning,
      };

      const pid = Number(parentId);
      if (pid > 0) body.parentId = pid;

      if (childTasks.length > 0) {
        body.childTasks = childTasks.map((ct) => ({
          title: ct.title,
          activity: ct.activity,
          remainingWork: ct.hours,
          assignedTo: ct.assignee || undefined,
        }));
      }

      if (topdeskTicket) {
        body.topdeskTicket = topdeskTicket;
      }

      const res = await fetch("/api/create-work-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create work item");
        return;
      }
      setCreated(data);
      setPhase("success");
    } catch {
      setError("Connection error");
    } finally {
      setCreating(false);
    }
  }, [workItemType, title, description, acceptanceCriteria, priority, tags, iterationPath, assignedTo, refinement, sprintPlanning, parentId, childTasks, topdeskTicket]);

  // Reset
  const handleReset = useCallback(() => {
    setPhase("input");
    setRawInput("");
    setImages([]);
    setTopdeskNumber("");
    setTopdeskTicket(null);
    setTopdeskLoading(false);
    setTitle("");
    setDescription("");
    setAcceptanceCriteria("");
    setPriority(3);
    setTags("");
    setAssignedTo("");
    setRefinement(true);
    setSprintPlanning(false);
    setParentId("");
    setParentTitle(null);
    setChildTasks([]);
    setTaskHours("");
    setTaskAssignee("");
    setTasksOpen(false);
    setCreated(null);
    setError(null);
    setAiUsed(false);
    setPreviewDesc(false);
    setPreviewAC(false);
    setInputCollapsed(true);
    setWorkItemType("Product Backlog Item");
    sprintInitialized.current = false;
  }, []);

  const relevantSprints = useMemo(() => getRelevantSprints(iterations), [iterations]);
  const totalChildHours = childTasks.reduce((s, t) => s + t.hours, 0);

  // --- SUCCESS PHASE ---
  if (phase === "success" && created) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-xl border border-stale-fresh/30 bg-stale-fresh/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <svg className="h-6 w-6 text-stale-fresh" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <h3 className="text-lg font-bold text-text-primary">Work item created</h3>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <WorkItemTypeIcon type={created.type} />
                <span className="font-mono text-text-muted">#{created.id}</span>
                <span className="text-text-secondary">{created.title}</span>
              </div>
              {created.childTaskIds.length > 0 && (
                <p className="mt-1 text-xs text-text-muted">
                  + {created.childTaskIds.length} child task{created.childTaskIds.length !== 1 ? "s" : ""} created
                </p>
              )}
              {created.topdeskNumber && (
                <p className="mt-1 text-xs text-accent-blue">
                  📥 Linked to TOPdesk ticket {created.topdeskNumber}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <a
              href={created.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-blue/90"
            >
              Open in Azure DevOps
            </a>
            <button
              onClick={handleReset}
              className="rounded-lg bg-bg-secondary px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-card-hover"
            >
              Create Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- INPUT PHASE ---
  if (phase === "input") {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-xl border border-border-default bg-bg-card">
          <div className="border-b border-border-default/50 px-6 py-4">
            <h2 className="text-lg font-bold text-text-primary">Create Work Item</h2>
            <p className="mt-1 text-sm text-text-muted">
              Paste a TOPdesk ticket, support request, or describe the work item. AI will help structure it.
            </p>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* TOPdesk ticket lookup — primary path */}
            <div className="rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-4 py-3">
              <div className="mb-2 flex items-center gap-2">
                <svg className="h-4 w-4 text-accent-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9-5 9 5m-18 0v8a2 2 0 002 2h14a2 2 0 002-2V8m-18 0l9 5 9-5" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wider text-accent-blue">From TOPdesk Ticket</span>
                <span className="ml-1 text-[10px] text-text-muted/60">recommended</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={topdeskNumber}
                  onChange={(e) => setTopdeskNumber(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleFetchTopdesk(); }}
                  placeholder="YYMM-XXXX (e.g. 2604-2477)"
                  disabled={topdeskLoading}
                  className="flex-1 rounded-lg border border-border-default bg-bg-input px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted/40 outline-none focus:border-border-focus disabled:opacity-50"
                />
                <button
                  onClick={handleFetchTopdesk}
                  disabled={!topdeskNumber.trim() || topdeskLoading}
                  className="flex items-center gap-2 rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-blue/90 disabled:opacity-40"
                >
                  {topdeskLoading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Fetching...
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      Fetch & Analyze
                    </>
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-text-muted/60">
                Pulls the full ticket from TOPdesk (caller, category, priority, full request) and lets AI structure it as a {workItemType === "Bug" ? "Bug" : "PBI"}.
              </p>
            </div>

            {/* Divider before manual input */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border-default/30" />
              <span className="text-[11px] text-text-muted/40">or paste / upload manually</span>
              <div className="h-px flex-1 bg-border-default/30" />
            </div>

            {/* Type toggle */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Type</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setWorkItemType("Product Backlog Item")}
                  className={clsx(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    workItemType === "Product Backlog Item"
                      ? "bg-accent-blue text-white"
                      : "bg-bg-secondary text-text-muted hover:text-text-primary"
                  )}
                >
                  PBI
                </button>
                <button
                  onClick={() => setWorkItemType("Bug")}
                  className={clsx(
                    "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    workItemType === "Bug"
                      ? "bg-stale-ancient text-white"
                      : "bg-bg-secondary text-text-muted hover:text-text-primary"
                  )}
                >
                  Bug
                </button>
              </div>
            </div>

            {/* Image upload zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={() => setDragOver(false)}
              className={clsx(
                "rounded-lg border-2 border-dashed px-4 py-4 text-center transition-colors",
                dragOver ? "border-accent-blue bg-accent-blue/5" : "border-border-default/50",
                images.length > 0 ? "pb-3" : "py-6"
              )}
            >
              {images.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {images.map((img, i) => (
                      <div key={i} className="group relative">
                        <img src={img} alt={`Screenshot ${i + 1}`} className="h-24 rounded-lg border border-border-default object-cover" />
                        <button
                          onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute -right-1.5 -top-1.5 rounded-full bg-stale-ancient p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    {images.length < 5 && (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-border-default text-text-muted/40 transition-colors hover:border-accent-blue hover:text-accent-blue"
                      >
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-text-muted/50">{images.length}/5 screenshots</p>
                </div>
              ) : (
                <div>
                  <svg className="mx-auto h-8 w-8 text-text-muted/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                  </svg>
                  <p className="mt-2 text-sm text-text-muted">
                    Drop TOPdesk screenshots here, <button onClick={() => fileInputRef.current?.click()} className="text-accent-blue hover:underline">browse</button>, or <span className="text-text-muted/60">Ctrl+V</span> to paste
                  </p>
                  <p className="mt-1 text-[11px] text-text-muted/40">AI reads the screenshot and creates the work item</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) addImageFiles(e.target.files); e.target.value = ""; }}
              />
            </div>

            {/* Input textarea */}
            <textarea
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={"Paste TOPdesk ticket text here, or describe the work item...\n\nExamples:\n- \"2603-2176 salgsmateriale p\u00e5 solgte boliger - kunder sp\u00f8rger til...\"\n- \"EDC.DK: Fejl i afstand til indk\u00f8b / lader\""}
              rows={6}
              className="w-full resize-y rounded-lg border border-border-default bg-bg-input px-4 py-3 font-mono text-sm text-text-primary placeholder:text-text-muted/40 outline-none focus:border-border-focus"
            />

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-muted/50 tabular-nums">
                {images.length > 0 && `${images.length} image${images.length !== 1 ? "s" : ""}`}
                {images.length > 0 && rawInput.length > 0 && " + "}
                {rawInput.length > 0 && `${rawInput.length} chars`}
              </span>
              <div className="flex gap-3">
                <button
                  onClick={handleManual}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary"
                >
                  Fill manually
                </button>
                <button
                  onClick={handleAnalyze}
                  disabled={(rawInput.trim().length < 10 && images.length === 0) || aiLoading}
                  className="flex items-center gap-2 rounded-lg bg-accent-blue px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-blue/90 disabled:opacity-40"
                >
                  {aiLoading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      {images.length > 0 ? "Reading screenshot..." : "Analyzing..."}
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Analyze with AI
                    </>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p className="rounded-lg border border-stale-ancient/30 bg-stale-ancient/10 px-4 py-2 text-sm text-stale-ancient">{error}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- REVIEW PHASE ---
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* TOPdesk source banner — visible in review when ticket was fetched */}
      {topdeskTicket && (
        <div className="rounded-xl border-l-4 border-l-accent-blue border-y border-r border-border-default bg-accent-blue/5 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent-blue">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l9-5 9 5m-18 0v8a2 2 0 002 2h14a2 2 0 002-2V8m-18 0l9 5 9-5" />
                </svg>
                Source: TOPdesk Ticket
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a href={topdeskTicket.webUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-sm font-bold text-accent-blue hover:underline">
                  {topdeskTicket.number}
                </a>
                <span className="text-sm text-text-secondary">{topdeskTicket.title}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                {topdeskTicket.callerName && (
                  <span><span className="text-text-muted/60">From:</span> {topdeskTicket.callerName}</span>
                )}
                {topdeskTicket.category && (
                  <span><span className="text-text-muted/60">Category:</span> {topdeskTicket.category}{topdeskTicket.subcategory ? ` / ${topdeskTicket.subcategory}` : ""}</span>
                )}
                {topdeskTicket.priority && (
                  <span><span className="text-text-muted/60">Priority:</span> {topdeskTicket.priority}</span>
                )}
                {topdeskTicket.operatorName && (
                  <span><span className="text-text-muted/60">Operator:</span> {topdeskTicket.operatorName}</span>
                )}
              </div>
              <p className="text-[11px] text-text-muted/70">
                ℹ️ An attribution banner with these details will be prepended to the work item description in Azure DevOps,
                and the tag <code className="rounded bg-bg-secondary px-1 py-0.5 text-[10px] text-accent-blue">TOPdesk:{topdeskTicket.number}</code> will be added.
              </p>
            </div>
            <button
              onClick={() => setTopdeskTicket(null)}
              title="Remove TOPdesk source (won't include banner)"
              className="shrink-0 rounded p-1 text-text-muted/60 transition-colors hover:bg-bg-card-hover hover:text-stale-ancient"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* AI badge */}
      {aiUsed && (
        <div className="flex items-center gap-2 rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-4 py-2 text-xs text-accent-blue">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          AI-generated — review and edit before creating
        </div>
      )}

      {/* Original input (collapsible) */}
      {rawInput && (
        <div className="rounded-xl border border-border-default/50 bg-bg-secondary/50">
          <button
            onClick={() => setInputCollapsed(!inputCollapsed)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-text-muted hover:text-text-primary"
          >
            <svg className={clsx("h-3 w-3 transition-transform", !inputCollapsed && "rotate-90")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Original input ({rawInput.length} chars)
          </button>
          {!inputCollapsed && (
            <div className="border-t border-border-default/30 px-4 py-3">
              <pre className="whitespace-pre-wrap text-xs text-text-muted/70 font-mono">{rawInput}</pre>
            </div>
          )}
        </div>
      )}

      {/* Main form */}
      <div className="rounded-xl border border-border-default bg-bg-card">
        <div className="border-b border-border-default/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-text-primary">Review & Create</h2>
            <div className="ml-auto flex gap-1.5">
              <button
                onClick={() => setWorkItemType("Product Backlog Item")}
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  workItemType === "Product Backlog Item"
                    ? "bg-accent-blue text-white"
                    : "bg-bg-secondary text-text-muted hover:text-text-primary"
                )}
              >
                PBI
              </button>
              <button
                onClick={() => setWorkItemType("Bug")}
                className={clsx(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  workItemType === "Bug"
                    ? "bg-stale-ancient text-white"
                    : "bg-bg-secondary text-text-muted hover:text-text-primary"
                )}
              >
                Bug
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Work item title"
              className="w-full rounded-lg border border-border-default bg-bg-input px-4 py-2.5 text-sm font-medium text-text-primary placeholder:text-text-muted/40 outline-none focus:border-border-focus"
            />
          </div>

          {/* Description */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {workItemType === "Bug" ? "Repro Steps / Description" : "Description"}
              </label>
              {description && (
                <button onClick={() => setPreviewDesc(!previewDesc)} className="text-[10px] text-text-muted hover:text-text-primary">
                  {previewDesc ? "Edit" : "Preview"}
                </button>
              )}
            </div>
            {previewDesc ? (
              <div className="rounded-lg border border-border-default bg-bg-primary px-4 py-3">
                <RichHtmlContent html={description} className="prose-devops text-sm text-text-secondary leading-relaxed" />
              </div>
            ) : (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the work item..."
                rows={6}
                className="w-full resize-y rounded-lg border border-border-default bg-bg-input px-4 py-3 font-mono text-sm text-text-primary placeholder:text-text-muted/40 outline-none focus:border-border-focus"
              />
            )}
          </div>

          {/* Acceptance Criteria */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Acceptance Criteria</label>
              {acceptanceCriteria && (
                <button onClick={() => setPreviewAC(!previewAC)} className="text-[10px] text-text-muted hover:text-text-primary">
                  {previewAC ? "Edit" : "Preview"}
                </button>
              )}
            </div>
            {previewAC ? (
              <div className="rounded-lg border border-border-default bg-bg-primary px-4 py-3">
                <RichHtmlContent html={acceptanceCriteria} className="prose-devops text-sm text-text-secondary leading-relaxed" />
              </div>
            ) : (
              <textarea
                value={acceptanceCriteria}
                onChange={(e) => setAcceptanceCriteria(e.target.value)}
                placeholder="Acceptance criteria (HTML supported)..."
                rows={4}
                className="w-full resize-y rounded-lg border border-border-default bg-bg-input px-4 py-3 font-mono text-sm text-text-primary placeholder:text-text-muted/40 outline-none focus:border-border-focus"
              />
            )}
          </div>

          {/* Priority + Tags row */}
          <div className="flex gap-4">
            <div className="w-48">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus"
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">Tags</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Tag1; Tag2; ..."
                className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/40 outline-none focus:border-border-focus"
              />
            </div>
          </div>

          {/* Sprint + Assignee row */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">Sprint</label>
              <select
                value={iterationPath}
                onChange={(e) => setIterationPath(e.target.value)}
                className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus"
              >
                <option value="">Backlog (no sprint)</option>
                {relevantSprints.map((s) => {
                  const isCurrent = s.path === getCurrentSprintPath(iterations);
                  return (
                    <option key={s.id} value={s.path}>
                      {s.name}{isCurrent ? " (current)" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">Assignee</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus"
              >
                <option value="">Unassigned</option>
                {availableAssignees.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Workflow flags + Parent */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={refinement}
                onChange={(e) => { setRefinement(e.target.checked); if (e.target.checked) setSprintPlanning(false); }}
                className="h-4 w-4 rounded border-border-default accent-accent-blue"
              />
              Mark for Refinement
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={sprintPlanning}
                onChange={(e) => { setSprintPlanning(e.target.checked); if (e.target.checked) setRefinement(false); }}
                className="h-4 w-4 rounded border-border-default accent-accent-teal"
              />
              Mark for Sprint Planning
            </label>
          </div>

          {/* Parent link */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">Parent (Feature/Epic ID)</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                placeholder="Work item ID"
                className="w-36 rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/40 outline-none focus:border-border-focus [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              {parentLoading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />}
              {parentTitle && <span className="text-sm text-text-secondary">{parentTitle}</span>}
            </div>
          </div>

          {/* Child Tasks */}
          <div className="rounded-lg border border-border-default/50">
            <button
              onClick={() => setTasksOpen(!tasksOpen)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-bg-card-hover"
            >
              <svg className={clsx("h-3 w-3 text-text-muted transition-transform", tasksOpen && "rotate-90")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Child Tasks</span>
              {childTasks.length > 0 && (
                <span className="rounded-full bg-accent-gold/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent-gold">
                  {childTasks.length} · {totalChildHours}h
                </span>
              )}
            </button>

            {tasksOpen && (
              <div className="border-t border-border-default/30 px-4 py-3 space-y-3">
                {/* Existing queued tasks */}
                {childTasks.length > 0 && (
                  <div className="rounded-lg border border-border-default/40 bg-bg-primary">
                    {childTasks.map((ct) => (
                      <div key={ct.id} className="group flex items-center gap-2 border-t border-border-default/20 px-3 py-2 first:border-t-0">
                        <span className={clsx(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          ct.activity === "Development" ? "bg-accent-blue/15 text-accent-blue"
                            : ct.activity === "QA" ? "bg-accent-gold/15 text-accent-gold"
                            : "bg-stale-fresh/15 text-stale-fresh"
                        )}>
                          {ct.activity}
                        </span>
                        <span className="flex-1 truncate text-sm text-text-secondary">{ct.title}</span>
                        <span className="text-xs font-mono text-accent-gold tabular-nums">{ct.hours}h</span>
                        {ct.assignee && <span className="text-xs text-text-muted truncate max-w-[120px]">{ct.assignee}</span>}
                        <button
                          onClick={() => removeChildTask(ct.id)}
                          className="shrink-0 rounded p-1 text-text-muted opacity-0 transition-all hover:bg-stale-ancient/15 hover:text-stale-ancient group-hover:opacity-100"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add task row */}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={taskHours}
                    onChange={(e) => setTaskHours(e.target.value)}
                    placeholder="Hours *"
                    min="0.5"
                    step="0.5"
                    className="w-20 rounded-lg border border-border-default bg-bg-input px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted/40 outline-none focus:border-border-focus [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <select
                    value={taskAssignee}
                    onChange={(e) => setTaskAssignee(e.target.value)}
                    className="flex-1 rounded-lg border border-border-default bg-bg-input px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus"
                  >
                    <option value="">Unassigned</option>
                    {availableAssignees.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <div className="flex gap-1.5">
                    {TASK_PRESETS.map((preset) => (
                      <button
                        key={preset.key}
                        onClick={() => addChildTask(preset)}
                        disabled={!taskHours || Number(taskHours) <= 0}
                        className={clsx(
                          "rounded-full px-3 py-1 text-xs font-semibold transition-all disabled:opacity-30 hover:opacity-80",
                          preset.color
                        )}
                      >
                        + {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-3 border-t border-border-default/50 px-6 py-4">
          <button
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            className="flex items-center gap-2 rounded-lg bg-accent-teal px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-teal/80 disabled:opacity-40"
          >
            {creating ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Creating...
              </>
            ) : (
              <>
                <WorkItemTypeIcon type={workItemType} />
                Create {workItemType === "Bug" ? "Bug" : "PBI"}
              </>
            )}
          </button>
          <button
            onClick={handleReset}
            className="rounded-lg px-4 py-2.5 text-sm text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary"
          >
            Reset
          </button>
          {error && (
            <p className="ml-3 text-sm text-stale-ancient">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
