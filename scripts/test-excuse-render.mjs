import { buildExcuseModifications } from "../src/marketing/excuseBank.js";

const BB_KEY = process.env.BANNERBEAR_API_KEY;
const BB_EXCUSE_TEMPLATE = "wvgMNmDoE6dnZyARK0";

async function renderExcusePost() {
  if (!BB_KEY) throw new Error("BANNERBEAR_API_KEY is not set");

  const createRes = await fetch("https://sync.api.bannerbear.com/v2/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template: BB_EXCUSE_TEMPLATE,
      modifications: buildExcuseModifications(),
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`BannerBear ${createRes.status}: ${body.slice(0, 300)}`);
  }

  const result = await createRes.json();
  return {
    uid: result.uid,
    image_url: result.image_url ?? null,
  };
}

const result = await renderExcusePost();

console.log("Excuse render complete");
console.log(`UID: ${result.uid}`);
console.log(`Image URL: ${result.image_url}`);
