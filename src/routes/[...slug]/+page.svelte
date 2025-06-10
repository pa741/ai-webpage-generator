<script lang="ts">
  import { marked } from "marked";
  let { data } = $props();
  import { onMount } from "svelte";

  $effect(() => {
    const content = document.querySelectorAll("text-content");
    content.forEach(async (el) => {
      (el as any)._content = "";

      let description = el.getAttribute("description") ?? "<no description>";
      const encodedDescription = encodeURIComponent(description);

      const response = await fetch(window.location.pathname + "/stream", {
        headers: {
          Accept: "text/event-stream",
          Description: encodedDescription,
        },
      });

      const reader = response.body?.getReader();
      //append the text content to the element
      if (reader) {
        const decoder = new TextDecoder();

        let done = false;
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          if (value) {
            // remove data: from the start of the string
            let chunk = decoder.decode(value, { stream: true });
            if (chunk.startsWith("data: ")) {
              chunk = chunk.slice(6);
            }
            console.log("Received chunk:", chunk);
            (el as any)._content += chunk;
            let content = (el as any)._content;
            el.innerHTML = await marked.parse(content);

            //el.innerHTML += chunk;
          }
        }
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
