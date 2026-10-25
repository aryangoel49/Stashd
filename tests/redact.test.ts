import { describe, expect, it } from 'vitest';
import { REDACTED, redactCommand, redactLongSecrets, redactUrlString } from '../src/main/redact';

describe('document addresses', () => {
  it('keeps long document ids, but blanks one-time links', () => {
    const doc = 'https://docs.google.com/document/d/1aBcD3fGhIjKlMnOpQrStUvWxYz0123456789AbCdEf/edit';
    expect(redactUrlString(doc)).toBe(doc);
    expect(redactUrlString('https://x.io/reset/aZ9bY8cX7dW6eV5fU4gT3hS2iR1jQ0kP9oN8mL7')).toBe(`https://x.io/reset/${REDACTED}`);
  });
});

describe('redactCommand', () => {
  it.each([
    ['mysql -u root --password hunter2 db', 'mysql -u root --password [REDACTED] db'],
    ['mysql -u root --password=hunter2 db', 'mysql -u root --password=[REDACTED] db'],
    ['mysql -u root -phunter2 db', 'mysql -u root -p[REDACTED] db'],
    ['mysql -u root -p hunter2 db', 'mysql -u root -p [REDACTED] db'],
    ['cli login --token abc123', 'cli login --token [REDACTED]'],
    ['tool --api-key=sk_live_x', 'tool --api-key=[REDACTED]'],
    ['curl "https://x.io/?token=abc&x=1"', 'curl "https://x.io/?token=[REDACTED]&x=1"'],
    ['curl https://x.io/?api_key=abc', 'curl https://x.io/?api_key=[REDACTED]'],
    ['curl -H "Authorization: Bearer abc.def"', 'curl -H "Authorization: Bearer [REDACTED]"'],
    ['curl -H "Authorization: token123"', 'curl -H "Authorization: [REDACTED]"'],
    ['http get x.io Bearer abc.def.ghi', 'http get x.io Bearer [REDACTED]'],
    ['export OPENAI_API_KEY=sk-123', 'export OPENAI_API_KEY=[REDACTED]'],
    ['export MY_SECRET="a b c"', 'export MY_SECRET=[REDACTED]'],
    ['export GITHUB_TOKEN=ghp_x', 'export GITHUB_TOKEN=[REDACTED]'],
    ['DB_PASSWORD=pw npm start', 'DB_PASSWORD=[REDACTED] npm start'],
    ['aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'aws configure set aws_access_key_id [REDACTED]'],
    ['git clone https://me:pa55@github.com/x/y', 'git clone https://me:[REDACTED]@github.com/x/y'],
  ])('%s', (input, expected) => {
    expect(redactCommand(input)).toBe(expected);
  });

  it('removes long hex strings', () => {
    expect(redactCommand(`echo ${'a1'.repeat(20)}`)).toBe(`echo ${REDACTED}`);
  });

  it('removes long base64-looking strings', () => {
    expect(redactCommand('echo dGhpc0lzQVNlY3JldEtleVRoYXRJc0xvbmc9PQ1234')).toBe(`echo ${REDACTED}`);
  });

  it('leaves normal commands alone', () => {
    for (const cmd of ['mkdir -p src/components', 'docker run -p 8080:80 nginx', 'npm run dev', 'git commit -m "fix the login page"', 'ls -la /Users/aryangoel/Documents/where-was-i/src/main', 'cd ~/Documents/some-really-long-project-folder-name']) {
      expect(redactCommand(cmd)).toBe(cmd);
    }
  });

  it('does not touch 32-char hex (only over 32)', () => {
    const hex32 = 'a'.repeat(16) + '0'.repeat(16);
    expect(redactLongSecrets(hex32)).toBe(hex32);
  });
});

describe('redactUrlString', () => {
  it('redacts secret-looking query params and keeps others', () => {
    const out = redactUrlString('https://x.io/cb?code=abc&state=1&access_token=zzz&page=2');
    expect(out).toBe('https://x.io/cb?code=[REDACTED]&state=1&access_token=[REDACTED]&page=2');
  });
  it('removes user info', () => {
    expect(redactUrlString('https://me:pw@x.io/a')).toBe('https://x.io/a');
  });
  it('redacts tokens in the path', () => {
    const tok = 'Zx9QwErTy7UiOp3AsDfGh5JkLzXcVbNm1Qa2';
    expect(redactUrlString(`https://x.io/reset/${tok}`)).toBe('https://x.io/reset/[REDACTED]');
  });
});
