import { runAllAcceptanceTests } from '../src/services/optimizer/testSuite';

console.log('Running GPAK PS01 V3.2 Automated Regression Suite...');
const res = runAllAcceptanceTests();

console.log(`\n======================================================`);
console.log(`RESULTS: ${res.passed}/${res.total} PASSED (${res.failed} FAILED)`);
console.log(`======================================================\n`);

res.results.forEach(r => {
  const icon = r.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${r.id}] ${r.name}`);
  console.log(`   Expected: ${r.expected}`);
  console.log(`   Actual:   ${r.actual}\n`);
});

if (res.failed > 0) {
  process.exit(1);
} else {
  console.log('ALL 19 REGRESSION TESTS PASSED STRICTLY!');
}
