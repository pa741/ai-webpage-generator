import type { LayoutLoad, LayoutServerData } from './$types';
import { browser } from '$app/environment';
import { check } from "../lib/firebase";
import { getToken } from 'firebase/app-check';

export const load: LayoutLoad = async (data) => {


    if (!check || !browser) {
        return;
    }
    let token = await getToken(check);
    return {
        token: token?.token || null,
    };
};