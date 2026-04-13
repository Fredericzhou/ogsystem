const event = process.env.HUMAN_SIGNAL_EVENT ?? "SIGNAL_OK";
console.log(
  JSON.stringify({
    event,
    content: `human signal result: ${event}`,
    data: {
      channel: "pager"
    }
  })
);
