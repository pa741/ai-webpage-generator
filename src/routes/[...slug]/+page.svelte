<script lang="ts">
  import { onMount } from "svelte";
  import { marked, Tokenizer } from "marked";
  import { getFunctions, httpsCallable } from "firebase/functions";
  import { watchComponents } from "$lib/component-watcher";
  let { data } = $props();
  let style = $state<string | undefined>(undefined);
  /*
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
  */
  $effect(() => {
    if (data.css) {
      style = `<style>${data.css}</style>`;
    } else {
      style = undefined;
    }
  });
  console.log("Data:", data);

  onMount(() => {
    const ids = data.componentScripts?.map((s) => s.id) ?? [];
    return watchComponents(ids);
  });
</script>

<svelte:head>
  {@html style}
  {#if data.componentScripts}
    {#each data.componentScripts as scriptRef (scriptRef.id)}
      <script type="module" src={scriptRef.src} defer></script>
    {/each}
  {/if}
</svelte:head>
{#if data.prompt}
  <p style="display: none;" class="prompt">{data.prompt}</p>
{/if}

{@html data.html}
