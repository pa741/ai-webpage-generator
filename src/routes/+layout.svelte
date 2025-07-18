<script lang="ts">
  import { browser } from "$app/environment";
  import { trackPageView } from "$lib/analytics";
  import "../lib/firebase"; // Initialize Firebase
  import "../app.css";
  // Track page views when route changes
  const { children, data } = $props();
  import { page } from "$app/state";
  $effect(() => {
    if (browser && page.url) {
      trackPageView(page.url.pathname, page.url.href);
    }
  });
</script>

{#if browser}
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

{/if}

<div class="app">
  {@render children()}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
</style>
