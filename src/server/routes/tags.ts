import { idParamSchema, tagPatchSchema, tagSchema } from "../validation.js";
import type { RouteContext } from "./types.js";

export async function registerTagRoutes({ app, prisma }: RouteContext): Promise<void> {
  app.get("/api/tags", async () =>
    prisma.tag.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] })
  );

  app.post("/api/tags", async (request, reply) => {
    const body = tagSchema.parse(request.body);
    const tag = await prisma.tag.create({
      data: {
        name: body.name,
        color: body.color ?? null,
        type: body.type ?? "general"
      }
    });
    reply.code(201);
    return tag;
  });

  app.patch("/api/tags/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = tagPatchSchema.parse(request.body);
    return prisma.tag.update({ where: { id }, data: body });
  });

  app.delete("/api/tags/:id", async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await prisma.tag.delete({ where: { id } });
    return { ok: true };
  });
}
