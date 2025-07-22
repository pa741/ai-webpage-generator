<script lang="ts">
  import { browser } from "$app/environment";
  import { trackPageView } from "$lib/analytics";
  import "../lib/firebase"; // Initialize Firebase
  import "../app.css";
  // Track page views when route changes
  const { children, data } = $props();
  import { page } from "$app/state";
  let token = data.token;

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
    <p>Loading...</p>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
</style>
