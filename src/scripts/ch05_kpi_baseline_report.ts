import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import {
  AUTOPILOT_KPI_DEFINITIONS,
  AUTOPILOT_KPI_METRIC_IDS,
  buildSignedAutopilotKpiBaselineReport,
  type AutopilotKpiBaselineReport,
} from "../lib/contracts/autopilotKpi";
import {
  buildAutopilotKpiDashboard,
  DEFAULT_CH05_BASELINE_REPORT_PATH,
} from "../lib/kpi/autopilotDashboard";
import { prisma } from "../lib/db";

type CliOptions = {
  freeze: boolean;
  windowDays: number;
  outputPath: string;
  markdownPath: string;
  signedBy: string;
  reportId?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    freeze: false,
    windowDays: 30,
    outputPath: DEFAULT_CH05_BASELINE_REPORT_PATH,
    markdownPath: path.join(process.cwd(), "docs/reports/CH05_KPI_BASELINE_REPORT.md"),
    signedBy: process.env.KPI_BASELINE_SIGNED_BY || "Agent_1",
  };

  for (const arg of argv) {
    if (arg === "--freeze") {
      options.freeze = true;
      continue;
    }
    if (arg.startsWith("--window-days=")) {
      const parsed = Number(arg.split("=")[1]);
      if (Number.isFinite(parsed)) {
        options.windowDays = Math.max(1, Math.min(180, Math.round(parsed)));
      }
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.outputPath = path.resolve(process.cwd(), arg.split("=")[1]);
      continue;
    }
    if (arg.startsWith("--markdown-output=")) {
      options.markdownPath = path.resolve(process.cwd(), arg.split("=")[1]);
      continue;
    }
    if (arg.startsWith("--signed-by=")) {
      const signedBy = arg.split("=")[1].trim();
      if (signedBy) options.signedBy = signedBy;
      continue;
    }
    if (arg.startsWith("--report-id=")) {
      const reportId = arg.split("=")[1].trim();
      if (reportId) options.reportId = reportId;
      continue;
    }
  }

  return options;
}

function formatMetricValue(value: number | null) {
  if (value === null) return "n/a";
  return value.toFixed(4);
}

function buildMarkdownReport(report: AutopilotKpiBaselineReport) {
  const lines: string[] = [];
  lines.push("# CH-05 KPI Baseline Report");
  lines.push("");
  lines.push(`- Report ID: \`${report.reportId}\``);
  lines.push(`- Contract version: \`${report.contractVersion}\``);
  lines.push(`- Generated at (UTC): \`${report.generatedAt}\``);
  lines.push(`- Window: \`${report.window.from}\` -> \`${report.window.to}\` (${report.window.windowDays} days)`);
  lines.push(`- Signed by: \`${report.signoff.signedBy}\``);
  lines.push(`- Signed at (UTC): \`${report.signoff.signedAt}\``);
  lines.push(`- Signature: \`${report.signoff.signature}\``);
  lines.push("");
  lines.push("| Metric | Value | Sample | Status | Numerator | Denominator |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const metricId of AUTOPILOT_KPI_METRIC_IDS) {
    const metric = report.metrics.find((row) => row.metricId === metricId);
    if (!metric) continue;
    const definition = AUTOPILOT_KPI_DEFINITIONS[metricId];
    lines.push(
      `| ${definition.label} (${metricId}) | ${formatMetricValue(metric.value)} ${definition.unit} | ${metric.sampleSize} | ${metric.status} | ${formatMetricValue(metric.numerator ?? null)} | ${formatMetricValue(metric.denominator ?? null)} |`
    );
  }
  lines.push("");
  lines.push("Notes:");
  lines.push("- retention metrics are computed on delayed direct evidence windows with a 21-day grace period.");
  lines.push("- frustration proxy = needs_retry OR recoveryTriggered OR taskScore < 45.");
  lines.push("- this report is machine-signed with SHA-256 over report payload + signoff metadata.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = new Date();
  const dashboard = await buildAutopilotKpiDashboard({
    windowDays: options.windowDays,
    includeBaseline: false,
    now,
  });

  const signedAt = now.toISOString();
  const reportId = options.reportId || `ch05-kpi-baseline-${signedAt.slice(0, 10)}`;
  const report = buildSignedAutopilotKpiBaselineReport({
    reportId,
    generatedAt: dashboard.generatedAt,
    window: dashboard.window,
    metrics: dashboard.metrics,
    signedBy: options.signedBy,
    signedAt,
  });

  const json = JSON.stringify(report, null, 2);
  if (!options.freeze) {
    console.log(json);
    if (dashboard.warnings.length > 0) {
      console.error(`[ch05-kpi-baseline] warnings: ${dashboard.warnings.join("; ")}`);
    }
    return;
  }

  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, `${json}\n`, "utf8");
  const markdown = buildMarkdownReport(report);
  await fs.mkdir(path.dirname(options.markdownPath), { recursive: true });
  await fs.writeFile(options.markdownPath, markdown, "utf8");

  console.log(`[ch05-kpi-baseline] baseline JSON written to ${options.outputPath}`);
  console.log(`[ch05-kpi-baseline] baseline Markdown written to ${options.markdownPath}`);
  if (dashboard.warnings.length > 0) {
    console.error(`[ch05-kpi-baseline] warnings: ${dashboard.warnings.join("; ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
