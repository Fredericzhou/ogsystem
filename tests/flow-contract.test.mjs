import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import {
  loadFlowContractPlan,
  validateContractAgainstSchema
} from "../dist/runtime/flow-contract.js";

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("flow-contract loader resolves nested local $ref schemas", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-flow-contract-ref-"));
  const contractsDir = path.resolve(tempRoot, "contracts");
  await mkdir(contractsDir, { recursive: true });

  await writeJson(path.resolve(contractsDir, "payload.schema.json"), {
    type: "object",
    properties: {
      kind: {
        type: "string",
        const: "ok"
      },
      amount: {
        type: "integer"
      }
    },
    required: ["kind", "amount"],
    additionalProperties: false
  });

  await writeJson(path.resolve(contractsDir, "flow.schema.json"), {
    type: "object",
    properties: {
      event: {
        type: "string",
        const: "PASS"
      },
      data: {
        $ref: "./payload.schema.json"
      }
    },
    required: ["event", "data"],
    additionalProperties: false
  });

  await writeJson(path.resolve(contractsDir, "review-input.schema.json"), {
    type: "object",
    properties: {
      task: {
        type: "string"
      }
    },
    required: ["task"],
    additionalProperties: false
  });

  const contractPath = path.resolve(contractsDir, "handoff.contracts.json");
  await writeJson(contractPath, {
    version: 1,
    contracts: [
      {
        id: "dispatcher.review.v1",
        kind: "flow",
        match: {
          fromRoleId: "dispatcher",
          eventType: "PASS",
          toRoleId: "review"
        },
        schema: "flow.schema.json",
        onViolation: "FAIL"
      },
      {
        id: "review.input.v1",
        kind: "role_input",
        match: {
          roleId: "review"
        },
        schema: "review-input.schema.json",
        onViolation: "FAIL"
      }
    ]
  });

  const system = {
    systemId: "demo.flow.contract.ref",
    systemVersion: "1.0.0",
    entryRoleId: "dispatcher",
    roleIds: ["dispatcher", "review"],
    flows: [
      {
        fromRoleId: "dispatcher",
        toRoleId: "review",
        eventType: "PASS"
      }
    ],
    lawBinding: {
      globalLawRef: "law.demo"
    },
    talentBinding: {},
    executionBinding: {},
    modelBinding: {},
    graph: {
      handoffMode: "strict",
      handoffContracts: contractPath,
      contextMapByRoleId: {
        review: {
          task: "global.task"
        }
      },
      routingModeByRoleId: {},
      joinModeByRoleId: {},
      joinSourcesByRoleId: {},
      joinMinByRoleId: {},
      loopMaxByRoleId: {}
    }
  };

  const plan = await loadFlowContractPlan({
    system,
    contractPath
  });
  const contract = plan.flowContractsByKey.get("flow:dispatcher:PASS:review");
  assert.ok(contract);
  assert.deepStrictEqual(
    validateContractAgainstSchema({
      contract,
      data: {
        event: "PASS",
        data: {
          kind: "ok",
          amount: 3
        }
      },
      subject: "flow"
    }),
    undefined
  );
  assert.match(
    validateContractAgainstSchema({
      contract,
      data: {
        event: "PASS",
        data: {
          kind: "ok"
        }
      },
      subject: "flow"
    }),
    /amount/
  );
});

test("flow-contract loader rejects remote schema $ref", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-flow-contract-remote-"));
  const contractsDir = path.resolve(tempRoot, "contracts");
  await mkdir(contractsDir, { recursive: true });

  await writeJson(path.resolve(contractsDir, "flow.schema.json"), {
    $ref: "https://example.com/schema.json"
  });

  const contractPath = path.resolve(contractsDir, "handoff.contracts.json");
  await writeJson(contractPath, {
    version: 1,
    contracts: [
      {
        id: "dispatcher.review.v1",
        kind: "flow",
        match: {
          fromRoleId: "dispatcher",
          eventType: "PASS",
          toRoleId: "review"
        },
        schema: "flow.schema.json"
      }
    ]
  });

  const system = {
    systemId: "demo.flow.contract.remote",
    systemVersion: "1.0.0",
    entryRoleId: "dispatcher",
    roleIds: ["dispatcher", "review"],
    flows: [
      {
        fromRoleId: "dispatcher",
        toRoleId: "review",
        eventType: "PASS"
      }
    ],
    lawBinding: {
      globalLawRef: "law.demo"
    },
    talentBinding: {},
    executionBinding: {},
    modelBinding: {},
    graph: {
      handoffMode: "strict",
      handoffContracts: contractPath,
      contextMapByRoleId: {},
      routingModeByRoleId: {},
      joinModeByRoleId: {},
      joinSourcesByRoleId: {},
      joinMinByRoleId: {},
      loopMaxByRoleId: {}
    }
  };

  await assert.rejects(
    () =>
      loadFlowContractPlan({
        system,
        contractPath
      }),
    /remote \$ref/i
  );
});
