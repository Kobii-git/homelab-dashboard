import { z } from "zod";
import { applyBackupImport, buildBackupPayload, previewBackupImport } from "../backup.js";
import { verifyAdminPassword } from "../auth.js";
import type { RouteContext } from "./types.js";

const importRequestSchema = z.object({
  password: z.string().min(1),
  mode: z.enum(["merge", "replace"]),
  payload: z.unknown(),
  confirmReplace: z.literal("REPLACE").optional()
});

export async function registerExportRoutes({ app, prisma, env }: RouteContext): Promise<void> {
  app.get("/api/export", async () => buildBackupPayload(prisma));

  app.post("/api/import/preview", async (request) => {
    const body = z.object({ payload: z.unknown() }).parse(request.body);
    return previewBackupImport(body.payload);
  });

  app.post("/api/import", async (request, reply) => {
    const body = importRequestSchema.parse(request.body);

    if (!(await verifyAdminPassword(body.password, env, prisma))) {
      return reply.code(403).send({ error: "Password confirmation failed" });
    }

    if (body.mode === "replace" && body.confirmReplace !== "REPLACE") {
      return reply.code(400).send({
        error: 'Replace mode requires confirmReplace: "REPLACE"'
      });
    }

    const result = await applyBackupImport(prisma, body.payload, body.mode);
    if (!result.applied) {
      return reply.code(400).send(result);
    }

    return result;
  });
}
