import { ACPToolCallEvent } from "#/types/agent-server/core/events/acp-tool-call-event";
import i18n from "#/i18n";
import { MAX_CONTENT_LENGTH } from "./shared";
import { I18nKey } from "#/i18n/declaration";

/**
 * Pick the translation key used for the ACP tool call title row. Mirrors
 * ACTION_MESSAGE$RUN / $EDIT / $READ etc.
 */
export const getACPToolCallTitleKey = (event: ACPToolCallEvent): string => {
  switch (event.tool_kind) {
    case "execute":
      return "ACTION_MESSAGE$ACP_RUN";
    case "edit":
      return "ACTION_MESSAGE$ACP_EDIT";
    case "read":
      return "ACTION_MESSAGE$ACP_READ";
    case "fetch":
      return "ACTION_MESSAGE$ACP_FETCH";
    default:
      return "ACTION_MESSAGE$ACP_TOOL";
  }
};

// English verb prefixes ACP servers sometimes inline into the title.
// Claude Code emits ``"Read /Users/foo/bar"`` for a read tool — combined
// with the i18n template ``"Reading <cmd>{{title}}</cmd>"`` that lands as
// ``"Reading Read /Users/foo/bar"``. The redundant leading verb is the
// part we strip; the template's own verb (which is i18n'd) stays.
//
// Keyed by ``tool_kind`` so the strip is scoped to where double-verbing
// actually shows up. The english-only check is intentional — ACP servers
// are anglophone tools and emit english titles regardless of the user's
// canvas locale; matching translated verbs would mean every locale's
// strip list goes stale the moment a new server is added.
const REDUNDANT_TITLE_PREFIXES: Partial<Record<string, readonly string[]>> = {
  read: ["Read"],
  edit: ["Edit", "Write"],
  execute: ["Bash", "Run"],
  fetch: ["Fetch", "WebFetch"],
};

/**
 * Strip a leading verb from ``event.title`` that would duplicate the
 * verb baked into the i18n template (see ``REDUNDANT_TITLE_PREFIXES``).
 *
 * The match is anchored, case-sensitive, and requires the prefix to be
 * followed by whitespace so a token like ``"Reads"`` (an actual verb
 * elsewhere in the title) is left alone. If no prefix matches, the title
 * is returned verbatim.
 */
export const stripRedundantTitlePrefix = (event: ACPToolCallEvent): string => {
  const title = event.title;
  const tool_kind = event.tool_kind;
  if (!title || !tool_kind) return title;
  const prefixes = REDUNDANT_TITLE_PREFIXES[tool_kind];
  if (!prefixes) return title;
  for (const prefix of prefixes) {
    if (
      title.length > prefix.length &&
      title.startsWith(prefix) &&
      /\s/.test(title.charAt(prefix.length))
    ) {
      return title.slice(prefix.length).trimStart();
    }
  }
  return title;
};

/**
 * Extract a human-readable string value from raw_input for a set of
 * candidate keys. Supports both single strings and arrays of strings
 * (e.g. an argv array for a command).
 */
const getRawInputValue = (
  rawInput: unknown,
  keys: readonly string[],
): string | undefined => {
  if (!rawInput || typeof rawInput !== "object") return undefined;
  const obj = rawInput as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => typeof v === "string")
    ) {
      return (value as string[]).join(" ");
    }
  }
  return undefined;
};

/**
 * Build a display title for an ACP tool call. Falls back to well-known
 * fields in ``raw_input`` (path, command, url) when ``event.title`` is
 * missing, then strips redundant leading verbs.
 */
export const getACPToolCallDisplayTitle = (event: ACPToolCallEvent): string => {
  let title = event.title?.trim() || "";
  if (!title) {
    title =
      getRawInputValue(event.raw_input, ["path"]) ||
      getRawInputValue(event.raw_input, ["command"]) ||
      getRawInputValue(event.raw_input, ["url"]) ||
      "";
  }
  if (!title) {
    return i18n.t(I18nKey.ACTION_MESSAGE$ACP_TOOL);
  }
  const stripped = stripRedundantTitlePrefix({ ...event, title });
  return stripped || title;
};

/**
 * Stringify an arbitrary raw_input payload for fallback markdown rendering.
 * Strings pass through; objects are pretty-printed JSON.
 */
const stringifyPayload = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const truncate = (content: string): string =>
  content.length > MAX_CONTENT_LENGTH
    ? `${content.slice(0, MAX_CONTENT_LENGTH)}...`
    : content;

/**
 * Extract plain text from ACP content blocks. Text blocks are joined with
 * paragraph breaks; image blocks are counted and summarized.
 */
const textFromContentBlocks = (blocks: unknown): string => {
  if (!Array.isArray(blocks)) return "";
  const texts: string[] = [];
  let imageCount = 0;
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string") {
      texts.push(b.text);
    } else if (b.type === "image") {
      imageCount += 1;
    }
  }
  if (texts.length > 0) {
    return texts.join("\n\n");
  }
  if (imageCount > 0) {
    return `[${imageCount} image${imageCount === 1 ? "" : "s"}]`;
  }
  return "";
};

