console.log(
  JSON.stringify({
    event: "READY",
    content: "runtime failure handled by compensation template",
    data: {
      action: "fallback_flow",
      owner: "error-handler-base"
    }
  })
);
