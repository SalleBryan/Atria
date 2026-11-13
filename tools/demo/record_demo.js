// Atria pain point demo, recorded from the dev preview (synthetic data) at 1920x1080.
// A drawn cursor glides to each target before clicking; pauses leave room to narrate.
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright-core");

const BASE = "http://localhost:5193/__preview";
const OUT = path.join(__dirname, "out");
const CHROME = path.join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
const W = 1920;
const H = 1080;

// Cursor and chapter label, injected into every page the preview loads.
const OVERLAY = `
(() => {
  const ready = () => {
    if (document.getElementById("demo-cursor")) return;
    const c = document.createElement("div");
    c.id = "demo-cursor";
    c.innerHTML = '<svg width="34" height="34" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6.9 3.9 7.3-2.9 1.5-3.9-7.4L4 20z" fill="#0D1B34" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0px", top: "0px", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-6px,-3px)", filter: "drop-shadow(0 3px 6px rgba(13,27,52,.35))" });
    document.documentElement.appendChild(c);
    const x = Number(sessionStorage.getItem("demo.x") || 960), y = Number(sessionStorage.getItem("demo.y") || 540);
    c.style.left = x + "px"; c.style.top = y + "px";
    window.addEventListener("mousemove", (e) => {
      c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px";
      try { sessionStorage.setItem("demo.x", e.clientX); sessionStorage.setItem("demo.y", e.clientY); } catch {}
    }, true);
    window.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: e.clientX - 22 + "px", top: e.clientY - 22 + "px", width: "44px", height: "44px", borderRadius: "50%", background: "rgba(36,97,219,.28)", zIndex: 2147483646, pointerEvents: "none", transition: "transform .45s cubic-bezier(.2,0,0,1), opacity .45s", transform: "scale(.4)" });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.6)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
})();`;

let mouse = { x: 960, y: 540 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// One knob for the whole video's pace: holds and settles scale by it.
const PACE = 0.45;
const hold = (ms) => sleep(ms * PACE);
const visible = (locator, ms = 3000) => locator.first().waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);

async function label(page, text, sub) {
  await page.evaluate(
    ([t, s]) => {
      document.getElementById("demo-label")?.remove();
      const el = document.createElement("div");
      el.id = "demo-label";
      el.innerHTML = `<div style="font:700 13px 'Plus Jakarta Sans',Arial;letter-spacing:.08em;color:#A9C6FB">${s || ""}</div><div style="font:600 22px Outfit,'Plus Jakarta Sans',Arial;color:#F6F9FE">${t}</div>`;
      Object.assign(el.style, { position: "fixed", right: "28px", bottom: "28px", zIndex: 2147483640, padding: "14px 22px", borderRadius: "22px", background: "linear-gradient(135deg,#0B2B6B,#2461DB)", boxShadow: "0 10px 30px rgba(16,42,94,.30)", pointerEvents: "none", opacity: "0", transform: "translateY(16px)", transition: "opacity .5s cubic-bezier(.2,0,0,1), transform .5s cubic-bezier(.2,0,0,1)" });
      document.documentElement.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "none"; });
    },
    [text, sub],
  );
}

async function card(page, title, lines, ms) {
  await page.evaluate(
    ([t, l]) => {
      document.getElementById("demo-card")?.remove();
      const el = document.createElement("div");
      el.id = "demo-card";
      el.innerHTML = `<div style="max-width:1100px;text-align:center"><div style="font:700 64px Outfit,Arial;color:#F6F9FE;letter-spacing:-.02em">${t}</div>${l.map((x, i) => `<div style="font:500 30px 'Plus Jakarta Sans',Arial;color:#D6E4FD;margin-top:${i ? 14 : 30}px;opacity:0;transform:translateY(18px);transition:all .6s cubic-bezier(.2,0,0,1) ${0.25 + i * 0.12}s" class="ln">${x}</div>`).join("")}</div>`;
      Object.assign(el.style, { position: "fixed", inset: "0", zIndex: 2147483645, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#0B2B6B 0%,#2461DB 100%)", opacity: "0", transition: "opacity .6s cubic-bezier(.2,0,0,1)" });
      document.documentElement.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = "1"; el.querySelectorAll(".ln").forEach((n) => { n.style.opacity = "1"; n.style.transform = "none"; }); });
    },
    [title, lines],
  );
  await sleep(ms);
  await page.evaluate(() => { const el = document.getElementById("demo-card"); if (el) { el.style.opacity = "0"; setTimeout(() => el.remove(), 650); } });
  await sleep(700);
}

async function glide(page, x, y, ms = 650) {
  // Paced by the clock: each move is a round trip to the browser.
  const from = { ...mouse };
  const start = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - start) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    if (t >= 1) break;
    await sleep(12);
  }
  mouse = { x, y };
}

