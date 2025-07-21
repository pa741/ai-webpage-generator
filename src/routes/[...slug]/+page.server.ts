import type { PageLoad } from "./$types";

export const load: PageLoad = async (event) => {
    let t = await event.parent();

}