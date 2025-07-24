<svelte:options
    customElement={{
        tag: "text-content",
        props: {
            description: { attribute: "description", type: "String" },
        },
    }}
/>

<script lang="ts">
    import { getFunctions, httpsCallable } from "firebase/functions";
    import { app } from "$lib/firebase.js";
    import { marked } from "marked";
    const functions = getFunctions(app, "europe-southwest1");
    const generateContent = httpsCallable(functions, "generateContent");
    let { description } = $props();
    let text = $state<string>("");
    let renderText = $derived(marked.parse(text, { async: false }));

    if (description) {
        (async () => {
            const { stream } = await generateContent.stream({
                description,
            });

            for await (const chunk of stream) {
                text += (chunk as any).content;
            }
        })();
    }
</script>

<div class="text-content">
    {@html renderText}
</div>
