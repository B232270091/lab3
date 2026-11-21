import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const recoveryTime = new Trend('recovery_ms', true);
const paymentApplicationErrors = new Rate('pay_application_failed');
let firstFailedCartAt = null;

export const options = {
  vus: 20,
  duration: __ENV.DURATION || '1m',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    'http_req_duration{name:cart}': ['p(95)<20'],
    'http_req_failed{name:pay}': ['rate<0.08'],
    checks: ['rate>=0.90'],
    'http_req_duration{name:report}': ['p(95)<450'],
    ...(__ENV.CHAOS === '1' ? { recovery_ms: ['p(95)<12000'] } : {}),
  },
};

export default function () {
  const base = 'http://127.0.0.1:3000';
  const cart = http.post(`${base}/cart/add`, null, { tags: { name: 'cart' } });

  if (cart.status !== 200 && firstFailedCartAt === null) {
    firstFailedCartAt = Date.now();
  } else if (cart.status === 200 && firstFailedCartAt !== null) {
    recoveryTime.add(Date.now() - firstFailedCartAt);
    firstFailedCartAt = null;
  }

  const report = http.get(`${base}/report`, { tags: { name: 'report' } });
  const payment = http.post(`${base}/pay`, null, { tags: { name: 'pay' } });

  check(cart, { 'cart 200': (response) => response.status === 200 });
  check(report, { 'report 200': (response) => response.status === 200 });
  check(payment, { 'pay 200': (response) => response.status === 200 });

  if (payment.status !== 0) {
    paymentApplicationErrors.add(payment.status !== 200);
  }

  sleep(1);
}
