// Generated from ProductFactory/_services/openhelm-analytics/pageview-startup.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./openhelm-analytics.tsx', import.meta.url), 'utf8');
const bootstrap = source.split('{`window.dataLayer')[1]?.split('`}')[0];
function execute({ allowAutomatic = true } = {}) {
  assert.ok(bootstrap, 'inline bootstrap must remain executable for the observed double-page-view regression');
  const commands = []; const hits = []; let sendAutomatic = allowAutomatic;
  const context = { Date, dataLayer: [] }; context.window = context;
  context.dataLayer.push = function (args) {
    const command = Array.from(args); commands.push(command);
    if (command[0] === 'set' && typeof command[1] === 'object' && 'send_page_view' in command[1]) sendAutomatic = command[1].send_page_view;
    // Reproduce the real tag's first implicit hit observed before destination config.
    if (command[0] === 'js' && sendAutomatic) hits.push('automatic');
    return Array.prototype.push.call(this, args);
  };
  vm.runInNewContext('window.dataLayer' + bootstrap.replaceAll('${MEASUREMENT_ID}', 'G-TESTSTART'), context);
  return { commands, hits };
}
test('disables implicit page views before js startup, not only after the destination config', () => {
  const { commands, hits } = execute();
  assert.deepEqual(JSON.parse(JSON.stringify(commands[0])), ['set', { send_page_view: false }]);
  assert.equal(commands[1][0], 'js');
  assert.deepEqual(JSON.parse(JSON.stringify(commands[2])), ['config', 'G-TESTSTART', { send_page_view: false }]);
  assert.equal(hits.length, 0, 'the initial page is owned by the existing explicit SPA page-view tracker');
});
test('keeps the initial preference explicit even when automatic page views were already off', () => {
  const { commands, hits } = execute({ allowAutomatic: false });
  assert.equal(hits.length, 0);
  assert.equal(commands.filter(c => c[0] === 'config').length, 1);
});
