import { it, expect } from "vitest";
import { IDSchema, ErrorEnvelope, TimelineDocumentSchema } from "../src/index";
it("parses basic ID string", () => {
    expect(() => IDSchema.parse("abc")).not.toThrow();
});
it("validates ErrorEnvelope shape", () => {
    const v = { code: "ERR", message: "Something went wrong" };
    expect(() => ErrorEnvelope.parse(v)).not.toThrow();
});
it("validates minimal timeline document", () => {
    const doc = { id: "t1", tenantId: "ten1", title: "Test", items: [] };
    expect(() => TimelineDocumentSchema.parse(doc)).not.toThrow();
});
