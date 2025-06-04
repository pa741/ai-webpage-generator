import "clsx";
import { c as pop, p as push } from "../../../chunks/index.js";
import "../../../chunks/client.js";
import "../../../chunks/PageGenerator.js";
function html(value) {
  var html2 = String(value ?? "");
  var open = "<!---->";
  return open + html2 + "<!---->";
}
function _page($$payload, $$props) {
  push();
  let { data } = $$props;
  $$payload.out += `${html(data.html)}`;
  pop();
}
export {
  _page as default
};
