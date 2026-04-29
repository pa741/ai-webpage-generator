<script lang="ts">
  import { browser } from "$app/environment";
  import { trackPageView } from "$lib/analytics";
  import "../lib/firebase"; // Initialize Firebase
  import "../app.css";
  // Track page views when route changes
  const { children, data } = $props();
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import TextContent from "../Components/TextContent.svelte";
  import GoogleLogin from "../Components/GoogleLogin.svelte";
  import ThreeCanvas from "../Components/ThreeCanvas.svelte";
  let token = data.token;
  /*
  onMount(() => {
    if (browser && TextContent.element && !customElements.get("text-content")) {
      customElements.define("text-content", TextContent.element);
    }
  }); */
  $effect(() => {
    if (browser && page.url) {
      trackPageView(page.url.pathname, page.url.href);
    }
  });
</script>



<div class="app">
  {#if token}
    {@render children()}
  {:else}
    <main>
      <div class="p-4 w-full max-w-2xl mx-auto">
        <h1 class="text-2xl font-bold mb-4">Checking your browser...</h1>
        <p class="text-gray-700">Please wait while we verify your browser.</p>
        <p class="text-gray-500 mt-2">
          If this takes too long, please try refreshing the page.
        </p>
      </div>
    </main>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
</style>
