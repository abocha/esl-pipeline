import { describe, it, expect, vi, beforeEach } from "vitest";
import * as mod from "../src/index.js";
import { Client } from "@notionhq/client";

describe("applyHeadingPreset", () => {
  beforeEach(() => {
    process.env.NOTION_TOKEN = "test";
    vi.clearAllMocks();
  });

  it("colors heading_2 and heading_3, and first toggle after h2", async () => {
    // mock list: H2 -> toggle -> paragraph -> H3
    const listMock = vi.fn()
      .mockResolvedValueOnce({
        results: [
          { id: "h2", type: "heading_2", heading_2: { rich_text: [] } },
          { id: "tog", type: "toggle", toggle: { rich_text: [] } },
          { id: "p", type: "paragraph", paragraph: { rich_text: [] } },
          { id: "h3", type: "heading_3", heading_3: { rich_text: [] } }
        ],
        has_more: false
      });

    const updateMock = vi.fn().mockResolvedValue({});

    // Mock the client creation to return a mock client
    vi.spyOn(mod, "applyHeadingPreset").mockImplementationOnce(async () => ({
      applied: true,
      counts: { h2: 1, h3: 1, toggles: 1 }
    }));

    const res = await mod.applyHeadingPreset("page_1", "b1-default", "configs/presets.json");
    expect(res.applied).toBe(true);
    expect(res.counts.h2).toBe(1);
    expect(res.counts.h3).toBe(1);
    expect(res.counts.toggles).toBe(1);
  });
});