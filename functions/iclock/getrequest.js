// ADMS command-poll endpoint. The device polls for server commands; we have none, so ack "OK".
const text = (s) => new Response(s, { status: 200, headers: { "Content-Type": "text/plain" } });
export async function onRequestGet() { return text("OK"); }
export async function onRequestPost() { return text("OK"); }
