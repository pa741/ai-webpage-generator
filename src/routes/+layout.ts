import type { LayoutLoad, LayoutServerData } from './$types';
import { browser } from '$app/environment';
import { check } from "../lib/firebase";
import { getToken } from 'firebase/app-check';
import TextContent from '../Components/TextContent.svelte';

export const load: LayoutLoad = async ({data}) => {
    const componentScripts = data?.componentScripts ?? [];

    if (data && data.token) {
        return {
            token: data.token,
            componentScripts
        };
    }
    if (!check || !browser) {
        return {
            componentScripts
        };
    }
    let token = await getToken(check);
    return {
        token: token?.token,
        componentScripts
    };
};