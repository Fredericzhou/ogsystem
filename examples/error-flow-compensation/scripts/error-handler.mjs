console.log(
  JSON.stringify({
    event: "COMPENSATED",
    content: "runtime failure handled by compensation template",
    data: {
      action: "fallback_flow",
      owner: "error-handler-base"
    }
  })
);
