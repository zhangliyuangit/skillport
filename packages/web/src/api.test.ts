import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpApi } from "./api.js";

function mockFetch() {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function tokenHeader(fetchMock: ReturnType<typeof mockFetch>): string | undefined {
  const init = fetchMock.mock.calls.at(-1)?.[1];
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.["x-skillport-token"];
}

describe("createHttpApi token handling", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.location.hash = "";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the token from the URL hash and strips it from the address bar", async () => {
    const fetchMock = mockFetch();
    window.location.hash = "#token=abc123";

    await createHttpApi().discover();

    expect(tokenHeader(fetchMock)).toBe("abc123");
    expect(window.location.hash).toBe("");
  });

  it("keeps authenticating after a refresh that has no hash", async () => {
    window.location.hash = "#token=abc123";
    createHttpApi(); // first load persists the token

    const fetchMock = mockFetch();
    window.location.hash = ""; // refresh drops the hash

    await createHttpApi().discover();

    expect(tokenHeader(fetchMock)).toBe("abc123");
  });

  it("omits content-type for body-less requests but keeps it for JSON bodies", async () => {
    window.location.hash = "#token=abc123";
    const fetchMock = mockFetch();

    const api = createHttpApi();
    await api.populateAgent("qoder");
    const populateHeaders = fetchMock.mock.calls.at(-1)?.[1]?.headers as Record<string, string>;
    expect(populateHeaders["content-type"]).toBeUndefined();
    expect(populateHeaders["x-skillport-token"]).toBe("abc123");

    await api.addAgent("qoder", "/x");
    const addHeaders = fetchMock.mock.calls.at(-1)?.[1]?.headers as Record<string, string>;
    expect(addHeaders["content-type"]).toBe("application/json");
  });
});
