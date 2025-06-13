<script lang="ts">
  import { browser } from "$app/environment";
  import { page } from "$app/stores";
  import { marked } from "marked";
  import { onMount } from "svelte";
  import { getFunctions, httpsCallable } from "firebase/functions";
  import { app } from "$lib/firebase.js";
  let { data } = $props();

  $effect(() => {
    if (!browser) return;
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

{@html data.html}

<style>
  main {
    padding: 1rem;
  }
</style>
