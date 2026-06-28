import type {
  AddResult,
  AgentId,
  DiscoveredSkill,
  ManagedSkill,
  SkillDiff,
  SkillStatusReport
} from "@skillport/core";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z, ZodError } from "zod";

export interface ApiService {
  scan(): Promise<DiscoveredSkill[]>;
  list(): Promise<ManagedSkill[]>;
  status(name?: string): Promise<SkillStatusReport[]>;
  diff(name: string): Promise<SkillDiff>;
  add(name: string, from?: AgentId): Promise<AddResult>;
  install(url: string, path?: string, from?: AgentId | "github"): Promise<AddResult>;
  sync(name: string, source: AgentId | "central"): Promise<AddResult>;
  remove(name: string): Promise<{ kind: "completed"; name: string }>;
}

export interface ApiError {
  code: string;
  message: string;
  nextAction?: string;
}

export function buildApp(options: {
  service: ApiService;
  token: string;
  origin: string | (() => string);
}): FastifyInstance {
  const app = Fastify({ logger: false });
  const { service, token } = options;

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      if (request.headers["x-skillport-token"] !== token) {
        return reply.code(401).send({
          code: "UNAUTHORIZED",
          message: "Missing or invalid SkillPort token"
        });
      }
      const allowedOrigin =
        typeof options.origin === "function" ? options.origin() : options.origin;
      if (request.headers.origin && request.headers.origin !== allowedOrigin) {
        return reply.code(403).send({
          code: "FORBIDDEN_ORIGIN",
          message: "Request origin is not allowed"
        });
      }
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: "INVALID_INPUT",
        message: error.issues[0]?.message ?? "Invalid input"
      });
    }
    const normalized = error instanceof Error ? error : new Error(String(error));
    return reply.code(500).send({
      code: "OPERATION_FAILED",
      message: normalized.message
    });
  });

  app.get("/api/skills", async () => {
    const [skills, statuses] = await Promise.all([service.list(), service.status()]);
    const statusByName = new Map(statuses.map((status) => [status.name, status]));
    return skills.map((skill) => ({ ...skill, ...statusByName.get(skill.name) }));
  });

  app.get("/api/discover", async () => service.scan());

  app.get<{ Params: { name: string } }>("/api/skills/:name/diff", async (request) =>
    service.diff(request.params.name)
  );

  app.post<{ Params: { name: string } }>("/api/skills/:name/add", async (request, reply) => {
    const body = z
      .object({ from: z.enum(["codex", "claude"]).optional() })
      .strict()
      .parse(request.body ?? {});
    return sendOperation(reply, await service.add(request.params.name, body.from));
  });

  app.post("/api/install", async (request, reply) => {
    const body = z
      .object({
        url: z.string().url(),
        path: z.string().min(1).optional(),
        from: z.enum(["github", "codex", "claude"]).optional()
      })
      .strict()
      .parse(request.body);
    return sendOperation(reply, await service.install(body.url, body.path, body.from));
  });

  app.post<{ Params: { name: string } }>("/api/skills/:name/sync", async (request, reply) => {
    const body = z
      .object({ from: z.enum(["central", "codex", "claude"]) })
      .strict()
      .parse(request.body);
    return sendOperation(reply, await service.sync(request.params.name, body.from));
  });

  app.delete<{ Params: { name: string } }>("/api/skills/:name", async (request) =>
    service.remove(request.params.name)
  );

  return app;
}

function sendOperation(
  reply: FastifyReply,
  result: AddResult
) {
  if (result.kind === "decision-required") {
    return reply.code(409).send({
      code: "SOURCE_DECISION_REQUIRED",
      message: `Choose a source for ${result.name}`,
      choices: result.choices
    });
  }
  return reply.code(200).send(result);
}
