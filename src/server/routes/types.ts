import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../env.js";

export type RouteContext = {
  app: FastifyInstance;
  prisma: PrismaClient;
  env: AppEnv;
};
