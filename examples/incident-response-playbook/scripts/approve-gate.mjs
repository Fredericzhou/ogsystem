const event = process.env.HUMAN_APPROVE_EVENT ?? "APPROVED";
console.log(
  JSON.stringify({
    event,
    content: `approval decision: ${event}`,
    data: {
      owner: "incident-commander"
    }
  })
);