/**
 * Try to pull human-readable text out of a structured ``raw_output`` object.
 * Many ACP servers wrap stdout/stderr or return nested content arrays, so
 * we look through a few common shapes before falling back to JSON.
 */
const textFromOutputObject = (obj: Record<string, unknown>): string => {
  const pieces: string[] = [];
  for (const key of [
    "text",
    "content",
    "output",
    "stdout",
    "result",
    "value",
    "data",
    "body",
  ]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      pieces.push(value.trim());
    } else if (Array.isArray(value)) {
      const text = textFromContentBlocks(value);
      if (text) pieces.push(text);
    }
  }
  if (typeof obj.stderr === "string" && obj.stderr.trim()) {
    pieces.push(`stderr: ${obj.stderr.trim()}`);
  }
  if (pieces.length > 0) {
    return pieces.join("\n\n");
  }
  if (obj.type === "text" && typeof obj.text === "string") {
    return obj.text;
  }
  return "";
};

/**
 * Resolve the displayable output text for an ACP tool call. Prefers
 * ``raw_output`` when it contains something readable, then falls back to
 * ``event.content`` (the normalized ACP content blocks), which is where
 * some ACP servers put the actual tool result.
 */
const getACPToolCallOutputText = (event: ACPToolCallEvent): string => {
  const raw = event.raw_output;
  let text = "";
  if (raw === null || raw === undefined) {
    text = "";
  } else if (typeof raw === "string") {
    text = raw;
  } else if (Array.isArray(raw)) {
    text = textFromContentBlocks(raw);
  } else if (typeof raw === "object") {
    text = textFromOutputObject(raw as Record<string, unknown>);
  }
  if (text.trim()) {
    return text.trim();
  }
  return textFromContentBlocks(event.content);
};

/**
 * Build a friendly input section for the ACP tool call card. For the
 * common tool kinds we inline the key field; for anything else we fall
 * back to a JSON dump.
 */
const getACPToolCallInputSection = (event: ACPToolCallEvent): string | null => {
  const rawInput = event.raw_input;
  if (!rawInput || typeof rawInput !== "object") return null;

  const { tool_kind } = event;
  const command = getRawInputValue(rawInput, ["command"]);
  if (tool_kind === "execute" && command) {
    return `Command: \`${command}\``;
  }

  const path = getRawInputValue(rawInput, ["path"]);
  if ((tool_kind === "read" || tool_kind === "edit") && path) {
    return `Path: \`${path}\``;
  }

  const url = getRawInputValue(rawInput, ["url"]);
  if (tool_kind === "fetch" && url) {
    return `URL: \`${url}\``;
  }

  const inputStr = stringifyPayload(rawInput).trim();
  if (inputStr) {
    return `Input:\n\`\`\`json\n${inputStr}\n\`\`\``;
  }
  return null;
};

/**
 * Build the markdown-flavored body for an ACP tool call card. Mirrors the
 * shape of ``getTerminalObservationContent`` (``Command:`` + ``Output:``
 * fenced blocks) so the rendered card lines up with regular OpenHands
 * observations.
 *
 * For ``tool_kind === "execute"`` we surface ``raw_input.command`` as the
 * command line; for others we fall back to a pretty-printed JSON dump of
 * the input. Output is extracted from ``raw_output`` and, if that is empty,
 * from the normalized ``event.content`` blocks.
 */
export const getACPToolCallContent = (event: ACPToolCallEvent): string => {
  const toolKind = event.tool_kind;
  const isError = event.is_error;

  const sections: string[] = [];

  const inputSection = getACPToolCallInputSection(event);
  if (inputSection) {
    sections.push(inputSection);
  }

  const outputText = getACPToolCallOutputText(event);
  if (outputText) {
    const outputLabel = isError ? "**Error:**" : "Output:";
    sections.push(`${outputLabel}\n\`\`\`\n${truncate(outputText)}\n\`\`\``);
  } else if (isError) {
    sections.push(
      `**Error:**\n\`\`\`\n${i18n.t(I18nKey.OBSERVATION$COMMAND_NO_OUTPUT)}\n\`\`\``,
    );
  } else if (
    toolKind === "execute" ||
    toolKind === "other" ||
    toolKind === null
  ) {
    // Commands and unknown tools keep the shared no-output fallback.
    sections.push(
      `Output:\n\`\`\`\n${i18n.t(I18nKey.OBSERVATION$COMMAND_NO_OUTPUT)}\n\`\`\``,
    );
  }
  // For read/edit/fetch, an empty output is normal (empty file, successful
  // edit, empty response), so we omit the "no output" block and let the
  // title carry the path/URL.

  return sections.join("\n\n");
};
