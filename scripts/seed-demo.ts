import { PrismaClient } from "@prisma/client";
import { seedDemo } from "../src/server/seed.js";

const prisma = new PrismaClient();

seedDemo(prisma, process.env.HOMELAB_VAULT_KEY)
  .then(async () => {
    console.log("Demo homelab data seeded via scripts/seed-demo.ts.");
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
