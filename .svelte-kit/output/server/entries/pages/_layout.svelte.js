import { p as push, k as push_element, l as slot, m as pop_element, j as pop, F as FILENAME } from "../../chunks/index.js";
_layout[FILENAME] = "src/routes/+layout.svelte";
function _layout($$payload, $$props) {
  push(_layout);
  $$payload.out += `<div class="app svelte-1dcrz0p">`;
  push_element($$payload, "div", 1, 0);
  $$payload.out += `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"><\/script> <!---->`;
  slot($$payload, $$props, "default", {});
  $$payload.out += `<!----></div>`;
  pop_element();
  pop();
}
_layout.render = function() {
  throw new Error("Component.render(...) is no longer valid in Svelte 5. See https://svelte.dev/docs/svelte/v5-migration-guide#Components-are-no-longer-classes for more information");
};
export {
  _layout as default
};
