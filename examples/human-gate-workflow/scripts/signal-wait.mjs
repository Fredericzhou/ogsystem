const event = process.env.HUMAN_SIGNAL_EVENT ?? "SIGNAL_OK";
console.log(
  JSON.stringify({
    event,
    content: `signal wait result: ${event}`,
    data: {
      source: "human-signal-wait",
      actor: "operator"
    }
  })
);
