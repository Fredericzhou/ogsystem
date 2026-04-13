console.log(
  JSON.stringify({
    event: "COMPENSATED",
    content: "failure captured and switched to human approval",
    data: {
      action: "fallback_to_human_gate",
      severity: "high"
    }
  })
);
