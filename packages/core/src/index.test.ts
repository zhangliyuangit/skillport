import { describe, expect, it } from "vitest";
import { SKILLPORT_VERSION } from "./index.js";

describe("core package", () => {
  it("exports its state schema version", () => {
    expect(SKILLPORT_VERSION).toBe(1);
  });
});
