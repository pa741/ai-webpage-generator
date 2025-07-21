<script lang="ts">
  import { marked, Tokenizer } from "marked";
  import { getFunctions, httpsCallable } from "firebase/functions";
  import { app, check } from "$lib/firebase.js";
  let { data } = $props();
  let hasToken = $state(false);

  $effect(() => {
    if (!check) return;

    console.log("Page data:", data);
    const functions = getFunctions(app, "europe-southwest1");
    const generateContent = httpsCallable(functions, "generateContent");

    const content = document.querySelectorAll("text-content");
    content.forEach(async (el) => {
      (el as any)._content = "";
      let description = el.getAttribute("description") ?? "<no description>";
      const { stream, data } = await generateContent.stream({ description });

      for await (const chunk of stream) {
        console.log("Received chunk:", chunk);
        (el as any)._content += (chunk as any).content;
        let content = (el as any)._content;
        el.innerHTML = await marked.parse(content);
      }
    });
  });
</script>

{#if (data.html)}
  {@html data.html}
{/if}



<style>
  main {
    padding: 1rem;
  }
</style>
