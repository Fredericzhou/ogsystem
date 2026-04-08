#!/usr/bin/env node
const event = process.argv[2] ?? "PATH_A";
console.log(JSON.stringify({ event, content: `selected:${event}` }));
