const event = process.env.HUMAN_APPROVE_EVENT ?? "APPROVED";
console.log(
  JSON.stringify({
    event,
    content: `approval gate decision: ${event}`,
    data: {
      source: "human-approve-gate",
      actor: "operator"
    }
  })
);
