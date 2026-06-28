import { describe, expect, it } from "vitest";
import { parseGitHubSource, parseSkillName } from "./paths.js";

describe("parseSkillName", () => {
  it.each(["../pdf", "a/b", "a\\b", ".", "..", ""])(
    "rejects unsafe name %j",
    (name) => {
      expect(() => parseSkillName(name)).toThrow("Invalid Skill name");
    }
  );

  it("accepts a safe directory name", () => {
    expect(parseSkillName("pdf-tools")).toBe("pdf-tools");
  });
});

describe("parseGitHubSource", () => {
  it("parses a public repository and safe subpath", () => {
    expect(
      parseGitHubSource("https://github.com/acme/skills", "skills/pdf")
    ).toEqual({ owner: "acme", repo: "skills", path: "skills/pdf" });
  });

  it("strips a git suffix", () => {
    expect(parseGitHubSource("https://github.com/acme/pdf.git")).toEqual({
      owner: "acme",
      repo: "pdf"
    });
  });

  it.each([
    "http://github.com/acme/pdf",
    "https://gitlab.com/acme/pdf",
    "https://github.com/acme",
    "https://github.com/acme/pdf/tree/main"
  ])("rejects unsupported URL %s", (url) => {
    expect(() => parseGitHubSource(url)).toThrow(
      "Expected https://github.com/<owner>/<repository>"
    );
  });

  it.each(["../pdf", "/skills/pdf", "skills/../../pdf", "skills\\..\\pdf"])(
    "rejects unsafe repository path %j",
    (subpath) => {
      expect(() =>
        parseGitHubSource("https://github.com/acme/skills", subpath)
      ).toThrow("must stay inside the repository");
    }
  );
});
