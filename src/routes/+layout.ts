import type { LayoutLoad } from './$types';
import { browser } from '$app/environment';
import { check } from "../lib/firebase";
import { getToken } from 'firebase/app-check';

export const load: LayoutLoad = async ({ data }) => {
    if (data && data.token) {
        return { token: data.token};
    }
    if (!check || !browser) {
        return {};
    }
    const token = await getToken(check);
    return { token: token?.token };
};
