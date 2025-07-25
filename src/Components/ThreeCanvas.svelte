<svelte:options
    customElement={{
        tag: "three-canvas",
        props: {
            description: { attribute: "description", type: "String" },
        },
    }}
/>

<script lang="ts">
    import { getFunctions, httpsCallable } from "firebase/functions";
    import { app } from "$lib/firebase.js";
    const functions = getFunctions(app, "europe-southwest1");
    const createScene = httpsCallable<
        { description: string },
        { script: string }
    >(functions, "createScene");
    let { description } = $props();
    let script = $state<string>("");

    if (description) {
        (async () => {
            const { data } = await createScene.call({
                description,
            });
            script = data.script;
        })();
    }
</script>

<div>
    <canvas class="text-content"></canvas>
    {@html script}
</div>
