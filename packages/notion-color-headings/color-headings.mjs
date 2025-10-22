// color-headings.mjs
import { Client } from "@notionhq/client";

/* ---------------- CLI parsing ---------------- */
function parseArgs(argv) {
  const args = {
    id: null,
    defaultColor: "yellow_background",           // fallback if no --map provided
    levels: ["heading_1", "heading_2", "heading_3"],
    dry: false,
    map: {},         // e.g. { heading_2: "yellow_background", heading_3: "purple_background" }
    toggleMap: {},   // e.g. { heading_2: "yellow_background" }  // applied to toggle titles only
  };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;                  // ignore pnpm separator
    if (a === "--dry-run") { args.dry = true; continue; }
    if (a.startsWith("--color="))    { args.defaultColor = normalizeColor(a.slice(8)); continue; }
    if (a.startsWith("--levels="))   { args.levels = normalizeLevels(a.slice(9)); continue; }
    if (a.startsWith("--map="))      { args.map = parseColorMap(a.slice(6)); continue; }
    if (a.startsWith("--toggle-map=")){ args.toggleMap = parseColorMap(a.slice(13)); continue; }
    positional.push(a);
  }
  if (!positional[0]) usageAndExit();
  const extracted = extractNotionId(positional[0]);
  args.id = toDashedUuid(extracted);
  return args;
}

function usageAndExit() {
  console.error(`Usage:
  node color-headings.mjs <PAGE_OR_BLOCK_URL_OR_ID>
    [--map=h2=yellow_background,h3=purple_background]
    [--toggle-map=h2=yellow_background]    # highlight toggle title only (no bleed)
    [--levels=h2,h3]
    [--color=yellow_background|default]    # fallback for all levels
    [--dry-run]`);
  process.exit(1);
}

/* ---------------- ID & color utils ---------------- */
function extractNotionId(input) {
  const m = String(input).match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!m) return String(input).trim();
  return m[1].replace(/-/g, "").toLowerCase();
}
function toDashedUuid(hex32) {
  const h = hex32.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return hex32;
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function normalizeColor(c) {
  c = String(c).toLowerCase().trim();
  if (c === "default") return "default";
  if (c.endsWith("_background")) return c; // background highlight
  // text colors are also valid on annotations (no background)
  const textColors = new Set(["yellow","orange","green","blue","purple","pink","red","gray","brown"]);
  return textColors.has(c) ? c : c;        // let API validate if unexpected
}
function isBackground(color) { return typeof color === "string" && color.endsWith("_background"); }
function isTextColor(color)  { return color && color !== "default" && !isBackground(color); }

function normalizeLevels(s) {
  const wanted = new Set(s.toLowerCase().split(",").map(x => x.trim()));
  const map = { h1: "heading_1", h2: "heading_2", h3: "heading_3" };
  const out = [];
  for (const k of ["h1","h2","h3"]) if (wanted.has(k)) out.push(map[k]);
  return out.length ? out : ["heading_1","heading_2","heading_3"];
}
function parseColorMap(s) {
  const map = {};
  if (!s) return map;
  const pairs = s.split(",").map(x => x.trim()).filter(Boolean);
  const keyMap = { h1: "heading_1", h2: "heading_2", h3: "heading_3" };
  for (const p of pairs) {
    const [kRaw, vRaw] = p.split("=").map(x => (x ?? "").trim());
    const k = keyMap[kRaw?.toLowerCase()];
    if (!k || !vRaw) continue;
    map[k] = normalizeColor(vRaw);
  }
  return map;
}

/* ---------------- Rich-text helpers ---------------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function toRequestRichText(items = []) {
  return items.map(it => {
    const base = { annotations: it.annotations, href: it.href ?? null };
    if (it.type === "text") {
      return {
        type: "text",
        text: { content: it.text?.content ?? it.plain_text ?? "", link: it.text?.link ?? null },
        ...base,
      };
    }
    if (it.type === "mention") return { type: "mention", mention: it.mention, ...base };
    if (it.type === "equation") return { type: "equation", equation: it.equation, ...base };
    // Fallback to plain text to avoid validation errors on exotic types
    return { type: "text", text: { content: it.plain_text ?? "" }, ...base };
  });
}
function applyTextColorToRichText(rtItems, colorToken) {
  // colorToken may be "yellow" or "yellow_background"
  return rtItems.map(span => ({
    ...span,
    annotations: { ...(span.annotations || {}), color: colorToken }
  }));
}

/* ---------------- Color choice ---------------- */
function pickColor({ type, isToggle, map, toggleMap, fallback }) {
  if (isToggle && Object.prototype.hasOwnProperty.call(toggleMap, type)) return toggleMap[type];
  if (Object.prototype.hasOwnProperty.call(map, type)) return map[type];
  return fallback;
}

/* ---------------- Main ---------------- */
async function main() {
  const { id, levels, dry, map, toggleMap, defaultColor } = parseArgs(process.argv);
  const token = process.env.NOTION_TOKEN;
  if (!token) { console.error("NOTION_TOKEN is not set"); process.exit(1); }
  const notion = new Client({ auth: token });

  let updated = 0, scanned = 0;

  async function walk(blockId) {
    let cursor;
    do {
      const resp = await notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: cursor });
      for (const b of resp.results) {
        scanned++;
        const t = b.type;
        if (levels.includes(t)) {
          const src = b[t] || {};
          const isToggle = !!src.is_toggleable;
          const desired = pickColor({ type: t, isToggle, map, toggleMap, fallback: defaultColor });

          // Base RT pulled from existing block
          const baseRT = toRequestRichText(src.rich_text || [{ type: "text", text: { content: "" } }]);

          let rich_text, blockColor;

          if (isToggle && Object.prototype.hasOwnProperty.call(toggleMap, t)) {
            // ✅ TOGGLE HEADING with override:
            // Apply color to the title *text only* (annotations), keep block color default to avoid child bleed.
            // If you pass "yellow_background" here, the title text gets a highlight (what you want).
            rich_text = applyTextColorToRichText(baseRT, desired);
            blockColor = "default";
          } else {
            // Non-toggle (or toggle without override):
            if (isBackground(desired)) {
              // background highlight at block level is fine for non-toggles
              rich_text = baseRT;
              blockColor = desired;
            } else if (isTextColor(desired)) {
              // plain text color at annotations level
              rich_text = applyTextColorToRichText(baseRT, desired);
              blockColor = "default";
            } else {
              // default / passthrough
              rich_text = baseRT;
              blockColor = desired; // typically "default"
            }
          }

          const payload = { block_id: b.id, [t]: { rich_text, color: blockColor } };
          if (Object.prototype.hasOwnProperty.call(src, "is_toggleable")) {
            payload[t].is_toggleable = !!src.is_toggleable;
          }

          if (!dry) {
            await notion.blocks.update(payload);
            await sleep(80);
          }
          updated++;
        }
        if (b.has_children) await walk(b.id);
      }
      cursor = resp.next_cursor || undefined;
    } while (cursor);
  }

  try {
    await walk(id);
    console.log(`${dry ? "[DRY-RUN] " : ""}Scanned ${scanned} blocks; ${dry ? "Would update" : "Updated"} ${updated} heading(s).`);
    if (dry) console.log("No changes made. Remove --dry-run to apply.");
  } catch (e) {
    console.error("Failed:", e.message);
    process.exit(1);
  }
}

main();
