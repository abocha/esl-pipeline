import { Command } from "commander";
import { applyHeadingPreset } from "../src/index.js";

const program = new Command()
  .name("notion-colorizer")
  .requiredOption("--page-id <id>", "Notion page id")
  .requiredOption("--preset <name>", "Preset name")
  .option("--presets-path <file>", "Path to presets JSON", "configs/presets.json")
  .action(async (opts) => {
    try {
      const res = await applyHeadingPreset(opts.pageId, opts.preset, opts.presetsPath);
      console.log(JSON.stringify(res, null, 2));
    } catch (e: any) {
      console.error(e?.message || String(e));
      process.exit(1);
    }
  });

program.parse();
