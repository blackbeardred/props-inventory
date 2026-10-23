// Search tagging against a stand-in for the Anthropic API: the answer's
// shape is read, materials and colours come first and get their family
// words, and the photo is sent when there is one.
//   node --experimental-strip-types --import ./src/lib/test-resolver.mjs src/lib/ai/tag-item.test.mjs
import { generateTags, parseTagAnswer } from "./tag-item.ts";

let pass = 0, fail = 0;
function is(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label} — expected ${e}, got ${a}`); }
}

is("the structured answer, flattened in order",
  parseTagAnswer('{"what":["cane"],"materials":["mahogany","wood"],"colours":["brown"],"style":["victorian"],"uses":["character"]}'),
  ["cane", "mahogany", "wood", "brown", "victorian", "character"]);
is("American spelling of colours is read too", parseTagAnswer('{"what":["hat"],"colors":["red"]}'), ["hat", "red"]);
is("a plain array still works", parseTagAnswer('```json\n["cup","white"]\n```'), ["cup", "white"]);
is("nonsense is no tags", [parseTagAnswer("I think it's a cane"), parseTagAnswer('{"what": "cane"}')], [[], []]);

let sent = null;
let answer = '{"what":["walking cane","cane"],"materials":["mahogany"],"colours":["reddish brown"],"style":[],"uses":["prop","character"]}';
globalThis.fetch = async (_url, init) => {
  sent = JSON.parse(init.body);
  return new Response(JSON.stringify({ content: [{ type: "text", text: answer }] }), { status: 200 });
};

delete process.env.ANTHROPIC_API_KEY;
is("no key, no call, no tags", [await generateTags({ name: "Cane" }), sent], [[], null]);

process.env.ANTHROPIC_API_KEY = "test";
const tags = await generateTags({ name: "Walking cane", category: "prop", description: "Glossy carved handle with a brass collar." });
is("mahogany becomes wood; the brass collar makes it metal too", ["wood", "metal", "brown"].every((t) => tags.includes(t)), true);
is("noise like 'prop' is dropped", tags.includes("prop"), false);
is("asks for materials and colours by name", /materials/.test(sent.system) && /colours/.test(sent.system), true);
is("no photo, text only", sent.messages[0].content.map((c) => c.type), ["text"]);

// A real (tiny) PNG, so sharp can read it.
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
await generateTags({ name: "Cane", photo: { bytes: png, mediaType: "image/png" } });
is("with a photo, the image goes first", sent.messages[0].content.map((c) => c.type), ["image", "text"]);

answer = "Sorry, I can't tell.";
is("an unreadable answer is no tags", await generateTags({ name: "Cane" }), []);

globalThis.fetch = async () => new Response("rate limited", { status: 429 });
const quiet = console.error; console.error = () => {};
is("an API error is no tags, not a crash", await generateTags({ name: "Cane" }), []);
console.error = quiet;

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
