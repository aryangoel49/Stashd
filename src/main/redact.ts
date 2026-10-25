// Removes secrets from URLs and shell commands before they are saved.
// Pure functions, no Electron or Node imports, so they are easy to test.

export const REDACTED = '[REDACTED]';

const SECRET_NAME = /(pass(word|wd)?|secret|token|api[_-]?key|apikey|access[_-]?key|auth|credential|session|sig(nature)?|private[_-]?key|client[_-]?secret)/i;

// Commands where "-p <value>" means a password (for others, like mkdir -p or docker -p, it does not).
const PASSWORD_DASH_P_TOOLS = /^(sudo\s+)?(mysql|mysqldump|mysqladmin|mariadb|mariadb-dump|sshpass|mongo|mongosh|mongodump|mongorestore|redis-cli)\b/;

/** Long random-looking strings: hex over 32 chars, or base64-ish over 32 chars mixing upper case, lower case and digits. */
export function redactLongSecrets(s: string): string {
  return s
    .replace(/\b[0-9a-fA-F]{33,}\b/g, REDACTED)
    .replace(/[A-Za-z0-9+_=-]{33,}/g, (m) => (looksRandom(m) ? REDACTED : m));
}

function looksRandom(m: string): boolean {
  if (m.startsWith('-')) return false;
  if (!/[0-9]/.test(m) || !/[a-z]/.test(m) || !/[A-Z]/.test(m)) return false;
  const separators = (m.match(/[-_]/g) ?? []).length;
  return separators / m.length < 0.1;
}

/** AWS-style access key ids (AKIA..., ASIA...). */
function redactAwsKeys(s: string): string {
  return s.replace(/\b(AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/g, REDACTED);
}

/** Redact secrets inside a shell command line. */
export function redactCommand(cmd: string): string {
  let out = cmd;

  // Authorization headers and bearer tokens.
  out = out.replace(/(Authorization:\s*)(Bearer\s+|Basic\s+|Token\s+)?[^'"\s]+/gi, (_m, h: string, scheme: string | undefined) => `${h}${scheme ?? ''}${REDACTED}`);
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, `$1${REDACTED}`);

  // export SOMETHING_KEY=value, MY_SECRET=value, GITHUB_TOKEN=value, DB_PASSWORD=value (with or without export).
  out = out.replace(
    /\b((?:export\s+)?[A-Za-z_][A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIALS?)[A-Za-z0-9_]*=)("[^"]*"|'[^']*'|\S+)/gi,
    `$1${REDACTED}`,
  );

  // --password value, --password=value, --token value, --api-key=value, --secret value.
  out = out.replace(
    /(--?(?:password|passwd|pass|token|api[-_]?key|apikey|secret|access[-_]?token|auth[-_]?token|client[-_]?secret)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi,
    `$1${REDACTED}`,
  );

  // key=value pairs anywhere (query strings, config flags): token=, api_key=, password=, secret=.
  out = out.replace(
    /\b((?:access_|auth_|refresh_|id_)?(?:token|api[_-]?key|apikey|password|passwd|secret|client_secret)=)([^&\s'"]+)/gi,
    `$1${REDACTED}`,
  );

  // -p<password> (mysql -pS3cret) and "-p <password>" for database and ssh tools.
  // Other commands use -p for normal things (mkdir -p, docker -p 8080:80), so they are left alone.
  if (PASSWORD_DASH_P_TOOLS.test(out.trimStart())) {
    out = out.replace(/(\s)-p(?=[^\s-])\S+/g, `$1-p${REDACTED}`);
    out = out.replace(/(\s-p\s+)(?!\[REDACTED\])("[^"]*"|'[^']*'|\S+)/g, `$1${REDACTED}`);
  }

  // user:password@host in URLs.
  out = out.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, `$1$2:${REDACTED}@`);

  out = redactAwsKeys(out);
  out = redactLongSecrets(out);
  return out;
}

/** Redact secrets inside a URL that we are going to keep the query string of. */
export function redactUrlString(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return redactCommand(raw);
  }
  if (u.username || u.password) {
    u.username = '';
    u.password = '';
  }
  for (const [k] of [...u.searchParams]) {
    if (SECRET_NAME.test(k) || k.toLowerCase() === 'key' || k.toLowerCase() === 'code') {
      u.searchParams.set(k, REDACTED);
    }
  }
  const params = [...u.searchParams].map(([k, v]) => [k, redactAwsKeys(redactLongSecrets(v))]);
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  if (u.hash) u.hash = redactLongSecrets(u.hash);
  u.pathname = redactLongSecrets(decodeSafe(u.pathname));
  return u.toString().replace(/%5BREDACTED%5D/g, REDACTED);
}

function decodeSafe(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}
