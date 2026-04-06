import { it, expect } from "vitest";
import { makeTimelineFixture } from "../src/index";

it("creates a minimal timeline fixture", () => {
  const f = makeTimelineFixture();
  expect(f).toHaveProperty("id");
  expect(f).toHaveProperty("tenantId");
});
