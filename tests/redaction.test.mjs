import test from "node:test";
import assert from "node:assert/strict";

import { redactText, redactUnknown } from "../dist/runtime/redaction.js";

test("redaction masks authorization headers and provider credential keys", () => {
  const cases = [
    "Authorization: Bearer sk-testsecret123456",
    "authorization=Basic abcdefghijklmnop",
    "provider credential token=secret-value",
    "apiKey=sk-anothersecret123456"
  ];

  for (const value of cases) {
    const redacted = redactText(value);
    assert.doesNotMatch(redacted, /sk-testsecret123456|abcdefghijklmnop|secret-value|sk-anothersecret123456/);
    assert.match(redacted, /\[REDACTED\]/);
  }
});

test("structured redaction masks sensitive object keys without rewriting safe fields", () => {
  const redacted = redactUnknown({
    provider: "opencode",
    apiKey: "plain-provider-key",
    headers: {
      Authorization: "Bearer plain-token-value"
    },
    nested: {
      providerCredentials: {
        token: "nested-token"
      },
      model: "openai/gpt-5.4"
    }
  });

  assert.deepEqual(redacted, {
    provider: "opencode",
    apiKey: "[REDACTED]",
    headers: {
      Authorization: "[REDACTED]"
    },
    nested: {
      providerCredentials: "[REDACTED]",
      model: "openai/gpt-5.4"
    }
  });
});
