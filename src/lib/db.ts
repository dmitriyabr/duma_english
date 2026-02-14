import { PrismaClient } from "@prisma/client";
import { config } from "./config";

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma =
  global.prisma ||
  new PrismaClient({
    log: ["warn", "error"],
  });

if (!config.isProduction) {
  global.prisma = prisma;
}
