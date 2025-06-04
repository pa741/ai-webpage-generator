import { G as GenerateHtml } from "../../../chunks/PageGenerator.js";
const load = async ({ url }) => {
  const html = await GenerateHtml(url.pathname);
  console.log("Generated HTML:", html);
  return {
    html
  };
};
export {
  load
};
