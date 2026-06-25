// Simulate a ZKTeco Push terminal: handshake + ATTLOG upload. No hardware needed.
// Usage: node db/sim-attendance.mjs [baseURL]   (default: production)
const BASE = process.argv[2] || "https://ocoabay-clone.pages.dev";
const SN = "SIM0001";
const UA = "iClock Proxy/1.0";

function pad(n){return String(n).padStart(2,"0");}
function ts(offsetMin){ const d=new Date(Date.now()+offsetMin*60000 - 4*3600*1000); // DR local wall clock
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }

const g = await fetch(`${BASE}/iclock/cdata?SN=${SN}&options=all&pushver=2.4.1`, { headers: { "User-Agent": UA } });
console.log("handshake:", g.status, (await g.text()).split("\n")[0]);

// two employees punching (device user ids 101, 102); 101 punches twice (in then out)
const body = [
  `101\t${ts(-120)}\t0\t1`,
  `102\t${ts(-110)}\t0\t1`,
  `101\t${ts(-5)}\t1\t1`,
].join("\n") + "\n";
const p = await fetch(`${BASE}/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, {
  method: "POST", headers: { "User-Agent": UA, "Content-Type": "text/plain" }, body });
console.log("ATTLOG upload:", p.status, await p.text());

// replay same payload -> dedup should yield 0 new
const p2 = await fetch(`${BASE}/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, {
  method: "POST", headers: { "User-Agent": UA, "Content-Type": "text/plain" }, body });
console.log("ATTLOG re-upload (dedup):", p2.status, await p2.text());

const gr = await fetch(`${BASE}/iclock/getrequest?SN=${SN}`, { headers: { "User-Agent": UA } });
console.log("getrequest:", gr.status, await gr.text());
