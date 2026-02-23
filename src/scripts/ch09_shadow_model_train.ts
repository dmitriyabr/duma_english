import { trainAndActivateShadowModelSnapshot } from "@/lib/shadow/valueModel";

function parseWindowDays(argv: string[]) {
  const arg = argv.find((item) => item.startsWith("--windowDays="));
  if (!arg) return 90;
  const value = Number(arg.split("=")[1]);
  if (!Number.isFinite(value)) return 90;
  return Math.max(30, Math.min(180, Math.floor(value)));
}

async function main() {
  const windowDays = parseWindowDays(process.argv.slice(2));
  const snapshot = await trainAndActivateShadowModelSnapshot({ windowDays });
  console.log(
    JSON.stringify(
      {
        event: "shadow_model_snapshot_trained",
        windowDays,
        snapshot,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "shadow_model_snapshot_train_failed",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});

