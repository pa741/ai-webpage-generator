import { p as push, j as pop, F as FILENAME } from "../../../chunks/index.js";
import "clsx";
import { h as hash } from "../../../chunks/utils.js";
import "../../../chunks/client.js";
import "../../../chunks/PageGenerator.js";
function html(value) {
  var html2 = String(value ?? "");
  var open = `<!--${hash(html2)}-->`;
  return open + html2 + "<!---->";
}
_page[FILENAME] = "src/routes/[...slug]/+page.svelte";
function _page($$payload, $$props) {
  push(_page);
  let { data } = $$props;
  $$payload.out += `${html(data.html)}`;
  pop();
}
_page.render = function() {
  throw new Error("Component.render(...) is no longer valid in Svelte 5. See https://svelte.dev/docs/svelte/v5-migration-guide#Components-are-no-longer-classes for more information");
};
export {
  _page as default
};
