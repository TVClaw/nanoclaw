const fs = require('fs');
const path = require('path');

const envPath = path.join(process.cwd(), '.env');
const val = process.argv[2];
if (!val || !String(val).trim()) {
  process.stderr.write('empty key\n');
  process.exit(1);
}
const key = 'ANTHROPIC_API_KEY';
const line = `${key}=${String(val).trim()}`;
let c = '';
try {
  c = fs.readFileSync(envPath, 'utf8');
} catch {
  c = '';
}
const re = new RegExp(`^${key}=.*$`, 'm');
if (re.test(c)) {
  c = c.replace(re, line);
} else {
  const sep = c === '' || c.endsWith('\n') ? '' : '\n';
  c = `${c}${sep}${line}\n`;
}
if (!c.endsWith('\n')) {
  c += '\n';
}
fs.writeFileSync(envPath, c);
