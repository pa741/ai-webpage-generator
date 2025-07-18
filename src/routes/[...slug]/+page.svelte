<script lang="ts">
  import { browser } from "$app/environment";
  import { marked, Tokenizer } from "marked";
  import { getFunctions, httpsCallable } from "firebase/functions";
  import { app, cpo } from "$lib/firebase.js";
  import { goto } from "$app/navigation";
  let { data } = $props();
  let hasToken = $state(false);

  $effect(() => {
    if (!browser) return;

    cpo
      ?.getToken()
      .then((token) => {
        if (token) {
          hasToken = true;
          //reload
          goto(window.location.pathname, { replaceState: true });
          console.log("Obtained App Check token:", token);
        } else {
          console.error("Failed to obtain App Check token.");
        }
      })
      .catch((error) => {
        console.error("Error obtaining App Check token:", error);
      });

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

<!-- Ensure the page is rendered with the correct HTML content -->
{#if data.appCheckValid}
  <p>Page loaded successfully with App Check validation.</p>
{:else if !hasToken}
  <p>Obtaining Token...</p>
{/if}

<style>
  main {
    padding: 1rem;
  }
</style>
