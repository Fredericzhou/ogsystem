import { greet } from './gate-c-output.mjs';

if (greet('v2') !== 'Hello, v2!') {
  process.exit(1);
}
