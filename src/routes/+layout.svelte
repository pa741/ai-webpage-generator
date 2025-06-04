<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { trackPageView } from '$lib/analytics';
  import '../lib/firebase'; // Initialize Firebase

  // Track page views when route changes
  $: if (browser && $page.url) {
    trackPageView($page.url.pathname, $page.url.href);
  }
</script>

<div class="app">
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>

    <slot></slot>

</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    width: 100%;
    max-width: 64rem;
    margin: 0 auto;
    box-sizing: border-box;
  }
</style>