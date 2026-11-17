import { describe, expect, it } from 'vitest';

import { explorerTx } from '../src/lib/networks';

const HASH = 'a'.repeat(64);

describe('explorerTx', () => {
  it('builds an https link by the template', () => {
    expect(explorerTx('https://nile.tronscan.org/#/transaction/{txHash}', HASH)).toBe(
      `https://nile.tronscan.org/#/transaction/${HASH}`,
    );
    expect(explorerTx('https://sepolia.basescan.org/tx/{txHash}', `0x${HASH}`)).toBe(
      `https://sepolia.basescan.org/tx/0x${HASH}`,
    );
  });

  it.each([
    ['no template', null],
    ['javascript:', 'javascript:alert(1)//{txHash}'],
    ['data:', 'data:text/html,{txHash}'],
    ['http:', 'http://explorer.example/tx/{txHash}'],
    ['no placeholder', 'https://explorer.example/tx/'],
    ['protocol-relative', '//evil.example/{txHash}'],
  ])('gives no link for %s', (_name, template) => {
    expect(explorerTx(template, HASH)).toBeNull();
  });

  it.each([
    ['not a hash', 'abc'],
    ['a path', `${HASH}/../../x`],
    ['markup', `"><img src=x onerror=alert(1)>`],
  ])('gives no link when the hash is %s', (_name, hash) => {
    expect(explorerTx('https://explorer.example/tx/{txHash}', hash)).toBeNull();
  });
});