async function show(page, locator) {
  await locator.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await sleep(420);
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function point(page, locator, ms = 1200) {
  const p = await show(page, locator);
  await glide(page, p.x, p.y);
  await hold(ms);
}

async function click(page, locator, after = 1100) {
  const p = await show(page, locator);
  await glide(page, p.x, p.y);
  await sleep(250);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  await hold(after);
}

async function type(page, text) {
  await page.keyboard.type(text, { delay: 38 });
  await sleep(300);
}

async function go(page, as, at) {
  await page.goto(`${BASE}?as=${as}&at=${encodeURIComponent(at)}`, { waitUntil: "networkidle" });
  await page.mouse.move(mouse.x, mouse.y);
  await sleep(500);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars", "--force-device-scale-factor=1"] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  global.__page = page;
  const t0 = Date.now();
  const mark = (s) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), s);

  // Opening card
  await go(page, "patient", "/home");
  await card(page, "Atria", ["A place in the queue, a fee before you come,", "and a message that reaches you.", "Dev preview · synthetic data · Regional Hospital Buea"], 3000);
  mark("intro");

  // 1. Waiting without knowing: the patient takes a place
  await go(page, "patient", "/find-care/queue");
  await label(page, "Waiting without knowing", "PAIN POINT 1 · PATIENT");
  await point(page, page.getByText("The visit fee is", { exact: false }).first(), 2200);
  await click(page, page.getByText("Morning", { exact: true }).first(), 1300);
  mark("morning");
  await click(page, page.getByRole("button", { name: "Take a place" }), 2600);
  mark("taken");
  await point(page, page.getByText("Ahead of you", { exact: true }).first(), 2600);
  await point(page, page.getByText("Likely to be seen around", { exact: true }).first(), 3200);
  mark("patient ticket");

  // 1b. The desk: fair queue, held doctor, override with a reason, urgent, rules
  await go(page, "opd", "/console/queue");
  await label(page, "A fair queue that never idles the doctor", "PAIN POINT 1 · FRONT DESK");
  await point(page, page.getByText("Fee 1,500 XAF").first(), 1800);
  const guard = page.getByText("Calling the next patient passes over", { exact: false });
  if (await visible(guard)) await point(page, guard.first(), 3000);
  await click(page, page.getByRole("button", { name: /^Doctor:/ }), 900);
  await click(page, page.getByText("Dr Walters Mbua").last(), 900);
  await click(page, page.getByRole("button", { name: "Call next patient" }), 2400);
  mark("called");
  const held = page.getByText("The doctor is held for", { exact: false });
  if (await visible(held, 4000)) {
    await point(page, held.first(), 3200);
    await click(page, page.getByRole("button", { name: /^Doctor:/ }), 900);
    await click(page, page.getByText("Dr Pauline Nkwelle").last(), 900);
    await click(page, page.getByRole("button", { name: "Call anyway" }).first(), 1200);
    await click(page, page.getByRole("textbox", { name: "Reason" }), 300);
    await type(page, "Phoned twice, no answer");
    await click(page, page.getByRole("dialog").getByRole("button", { name: "Call anyway" }), 2600);
    mark("override");
  }
  const herve = page.getByRole("link", { name: "Herve Kamga" }).locator('xpath=ancestor::*[.//button[normalize-space()="Urgent"]][1]');
  await click(page, herve.getByRole("button", { name: "Urgent" }), 1200);
  await click(page, page.getByRole("textbox", { name: "Reason" }), 300);
  await type(page, "Chest pain at the desk");
  await click(page, page.getByRole("button", { name: "Mark urgent" }), 2400);
  mark("desk");

  // 2. Not reachable: languages and a dropped connection
  await go(page, "patient", "/home");
  await label(page, "Reach the person who can act", "PAIN POINT 2 · REACH");
  await click(page, page.getByRole("button", { name: "Language" }).first(), 1000);
  await click(page, page.getByText("Français", { exact: true }).first(), 2800);
  await click(page, page.getByRole("button", { name: /Langue|Language/ }).first(), 1000);
  await click(page, page.getByText("English", { exact: true }).first(), 1500);
  await page.evaluate(() => { window.__atriaNetwork = "down"; window.dispatchEvent(new Event("offline")); });
  await click(page, page.getByRole("link", { name: "Find care" }).first(), 2200);
  await point(page, page.getByText("cannot be reached", { exact: false }).first(), 3000);
  await page.evaluate(() => { window.__atriaNetwork = "up"; });
  await click(page, page.getByRole("button", { name: "Try now" }).first(), 2600);
  mark("reach");

  // 3. Not knowing the cost: pay the fee in the sandbox, the desk sees it paid
  await go(page, "patient", "/visits");
  await label(page, "The fee before the visit, paid and confirmed", "PAIN POINT 3 · COST");
  await click(page, page.getByRole("button", { name: /^Pay .* now$/ }), 1800);
  await click(page, page.getByRole("button", { name: "I have paid, check" }), 2000);
  await point(page, page.getByText("Fee paid", { exact: false }).first(), 2400);
  await go(page, "receptionist", "/console/visits/a-4958");
  await label(page, "The desk confirms the full amount", "PAIN POINT 3 · FRONT DESK");
  await point(page, page.getByText("Paid in full", { exact: false }).first(), 3600);
  mark("payment");

  // Closing card: engineering points
  await card(
    page,
    "Built to be trusted",
    [
      "The server sets every place in the queue; a client cannot",
      "Only the receptionist marks urgent, with a reason, audited",
      "Queue rules are settings for the hospital, the unit and the day",
      "A payment counts only when Fapshi confirms the full amount",
      "Reads retry safely; a booking is never made twice",
    ],
    6000,
  );
  mark("end");

  const video = page.video();
  await context.close();
  await browser.close();
  const file = await video.path();
  const final = path.join(OUT, `atria-pain-points-demo-${Date.now()}.webm`);
  fs.renameSync(file, final);
  console.log("saved", final);
})().catch(async (e) => {
  console.error(e);
  try { await global.__page.screenshot({ path: path.join(OUT, "failure.png") }); } catch {}
  process.exit(1);
});
