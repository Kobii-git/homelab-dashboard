import type { ApiWidget, PrismaClient } from "@prisma/client";

const API_WIDGET_BINDINGS_KEY = "api_widget_secret_bindings_v1";
const API_WIDGET_BINDINGS_ADOPTED_KEY = "api_widget_secret_bindings_adopted_v1";

type WidgetSecretBinding = {
  envVar: string;
  origin: string;
};

type WidgetSecretBindings = Record<string, WidgetSecretBinding>;

function normalizedOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function bindingFor(widget: Pick<ApiWidget, "authType" | "authEnvVar" | "baseUrl">): WidgetSecretBinding | null {
  if (widget.authType === "none" || !widget.authEnvVar) return null;
  return {
    envVar: widget.authEnvVar,
    origin: normalizedOrigin(widget.baseUrl)
  };
}

async function readBindings(prisma: PrismaClient): Promise<WidgetSecretBindings> {
  const entry = await prisma.systemConfig.findUnique({ where: { key: API_WIDGET_BINDINGS_KEY } });
  if (!entry) return {};
  try {
    const value = JSON.parse(entry.value) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([id, raw]) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const binding = raw as Partial<WidgetSecretBinding>;
      return typeof binding.envVar === "string" && typeof binding.origin === "string"
        ? [[id, { envVar: binding.envVar, origin: binding.origin }]]
        : [];
    }));
  } catch {
    return {};
  }
}

async function writeBindings(prisma: PrismaClient, bindings: WidgetSecretBindings): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: API_WIDGET_BINDINGS_KEY },
    create: { key: API_WIDGET_BINDINGS_KEY, value: JSON.stringify(bindings) },
    update: { value: JSON.stringify(bindings) }
  });
}

export async function bindApiWidgetSecret(
  prisma: PrismaClient,
  widget: Pick<ApiWidget, "id" | "authType" | "authEnvVar" | "baseUrl">
): Promise<void> {
  const bindings = await readBindings(prisma);
  const binding = bindingFor(widget);
  if (binding) bindings[widget.id] = binding;
  else delete bindings[widget.id];
  await writeBindings(prisma, bindings);
}

export async function removeApiWidgetSecretBinding(prisma: PrismaClient, widgetId: string): Promise<void> {
  const bindings = await readBindings(prisma);
  if (!(widgetId in bindings)) return;
  delete bindings[widgetId];
  await writeBindings(prisma, bindings);
}

export async function assertApiWidgetSecretBinding(
  prisma: PrismaClient,
  widget: Pick<ApiWidget, "id" | "authType" | "authEnvVar" | "baseUrl">
): Promise<void> {
  const expected = bindingFor(widget);
  if (!expected) return;
  const actual = (await readBindings(prisma))[widget.id];
  if (!actual || actual.envVar !== expected.envVar || actual.origin !== expected.origin) {
    throw new Error("API widget secret is not bound to this origin; confirm and save the integration again");
  }
}

export async function adoptExistingApiWidgetBindings(prisma: PrismaClient): Promise<void> {
  const adopted = await prisma.systemConfig.findUnique({
    where: { key: API_WIDGET_BINDINGS_ADOPTED_KEY },
    select: { value: true }
  });
  if (adopted?.value === "true") return;

  const widgets = await prisma.apiWidget.findMany({
    select: { id: true, authType: true, authEnvVar: true, baseUrl: true }
  });
  const bindings = await readBindings(prisma);
  let changed = false;
  for (const widget of widgets) {
    const binding = bindingFor(widget);
    if (binding && !bindings[widget.id]) {
      bindings[widget.id] = binding;
      changed = true;
    }
  }
  if (changed) await writeBindings(prisma, bindings);
  await prisma.systemConfig.upsert({
    where: { key: API_WIDGET_BINDINGS_ADOPTED_KEY },
    create: { key: API_WIDGET_BINDINGS_ADOPTED_KEY, value: "true" },
    update: { value: "true" }
  });
}

export function widgetSecretOrigin(
  widget: Pick<ApiWidget, "authType" | "authEnvVar" | "baseUrl">
): string | null {
  return bindingFor(widget)?.origin ?? null;
}
