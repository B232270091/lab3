const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const lines = [];

for (const mode of ['pass', 'fail', 'chaos']) {
  const summaryPath = path.join(root, 'results', `${mode}-summary.json`);
  if (!existsSync(summaryPath)) continue;

  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const metrics = summary.metrics;
  const checks = Object.values(summary.root_group.checks);
  const successes = checks.reduce((total, check) => total + check.passes, 0);
  const failures = checks.reduce((total, check) => total + check.fails, 0);
  const total = successes + failures;
  const payment = summary.root_group.checks['pay 200'];
  const log = readFileSync(path.join(root, 'results', `${mode}.txt`), 'utf8');

  lines.push(`[${mode}]`);
  lines.push(`requests=${total}; successes=${successes}; failures=${failures}`);
  lines.push(`requests_per_second=${metrics.http_reqs.rate.toFixed(6)}`);
  lines.push(`cart_p95_ms=${metrics['http_req_duration{name:cart}']['p(95)'].toFixed(4)}`);
  lines.push(`report_p95_ms=${metrics['http_req_duration{name:report}']['p(95)'].toFixed(4)}`);
  lines.push(`pay_requests=${payment.passes + payment.fails}; pay_failures=${payment.fails}`);
  lines.push(`pay_error_percent=${(metrics['http_req_failed{name:pay}'].value * 100).toFixed(4)}`);
  lines.push(`pay_application_error_percent=${(metrics.pay_application_failed.value * 100).toFixed(4)}`);
  lines.push(`availability_percent=${(successes / total * 100).toFixed(4)}`);
  lines.push(`http_req_failed_percent=${(metrics.http_req_failed.value * 100).toFixed(4)}`);
  lines.push(`exit_code=${log.match(/exit_code=(\d+)/)[1]}`);

  for (const [metricName, metric] of Object.entries(metrics)) {
    for (const [threshold, failed] of Object.entries(metric.thresholds || {})) {
      lines.push(`${metricName} ${threshold}: ${failed ? 'FAIL' : 'PASS'}`);
    }
  }

  if (mode === 'chaos') {
    const downtime = Number(log.match(/CHAOS_DOWNTIME_MS=(\d+)/)[1]);
    const allowedFailures = Math.floor(total / 10);
    lines.push(`recovery_p95_ms=${metrics.recovery_ms['p(95)'].toFixed(4)}`);
    lines.push(`observed_downtime_ms=${downtime}`);
    lines.push('nominal_window_seconds=120; time_error_budget_seconds=12');
    lines.push(`time_availability_percent=${((120000 - downtime) / 120000 * 100).toFixed(4)}`);
    lines.push(`request_error_budget=${allowedFailures}; actual_failures=${failures}; excess_failures=${Math.max(0, failures - allowedFailures)}`);
  }

  lines.push('');
}

const report = lines.join('\n');
writeFileSync(path.join(root, 'results', 'summary.txt'), report);
process.stdout.write(report);
