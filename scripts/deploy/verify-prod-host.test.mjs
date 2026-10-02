import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyFirewall } from './verify-prod-host.mjs';

const baseline = `Status: active
Default: deny (incoming), allow (outgoing), disabled (routed)
To                         Action      From
--                         ------      ----
2222/tcp                   ALLOW IN    192.0.2.0/24
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
2222/tcp (v6)              ALLOW IN    2001:db8::/32
80/tcp (v6)                ALLOW IN    Anywhere (v6)
443/tcp (v6)               ALLOW IN    Anywhere (v6)
`;

test('UFW verifier accepts the approved SSH port with source restrictions and IPv4/IPv6 web rules', () => {
  assert.equal(verifyFirewall(baseline, '2222'), true);
});

test('UFW verifier fails closed on missing/inactive/unsafe/unsupported policies', () => {
  for (const status of [
    '',
    baseline.replace('Status: active', 'Status: inactive'),
    baseline.replace('deny (incoming)', 'allow (incoming)'),
    baseline.replace('disabled (routed)', 'allow (routed)'),
    baseline.replaceAll('443/tcp', '444/tcp'),
    `${baseline}8080/tcp                   ALLOW IN    Anywhere\n`,
    `${baseline}443/udp                    ALLOW IN    Anywhere\n`,
    `${baseline}22:65535/tcp               ALLOW IN    Anywhere\n`,
    `${baseline}Anywhere                   ALLOW IN    192.0.2.0/24\n`,
    `${baseline}Anywhere on eth0           ALLOW FWD   Anywhere on eth1\n`,
    `${baseline}OpenSSH                    ALLOW IN    Anywhere\n`,
  ])
    assert.equal(verifyFirewall(status, '2222'), false, status);
  for (const port of [undefined, '', '0', '65536', '22;echo', '22']) {
    assert.equal(verifyFirewall(baseline, port), false, String(port));
  }
});
