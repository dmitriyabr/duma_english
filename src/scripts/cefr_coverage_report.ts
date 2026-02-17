import {
  buildCefrCoverageReport,
  CEFR_COVERAGE_MATRIX,
} from "../lib/contracts/cefrCoverageMatrix";

const strict = !process.argv.includes("--no-strict");

function main() {
  const report = buildCefrCoverageReport(CEFR_COVERAGE_MATRIX);
  console.log(JSON.stringify(report, null, 2));

  if (strict && report.summary.releaseBlocker) {
    console.error(`[cefr-coverage] release blocker: ${report.summary.totalGaps} gap(s) found.`);
    process.exit(1);
  }
}

main();
