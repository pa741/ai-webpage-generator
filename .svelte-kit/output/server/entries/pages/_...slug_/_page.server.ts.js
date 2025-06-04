import { G as GenerateHtml } from "../../../chunks/PageGenerator.js";
const load = async ({ url }) => {
  if (url.pathname.endsWith(".png") || url.pathname.endsWith(".jpg") || url.pathname.endsWith(".jpeg") || url.pathname.endsWith(".gif")) {
    console.log("errroorrr");
  }
  const html = await GenerateHtml(url.pathname);
  return {
    html
  };
};
export {
  load
};
